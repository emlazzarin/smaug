/**
 * Bookmark Processor - Fetches and prepares Twitter bookmarks for analysis
 *
 * This handles the mechanical work:
 * - Fetching bookmarks via bird CLI
 * - Expanding t.co links
 * - Extracting content from linked pages (articles, GitHub repos)
 * - Optional: Bypassing paywalls via archive.ph
 *
 * Outputs a JSON bundle for AI analysis (Claude Code, etc.)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { loadConfig } from './config.js';
import { resolveThread } from './thread-resolver.js';
import { downloadThreadMedia, getMediaStats } from './media-downloader.js';
import { writeBookmarkFile, bookmarkFileExists } from './markdown-writer.js';
import { clipArticlesFromBookmark } from './article-clipper.js';
import { buildBirdEnv } from './utils.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Search for the original tweet that published an X article.
 * Used when bookmarked tweet is a share, not the original.
 */
function searchForArticleTweet(articleId, config) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    // articleId is validated as digits-only by caller's regex
    const searchQuery = `url:x.com/i/article/${articleId}`;
    const output = execSync(`${birdCmd} search "${searchQuery}" -n 5 --json`, {
      encoding: 'utf8',
      timeout: 30000,
      env
    });
    const parsed = JSON.parse(output);
    // bird CLI may return array or { tweets: [...] } depending on version
    const results = Array.isArray(parsed) ? parsed : (parsed.tweets || []);
    if (results.length > 0) {
      // Prefer tweets with article metadata (likely the original)
      for (const tweet of results) {
        if (tweet.article?.title || tweet.article?.previewText) {
          return tweet;
        }
      }
      return results[0];
    }
    return null;
  } catch (error) {
    console.log(`  Article search failed: ${error.message}`);
    return null;
  }
}

/**
 * Fetches X article content via bird CLI.
 * Direct HTTP fetch won't work - X articles are JS-rendered SPAs that require
 * the Twitter API (via bird CLI) to get the actual content.
 */
export async function fetchXArticleContent(articleUrl, config, sourceTweetId = null) {
  const articleIdMatch = articleUrl.match(/\/i\/article\/(\d+)/);
  if (!articleIdMatch) {
    return { error: 'Could not parse X article URL', source: 'x-article' };
  }

  const articleId = articleIdMatch[1];
  const env = buildBirdEnv(config);
  const birdCmd = config.birdPath || 'bird';

  const extractArticle = (tweetData, source, tweetId) => {
    let articleContent = tweetData.text || '';
    let articleMeta = tweetData.article || {};
    let actualTweetId = tweetId;

    // When someone quotes an X article, the full content is in quotedTweet, not main text
    const quotedTweet = tweetData.quotedTweet;
    if (quotedTweet) {
      const quotedContent = quotedTweet.text || '';
      const quotedMeta = quotedTweet.article || {};
      
      const mainHasMeta = articleMeta.title || articleMeta.previewText;
      const quotedHasMeta = quotedMeta.title || quotedMeta.previewText;
      
      if (quotedContent.length > articleContent.length) {
        articleContent = quotedContent;
        actualTweetId = quotedTweet.id || tweetId;
        // Only switch metadata if quoted has it (preserve main's metadata otherwise)
        if (quotedHasMeta) {
          articleMeta = quotedMeta;
        }
      } else if (quotedHasMeta && !mainHasMeta) {
        articleMeta = quotedMeta;
        if (quotedContent.length > 500) {
          articleContent = quotedContent;
          actualTweetId = quotedTweet.id || tweetId;
        }
      }
    }

    const hasArticleMeta = articleMeta.title || articleMeta.previewText;
    const hasArticleContent = articleContent.length > 500;

    if (hasArticleMeta || hasArticleContent) {
      return {
        articleId,
        title: articleMeta.title || null,
        previewText: articleMeta.previewText || null,
        content: articleContent,
        url: articleUrl,
        source,
        sourceTweetId: actualTweetId
      };
    }
    return null;
  };

  // Try the bookmarked tweet first - fastest path when it contains the article directly
  if (sourceTweetId) {
    try {
      const output = execSync(`${birdCmd} read ${sourceTweetId} --json`, {
        encoding: 'utf8',
        timeout: 30000,
        env
      });
      const tweetData = JSON.parse(output);
      const result = extractArticle(tweetData, 'bird-cli', sourceTweetId);
      if (result) return result;

      console.log(`  Bookmarked tweet is a share, searching for original article tweet...`);
    } catch (error) {
      console.log(`  Bird CLI article fetch failed: ${error.message}`);
    }
  }

  // Bookmarked tweet was a share/retweet - search for the original article tweet
  const originalTweet = searchForArticleTweet(articleId, config);
  if (originalTweet) {
    // Use search result directly if it has full content (avoids extra API call)
    const searchContent = originalTweet.text || originalTweet.quotedTweet?.text || '';
    if (searchContent.length > 500) {
      const searchResult = extractArticle(originalTweet, 'bird-cli-search', originalTweet.id);
      if (searchResult) {
        console.log(`  Found original article tweet with full content: ${originalTweet.id}`);
        return searchResult;
      }
    }

    // Search result truncated - need full tweet data
    try {
      console.log(`  Found original article tweet: ${originalTweet.id}, fetching full content...`);
      const output = execSync(`${birdCmd} read ${originalTweet.id} --json`, {
        encoding: 'utf8',
        timeout: 30000,
        env
      });
      const tweetData = JSON.parse(output);
      const readResult = extractArticle(tweetData, 'bird-cli-search-read', originalTweet.id);
      if (readResult) return readResult;
    } catch (error) {
      console.log(`  Could not read original tweet: ${error.message}`);
    }

    const result = extractArticle(originalTweet, 'bird-cli-search', originalTweet.id);
    if (result) {
      console.log(`  Using search result metadata (truncated content)`);
      return result;
    }
  }

  // Last resort: scrape meta tags (can't get full content - X articles require JS to render)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);
    
    const html = await response.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    
    const authorMatch = html.match(/@(\w+)/);
    
    return {
      articleId,
      title: ogTitleMatch?.[1] || titleMatch?.[1]?.replace(' / X', '').replace(' on X', '') || null,
      description: ogDescMatch?.[1] || descMatch?.[1] || null,
      author: authorMatch?.[1] || null,
      url: articleUrl,
      source: 'x-article-meta',
      note: 'X article content requires JavaScript rendering - metadata only'
    };
  } catch (error) {
    console.log(`  Could not fetch X article metadata: ${error.message}`);
    return {
      articleId,
      url: articleUrl,
      source: 'x-article',
      error: error.message,
      note: 'X article - content extraction failed'
    };
  }
}

// Sites that typically require paywall bypass
const PAYWALL_DOMAINS = [
  'nytimes.com',
  'wsj.com',
  'washingtonpost.com',
  'theatlantic.com',
  'newyorker.com',
  'bloomberg.com',
  'ft.com',
  'economist.com',
  'bostonglobe.com',
  'latimes.com',
  'wired.com'
];

export function loadState(config) {
  try {
    const content = fs.readFileSync(config.stateFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {
      last_processed_id: null,
      last_check: null,
      last_processing_run: null
    };
  }
}

export function saveState(config, state) {
  const dir = path.dirname(config.stateFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2) + '\n');
}

export function fetchBookmarks(config, count = 10, options = {}) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';

    // Use --all for large fetches (> 50) or when explicitly requested
    const useAll = options.all || count > 50;
    const folderId = options.folderId;

    let cmd;
    if (useAll) {
      // Paginated fetch - use longer timeout
      // Calculate maxPages from count (bird returns ~20 per page, use 25 as buffer)
      const estimatedPagesNeeded = Math.ceil(count / 20);
      const maxPages = options.maxPages || Math.max(estimatedPagesNeeded, 10);
      cmd = folderId
        ? `${birdCmd} bookmarks --folder-id ${folderId} --all --max-pages ${maxPages} --json`
        : `${birdCmd} bookmarks --all --max-pages ${maxPages} --json`;
    } else {
      cmd = folderId
        ? `${birdCmd} bookmarks --folder-id ${folderId} -n ${count} --json`
        : `${birdCmd} bookmarks -n ${count} --json`;
    }

    console.log(`  Running: ${cmd.replace(/--json/, '').trim()}`);

    // Use temp file to work around bird CLI pipe buffering bug
    const tmpFile = path.join(os.tmpdir(), `smaug-bookmarks-${Date.now()}.json`);
    execSync(`${cmd} > "${tmpFile}"`, {
      timeout: useAll ? 180000 : 60000, // 3 min for --all, 60s otherwise
      env,
      shell: true
    });
    const output = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    const parsed = JSON.parse(output);
    // bird CLI v0.6.0+ returns { tweets: [...], nextCursor: ... } for paginated requests
    // but plain arrays for non-paginated. Handle both formats.
    let bookmarks = Array.isArray(parsed) ? parsed : (parsed.tweets || []);

    // Respect the count parameter - truncate if we fetched more than requested
    // (paginated mode may return more bookmarks than asked for)
    if (bookmarks.length > count) {
      console.log(`  Fetched ${bookmarks.length} bookmarks, limiting to requested ${count}`);
      bookmarks = bookmarks.slice(0, count);
    }

    return bookmarks;
  } catch (error) {
    throw new Error(`Failed to fetch bookmarks: ${error.message}`);
  }
}

export function fetchLikes(config, count = 10) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    // Use temp file to work around bird CLI pipe buffering bug
    const tmpFile = path.join(os.tmpdir(), `smaug-likes-${Date.now()}.json`);
    execSync(`${birdCmd} likes -n ${count} --json > "${tmpFile}"`, {
      timeout: 60000,
      env,
      shell: true
    });
    const output = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    const parsed = JSON.parse(output);
    // Handle both array and object formats for consistency
    return Array.isArray(parsed) ? parsed : (parsed.tweets || []);
  } catch (error) {
    throw new Error(`Failed to fetch likes: ${error.message}`);
  }
}

export function fetchFromSource(config, count = 10, options = {}) {
  const source = config.source || 'bookmarks';

  switch (source) {
    case 'bookmarks':
      return fetchBookmarks(config, count, options);

    case 'likes':
      return fetchLikes(config, count);

    case 'both': {
      const bookmarks = fetchBookmarks(config, count, options);
      const likes = fetchLikes(config, count);
      const seen = new Set();
      const merged = [];
      for (const item of [...bookmarks, ...likes]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
      return merged;
    }

    default:
      throw new Error(`Invalid source: ${source}. Must be 'bookmarks', 'likes', or 'both'.`);
  }
}

/**
 * Fetch bookmarks from configured folders, tagging each with its folder name
 */
export function fetchFromFolders(config, count = 10, options = {}) {
  const folders = config.folders || {};
  const folderIds = Object.keys(folders);

  if (folderIds.length === 0) {
    return [];
  }

  console.log(`Fetching from ${folderIds.length} configured folder(s)...`);

  const bookmarkMap = new Map(); // Track bookmarks by ID to merge tags

  for (const folderId of folderIds) {
    const folderTag = folders[folderId];
    console.log(`\n📁 Folder "${folderTag}" (${folderId}):`);

    try {
      const bookmarks = fetchBookmarks(config, count, { ...options, folderId });
      let added = 0;
      let merged = 0;

      for (const bookmark of bookmarks) {
        if (bookmarkMap.has(bookmark.id)) {
          // Bookmark already seen - merge tags
          const existing = bookmarkMap.get(bookmark.id);
          if (!existing._folderTags.includes(folderTag)) {
            existing._folderTags.push(folderTag);
            merged++;
          }
        } else {
          // New bookmark - initialize with array of tags
          bookmark._folderTags = [folderTag];
          bookmark._folderId = folderId;
          bookmarkMap.set(bookmark.id, bookmark);
          added++;
        }
      }

      const mergeNote = merged > 0 ? `, ${merged} in multiple folders` : '';
      console.log(`  Found ${bookmarks.length} bookmarks, ${added} unique${mergeNote}`);
    } catch (error) {
      console.error(`  Error fetching folder ${folderId}: ${error.message}`);
    }
  }

  return Array.from(bookmarkMap.values());
}

export function fetchTweet(config, tweetId) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    const output = execSync(`${birdCmd} read ${tweetId} --json`, {
      encoding: 'utf8',
      timeout: 15000,
      env
    });
    return JSON.parse(output);
  } catch (error) {
    console.log(`  Could not fetch parent tweet ${tweetId}: ${error.message}`);
    return null;
  }
}

export async function expandTcoLink(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    return response.url || url;
  } catch (error) {
    console.error(`Failed to expand ${url}: ${error.message}`);
    return url;
  }
}

export function isPaywalled(url) {
  return PAYWALL_DOMAINS.some(domain => url.includes(domain));
}

export function stripQuerystring(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function extractGitHubInfo(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * Classify a URL into a content type
 */
function classifyLinkType(url) {
  if (url.includes('github.com')) {
    return 'github';
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'video';
  }
  if (url.includes('/i/article/')) {
    return 'x-article';
  }
  if (url.includes('x.com') || url.includes('twitter.com')) {
    if (url.includes('/photo/') || url.includes('/video/')) {
      return 'media';
    }
    return 'tweet';
  }
  if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    return 'image';
  }
  return 'article';
}

/**
 * Extract tweet context from a tweet object
 */
function extractTweetContext(tweet, source = null) {
  const author = tweet.author?.username || 'unknown';
  const context = {
    id: tweet.id,
    author,
    authorName: tweet.author?.name || author,
    text: tweet.text || tweet.full_text || '',
    tweetUrl: `https://x.com/${author}/status/${tweet.id}`
  };
  if (source) {
    context.source = source;
  }
  return context;
}

export async function fetchGitHubContent(url) {
  const info = extractGitHubInfo(url);
  if (!info) {
    throw new Error('Could not parse GitHub URL');
  }

  const { owner, repo } = info;

  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const repoResponse = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    const repoJson = await repoResponse.json();

    // Fetch README content
    let readme = '';
    try {
      const readmeUrl = `https://api.github.com/repos/${owner}/${repo}/readme`;
      const readmeResponse = await fetch(readmeUrl, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      const readmeJson = await readmeResponse.json();
      if (readmeJson.content) {
        readme = Buffer.from(readmeJson.content, 'base64').toString('utf8');
        if (readme.length > 5000) {
          readme = readme.slice(0, 5000) + '\n...[truncated]';
        }
      }
    } catch (e) {
      console.log(`  No README found for ${owner}/${repo}`);
    }

    return {
      name: repoJson.name,
      fullName: repoJson.full_name,
      description: repoJson.description || '',
      stars: repoJson.stargazers_count,
      language: repoJson.language,
      topics: repoJson.topics || [],
      readme,
      url: repoJson.html_url
    };
  } catch (error) {
    console.error(`  GitHub API error for ${owner}/${repo}: ${error.message}`);
    throw error;
  }
}

export async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    const text = await response.text();
    // Limit to 50KB like the old curl | head -c 50000
    const result = text.slice(0, 50000);

    // Check for paywall indicators
    if (result.includes('Subscribe') && result.includes('sign in') ||
        result.includes('This article is for subscribers') ||
        result.length < 1000) {
      return { text: result, source: 'direct', paywalled: true };
    }

    return { text: result, source: 'direct', paywalled: false };
  } catch (error) {
    throw error;
  }
}

export async function fetchContent(url, type, config) {
  // Use GitHub API for GitHub URLs
  if (type === 'github') {
    try {
      const ghContent = await fetchGitHubContent(url);
      return { ...ghContent, source: 'github-api' };
    } catch (error) {
      console.log(`  GitHub API failed: ${error.message}`);
    }
  }

  // For paywalled sites, note for manual handling or custom bypass
  if (isPaywalled(url)) {
    console.log(`  Paywalled domain detected: ${url}`);
    return {
      url,
      source: 'paywalled',
      note: 'Content requires paywall bypass - see README for options'
    };
  }

  // Try direct fetch for other URLs
  return await fetchArticleContent(url);
}

export function getExistingBookmarkIds(config) {
  try {
    const content = fs.readFileSync(config.archiveFile, 'utf8');
    const matches = content.matchAll(/x\.com\/\w+\/status\/(\d+)/g);
    return new Set([...matches].map(m => m[1]));
  } catch {
    return new Set();
  }
}

export async function fetchAndPrepareBookmarks(options = {}) {
  const config = loadConfig(options.configPath);
  const now = dayjs().tz(config.timezone || 'America/New_York');
  console.log(`[${now.format()}] Fetching and preparing bookmarks...`);

  const state = loadState(config);
  const source = options.source || config.source || 'bookmarks';
  const includeMedia = options.includeMedia ?? config.includeMedia ?? false;
  const configWithOptions = { ...config, source, includeMedia };
  const count = options.count || 20;

  // Build fetch options for pagination
  const fetchOptions = {
    all: options.all || count > 50,
    maxPages: options.maxPages
  };

  let tweets = [];
  const hasFolders = Object.keys(config.folders || {}).length > 0;

  if (hasFolders && source === 'bookmarks') {
    // Fetch from each configured folder with tags
    console.log(`Fetching from ${Object.keys(config.folders).length} folder(s)${includeMedia ? ' (with media)' : ''}`);
    const folderBookmarks = fetchFromFolders(configWithOptions, count, fetchOptions);

    // Also fetch all bookmarks to catch ones not in configured folders
    console.log(`\nFetching all bookmarks to catch unfiled ones...`);
    const allBookmarks = fetchBookmarks(configWithOptions, count, fetchOptions);

    // Merge: folder bookmarks take priority (they have tags)
    const seen = new Set(folderBookmarks.map(b => b.id));
    let unfiled = 0;
    for (const bookmark of allBookmarks) {
      if (!seen.has(bookmark.id)) {
        bookmark._folderTags = []; // No folder tags
        folderBookmarks.push(bookmark);
        unfiled++;
      }
    }
    if (unfiled > 0) {
      console.log(`  Found ${unfiled} bookmarks not in any configured folder`);
    }
    tweets = folderBookmarks;
  } else {
    // Normal fetch from source
    console.log(`Fetching from source: ${source}${includeMedia ? ' (with media)' : ''}${fetchOptions.all ? ' (paginated)' : ''}`);
    tweets = fetchFromSource(configWithOptions, count, fetchOptions);
  }

  if (!tweets || tweets.length === 0) {
    console.log(`No ${source} found`);
    return { bookmarks: [], count: 0 };
  }

  // Get IDs already processed or pending
  const existingIds = getExistingBookmarkIds(config);
  let pendingIds = new Set();
  try {
    if (fs.existsSync(config.pendingFile)) {
      const pending = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));
      pendingIds = new Set((pending.bookmarks || []).map(b => b.id.toString()));
    }
  } catch (e) {}

  // Determine which tweets to process
  let toProcess;
  if (options.specificIds) {
    toProcess = tweets.filter(b => options.specificIds.includes(b.id.toString()));
  } else if (options.force) {
    // Force mode: skip duplicate checking, process all fetched tweets
    toProcess = tweets;
  } else {
    toProcess = tweets.filter(b => {
      const id = b.id.toString();
      return !existingIds.has(id) && !pendingIds.has(id);
    });
  }

  if (toProcess.length === 0) {
    console.log('No new tweets to process');
    return { bookmarks: [], count: 0 };
  }

  console.log(`Preparing ${toProcess.length} tweets...`);

  const prepared = [];

  for (const bookmark of toProcess) {
    try {
      console.log(`\nProcessing bookmark ${bookmark.id}...`);
      const text = bookmark.text || bookmark.full_text || '';

      // Format date from tweet's createdAt, falling back to current date
      let date;
      if (bookmark.createdAt) {
        const tweetDate = dayjs(bookmark.createdAt).tz(config.timezone || 'America/New_York');
        date = tweetDate.format('dddd, MMMM D, YYYY');
      } else {
        date = now.format('dddd, MMMM D, YYYY');
      }
      const author = bookmark.author?.username || bookmark.user?.screen_name || 'unknown';

      const tcoLinks = text.match(/https?:\/\/t\.co\/\w+/g) || [];
      
      // Bookmarks API returns truncated quotedTweet data, so check it for links too
      if (bookmark.quotedTweet?.text) {
        const quotedLinks = bookmark.quotedTweet.text.match(/https?:\/\/t\.co\/\w+/g) || [];
        for (const link of quotedLinks) {
          if (!tcoLinks.includes(link)) {
            tcoLinks.push(link);
            console.log(`  Found t.co link in quoted tweet: ${link}`);
          }
        }
      }
      
      const links = [];

      const expandedResults = await Promise.all(
        tcoLinks.map(async (link) => {
          const expanded = await expandTcoLink(link);
          return { original: link, expanded };
        })
      );

      for (const { original: link, expanded } of expandedResults) {
        console.log(`  Expanded: ${link} -> ${expanded}`);

        const type = classifyLinkType(expanded);
        let content = null;

        if (type === 'x-article') {
          console.log(`  X article detected: ${expanded}`);
          try {
            content = await fetchXArticleContent(expanded, config, bookmark.id);
            if (content.content) {
              console.log(`  X article fetched: "${content.title || 'untitled'}" (${content.content.length} chars)`);
            } else if (content.title) {
              console.log(`  X article metadata only: "${content.title}"`);
            } else {
              console.log(`  X article: could not extract content`);
            }
          } catch (error) {
            console.log(`  Could not fetch X article: ${error.message}`);
            content = {
              articleId: expanded.match(/\/i\/article\/(\d+)/)?.[1],
              url: expanded,
              source: 'x-article',
              error: error.message
            };
          }
        }

        // For quote tweets, fetch the quoted tweet for context
        if (type === 'tweet') {
          const tweetIdMatch = expanded.match(/status\/(\d+)/);
          if (tweetIdMatch) {
            console.log(`  Quote tweet detected, fetching ${tweetIdMatch[1]}...`);
            const quotedTweet = fetchTweet(config, tweetIdMatch[1]);
            if (quotedTweet) {
              content = extractTweetContext(quotedTweet, 'quote-tweet');
            }
          }
        }

        // Fetch content for articles and GitHub repos
        if (type === 'article' || type === 'github') {
          try {
            const fetchResult = await fetchContent(expanded, type, config);

            if (fetchResult.source === 'github-api') {
              content = {
                name: fetchResult.name,
                fullName: fetchResult.fullName,
                description: fetchResult.description,
                stars: fetchResult.stars,
                language: fetchResult.language,
                topics: fetchResult.topics,
                readme: fetchResult.readme,
                url: fetchResult.url,
                source: 'github-api'
              };
              console.log(`  GitHub repo: ${fetchResult.fullName} (${fetchResult.stars} stars)`);
            } else {
              content = {
                text: fetchResult.text?.slice(0, 10000),
                source: fetchResult.source,
                paywalled: fetchResult.paywalled
              };
            }
          } catch (error) {
            console.log(`  Could not fetch content: ${error.message}`);
            content = { error: error.message };
          }
        }

        links.push({ original: link, expanded, type, content });
      }

      // Fallback for tweets with article metadata but no t.co link to expand
      const processDirectArticle = async (articleMeta, tweetId, source) => {
        if (!articleMeta || links.some(l => l.type === 'x-article')) return;
        
        console.log(`  Direct X article detected ${source}`);
        const articleUrl = `https://x.com/i/article/${articleMeta.id || tweetId}`;
        try {
          const content = await fetchXArticleContent(articleUrl, config, tweetId);
          if (content.content) {
            console.log(`  X article fetched: "${content.title || 'untitled'}" (${content.content.length} chars)`);
          } else if (content.title) {
            console.log(`  X article metadata only: "${content.title}"`);
          }
          links.push({ original: articleUrl, expanded: articleUrl, type: 'x-article', content });
        } catch (error) {
          console.log(`  Could not fetch X article: ${error.message}`);
          links.push({
            original: articleUrl,
            expanded: articleUrl,
            type: 'x-article',
            content: {
              articleId: articleMeta.id || tweetId,
              title: articleMeta.title || null,
              previewText: articleMeta.previewText || null,
              url: articleUrl,
              source: `${source.replace(/\s+/g, '-')}-meta`,
              error: error.message
            }
          });
        }
      };

      await processDirectArticle(bookmark.article, bookmark.id, 'on tweet');
      await processDirectArticle(bookmark.quotedTweet?.article, bookmark.quotedTweet?.id, 'on quoted tweet');

      let replyContext = null;
      if (bookmark.inReplyToStatusId) {
        console.log(`  This is a reply to ${bookmark.inReplyToStatusId}, fetching parent...`);
        const parentTweet = fetchTweet(config, bookmark.inReplyToStatusId);
        if (parentTweet) {
          replyContext = extractTweetContext(parentTweet);
        }
      }

      // Check for native quote tweet
      let quoteContext = null;
      if (bookmark.quotedTweet) {
        quoteContext = extractTweetContext(bookmark.quotedTweet, 'native-quote');
      }

      // Capture media attachments (photos, videos, GIFs) - EXPERIMENTAL
      // Only included if includeMedia is true (--media flag)
      const media = configWithOptions.includeMedia ? (bookmark.media || []) : [];

      // Build tags array from folder tags (supports multiple folders)
      const tags = bookmark._folderTags || [];
      // Legacy support for single tag
      if (bookmark._folderTag && !tags.includes(bookmark._folderTag)) {
        tags.push(bookmark._folderTag);
      }

      prepared.push({
        id: bookmark.id,
        author,
        authorName: bookmark.author?.name || bookmark.user?.name || author,
        text,
        tweetUrl: `https://x.com/${author}/status/${bookmark.id}`,
        createdAt: bookmark.createdAt,
        links,
        media,
        tags,
        date,
        isReply: !!bookmark.inReplyToStatusId,
        replyContext,
        isQuote: !!quoteContext,
        quoteContext
      });

      const mediaInfo = media.length > 0 ? ` (${media.length} media)` : '';
      const tagInfo = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      console.log(`  Prepared: @${author} with ${links.length} links${mediaInfo}${tagInfo}${replyContext ? ' (reply)' : ''}${quoteContext ? ' (quote)' : ''}`);

    } catch (error) {
      console.error(`  Error processing bookmark ${bookmark.id}: ${error.message}`);
    }
  }

  // Merge prepared bookmarks into pending file
  let existingPending = { bookmarks: [] };
  try {
    if (fs.existsSync(config.pendingFile)) {
      const parsed = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));
      existingPending = { bookmarks: parsed.bookmarks || [], ...parsed };
    }
  } catch (e) {}

  const existingPendingIds = new Set(existingPending.bookmarks.map(b => b.id));
  const newBookmarks = prepared.filter(b => !existingPendingIds.has(b.id));

  // Merge and sort by createdAt ascending (oldest first)
  // This ensures when processed, oldest get added first, newest end up on top
  const allBookmarks = [...existingPending.bookmarks, ...newBookmarks];
  allBookmarks.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateA - dateB; // Ascending: oldest first
  });

  const output = {
    generatedAt: now.toISOString(),
    count: allBookmarks.length,
    bookmarks: allBookmarks
  };

  const pendingDir = path.dirname(config.pendingFile);
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
  }
  fs.writeFileSync(config.pendingFile, JSON.stringify(output, null, 2));
  console.log(`\nMerged ${newBookmarks.length} new bookmarks into ${config.pendingFile} (total: ${output.count})`);

  // Update state
  state.last_check = now.toISOString();
  saveState(config, state);

  return { bookmarks: prepared, count: prepared.length, pendingFile: config.pendingFile };
}

/**
 * Process a single bookmark to an individual markdown file
 * Handles thread resolution, media downloading, and markdown generation
 */
export async function processBookmarkToFile(bookmark, config) {
  const author = bookmark.author || 'unknown';
  console.log(`\nProcessing @${author}'s bookmark ${bookmark.id}...`);

  // Check if already processed
  if (bookmarkFileExists(bookmark, config)) {
    console.log(`  Already processed, skipping`);
    return { skipped: true, reason: 'already_processed' };
  }

  // 1. Resolve thread context
  console.log(`  Resolving thread context...`);
  const threadData = resolveThread(bookmark, config);
  console.log(`  Type: ${threadData.type}, ${threadData.tweets.length} tweet(s)`);

  // 2. Download media (if enabled)
  let mediaResults = [];
  if (config.downloadMedia) {
    const totalMedia = threadData.tweets.reduce((sum, t) => sum + (t.media?.length || 0), 0);
    if (totalMedia > 0) {
      console.log(`  Downloading ${totalMedia} media file(s)...`);
      mediaResults = await downloadThreadMedia(threadData.tweets, config.mediaDir, config);
      const stats = getMediaStats(mediaResults);
      console.log(`  Media: ${stats.successful}/${stats.total} downloaded (${stats.totalSizeFormatted})`);
    }
  }

  // 3. Clip articles (if enabled)
  let clippingResults = [];
  if (config.clipArticles !== false) {
    const articleLinks = (bookmark.links || []).filter(l => l.type === 'article');
    if (articleLinks.length > 0) {
      console.log(`  Clipping ${articleLinks.length} article(s)...`);
      clippingResults = await clipArticlesFromBookmark(bookmark, config);
      const clipped = clippingResults.filter(c => c.success).length;
      if (clipped > 0) {
        console.log(`  Clipped: ${clipped}/${articleLinks.length} articles`);
      }
    }
  }

  // 4. Write individual markdown file
  console.log(`  Writing markdown file...`);
  const fileResult = writeBookmarkFile(bookmark, threadData, mediaResults, clippingResults, config);
  console.log(`  Created: ${fileResult.filename}`);

  return {
    success: true,
    id: bookmark.id,
    author,
    threadType: threadData.type,
    threadLength: threadData.tweets.length,
    mediaDownloaded: mediaResults.filter(m => m.success).length,
    mediaFailed: mediaResults.filter(m => !m.success).length,
    articlesClipped: clippingResults.filter(c => c.success).length,
    outputFile: fileResult.filename
  };
}

/**
 * Process all pending bookmarks to individual files
 * This is the new main processing function that replaces Claude-based processing
 */
export async function processAllBookmarks(options = {}) {
  const config = loadConfig(options.configPath);
  const now = dayjs().tz(config.timezone || 'America/New_York');
  console.log(`[${now.format()}] Processing bookmarks to individual files...`);

  // Load pending bookmarks
  if (!fs.existsSync(config.pendingFile)) {
    console.log('No pending bookmarks to process');
    return { processed: 0, skipped: 0, failed: 0 };
  }

  const pending = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));
  const bookmarks = pending.bookmarks || [];

  if (bookmarks.length === 0) {
    console.log('No pending bookmarks to process');
    return { processed: 0, skipped: 0, failed: 0 };
  }

  console.log(`Found ${bookmarks.length} pending bookmark(s)`);

  // Ensure output directories exist
  if (!fs.existsSync(config.bookmarksDir)) {
    fs.mkdirSync(config.bookmarksDir, { recursive: true });
  }
  if (config.downloadMedia && !fs.existsSync(config.mediaDir)) {
    fs.mkdirSync(config.mediaDir, { recursive: true });
  }

  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    files: []
  };

  // Process each bookmark
  for (const bookmark of bookmarks) {
    try {
      const result = await processBookmarkToFile(bookmark, config);

      if (result.skipped) {
        results.skipped++;
      } else if (result.success) {
        results.processed++;
        results.files.push(result.outputFile);
      }
    } catch (error) {
      console.error(`  Error processing bookmark ${bookmark.id}: ${error.message}`);
      results.failed++;
    }
  }

  // Clear pending file after processing
  if (results.processed > 0 || results.skipped > 0) {
    const remainingBookmarks = bookmarks.filter(b => {
      // Keep only bookmarks that failed
      return !results.files.some(f => f.includes(b.id));
    });

    if (remainingBookmarks.length === 0) {
      // All processed, clear the file
      fs.writeFileSync(config.pendingFile, JSON.stringify({ bookmarks: [], count: 0 }, null, 2));
    } else {
      // Some failed, keep them for retry
      fs.writeFileSync(config.pendingFile, JSON.stringify({
        bookmarks: remainingBookmarks,
        count: remainingBookmarks.length
      }, null, 2));
    }
  }

  // Update state
  const state = loadState(config);
  state.last_processing_run = now.toISOString();
  saveState(config, state);

  console.log(`\nProcessing complete:`);
  console.log(`  Processed: ${results.processed}`);
  console.log(`  Skipped: ${results.skipped}`);
  console.log(`  Failed: ${results.failed}`);

  return results;
}

/**
 * Get list of existing bookmark files
 */
export function getExistingBookmarkFiles(config) {
  if (!fs.existsSync(config.bookmarksDir)) {
    return [];
  }

  return fs.readdirSync(config.bookmarksDir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(config.bookmarksDir, f));
}
