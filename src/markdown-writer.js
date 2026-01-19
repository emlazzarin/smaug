/**
 * Markdown Writer - Generates Obsidian-compatible markdown files
 *
 * Creates individual markdown files for each bookmark with:
 * - YAML frontmatter
 * - Thread/conversation formatting
 * - Obsidian-style media embeds (![[filename]])
 * - Quote tweet formatting
 */

import fs from 'fs';
import path from 'path';
import { getAuthor, getAuthorName, formatTimestamp } from './utils.js';

/**
 * Generate filename for bookmark markdown
 * Format: YYYYMMDDHHMMSS_authorhandle.md
 * Uses root tweet's timestamp for threads
 */
export function generateBookmarkFilename(rootTweet, config) {
  const tz = config.fileTimezone || 'UTC';
  const timestamp = formatTimestamp(rootTweet.createdAt, tz);
  const author = getAuthor(rootTweet);
  return `${timestamp}_${author}.md`;
}

/**
 * Generate a descriptive title from tweet content
 */
function generateTitle(tweet) {
  const text = tweet.text || '';
  // Remove URLs and clean up
  const cleaned = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) {
    return `Tweet by @${getAuthor(tweet)}`;
  }
  if (cleaned.length <= 60) {
    return cleaned;
  }
  return cleaned.slice(0, 57) + '...';
}

/**
 * Escape special characters for YAML string
 */
function escapeYaml(str) {
  if (!str) return '';
  // If contains quotes or special chars, wrap in quotes and escape internal quotes
  if (str.includes('"') || str.includes(':') || str.includes('#')) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

/**
 * Format tweet text as blockquote
 */
function formatAsBlockquote(text) {
  if (!text) return '';
  return text.split('\n').map(line => `> ${line}`).join('\n');
}

/**
 * Format a single tweet's content
 */
function formatTweetContent(tweet, options = {}) {
  const { isQuoted = false, isParent = false } = options;
  const author = getAuthor(tweet);
  const authorName = getAuthorName(tweet);
  const text = tweet.text || '';

  if (isQuoted) {
    return `> **Quoted @${author} (${authorName}):**\n${formatAsBlockquote(text)}`;
  }

  if (isParent) {
    return `> **@${author} (${authorName}):**\n${formatAsBlockquote(text)}`;
  }

  return formatAsBlockquote(text);
}

/**
 * Generate Obsidian media embeds
 */
function formatMediaEmbeds(mediaResults) {
  if (!mediaResults || mediaResults.length === 0) return '';

  const lines = ['\n## Media\n'];

  for (const media of mediaResults) {
    if (media.success) {
      // Obsidian embed syntax
      lines.push(`![[${media.filename}]]`);

      // For videos, add link to stream
      if (media.videoUrl) {
        lines.push(`\n[Watch Video](${media.videoUrl})`);
      }
      lines.push('');
    } else {
      lines.push(`<!-- Media download failed: ${media.error} -->`);
    }
  }

  return lines.join('\n');
}

/**
 * Format links section with clipping references
 */
function formatLinks(links, clippingResults = []) {
  if (!links || links.length === 0) return '';

  // Build a map of URL -> clipping for quick lookup
  const clippingMap = new Map();
  for (const clip of clippingResults) {
    if (clip.success && clip.filename) {
      clippingMap.set(clip.url, clip);
    }
  }

  const lines = ['\n## Links\n'];

  for (const link of links) {
    const url = link.expanded || link.original;
    // Skip twitter media links
    if (url.includes('/photo/') || url.includes('/video/')) continue;

    // Check if we have a clipping for this URL
    const clipping = clippingMap.get(url);
    if (clipping) {
      // Use Obsidian wikilink to clipping
      const displayTitle = clipping.title || url;
      lines.push(`- [[clippings/${clipping.filename.replace('.md', '')}|${displayTitle}]] ([source](${url}))`);
    } else {
      lines.push(`- [${url}](${url})`);
    }
  }

  // Only return if we have actual links
  if (lines.length <= 1) return '';
  return lines.join('\n');
}

/**
 * Generate YAML frontmatter
 * Author info is at the document level, tweet-specific info is per-post in the body
 */
function generateFrontmatter(threadData, bookmark, config) {
  const { type, tweets } = threadData;
  const primaryTweet = tweets[0]; // Use first tweet for author info
  const author = getAuthor(primaryTweet);
  const authorName = getAuthorName(primaryTweet);

  const lines = [
    '---',
    `title: ${escapeYaml(generateTitle(primaryTweet))}`,
    `author: "@${author}"`,
    `author_name: ${escapeYaml(authorName)}`,
    `author_url: https://x.com/${author}`
  ];

  if (type === 'thread' && tweets.length > 1) {
    lines.push(`thread_length: ${tweets.length}`);
  }

  // Always include tags (Obsidian-compatible YAML array)
  const tags = bookmark.tags || [];
  lines.push(`tags: [${tags.join(', ')}]`);

  lines.push('---\n');
  return lines.join('\n');
}

/**
 * Format tweet date for display
 */
function formatTweetDate(createdAt) {
  const date = new Date(createdAt);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format a tweet with its metadata (date, url)
 */
function formatTweetWithMeta(tweet, position, total) {
  const author = getAuthor(tweet);
  const date = formatTweetDate(tweet.createdAt);
  const url = `https://x.com/${author}/status/${tweet.id}`;

  const lines = [];

  if (total > 1) {
    lines.push(`## ${position}/${total}`);
  }

  lines.push(`*${date}* · [View](${url})\n`);
  lines.push(formatTweetContent(tweet));

  return lines.join('\n');
}

/**
 * Generate full markdown content for a bookmark
 */
export function generateBookmarkMarkdown(bookmark, threadData, mediaResults, clippingResults, config) {
  const { type, tweets, rootTweet } = threadData;
  const author = getAuthor(rootTweet);

  const sections = [];

  // Frontmatter
  sections.push(generateFrontmatter(threadData, bookmark, config));

  // Main content based on type
  if (type === 'thread' && tweets.length > 1) {
    // Thread: show all tweets numbered, chronological order (oldest first)
    sections.push(`# Thread by @${author}\n`);

    for (let i = 0; i < tweets.length; i++) {
      sections.push(formatTweetWithMeta(tweets[i], i + 1, tweets.length));
      sections.push('');
    }
  } else if (type === 'conversation') {
    // Conversation: show parent context (oldest first for context), then the reply
    sections.push(`# Conversation\n`);

    // Show ancestor tweets (oldest to newest for context flow)
    for (let i = 0; i < tweets.length - 1; i++) {
      const tweet = tweets[i];
      const date = formatTweetDate(tweet.createdAt);
      const url = `https://x.com/${getAuthor(tweet)}/status/${tweet.id}`;
      sections.push(`*${date}* · [View](${url})\n`);
      sections.push(formatTweetContent(tweet, { isParent: true }));
      sections.push('');
    }

    sections.push('---\n');
    const primaryTweet = tweets[tweets.length - 1];
    const date = formatTweetDate(primaryTweet.createdAt);
    const url = `https://x.com/${getAuthor(primaryTweet)}/status/${primaryTweet.id}`;
    sections.push(`## Reply by @${getAuthor(primaryTweet)}:`);
    sections.push(`*${date}* · [View](${url})\n`);
    sections.push(formatTweetContent(primaryTweet));
  } else {
    // Standalone tweet
    sections.push(`# @${author}\n`);
    const tweet = tweets[0];
    const date = formatTweetDate(tweet.createdAt);
    const url = `https://x.com/${author}/status/${tweet.id}`;
    sections.push(`*${date}* · [View](${url})\n`);
    sections.push(formatTweetContent(tweet));
  }

  // Quoted tweet (if any)
  if (bookmark.quoteContext) {
    sections.push('\n---\n');
    sections.push(formatTweetContent(bookmark.quoteContext, { isQuoted: true }));
  }

  // Media embeds
  const mediaSection = formatMediaEmbeds(mediaResults);
  if (mediaSection) {
    sections.push(mediaSection);
  }

  // Links section (with clipping references)
  const linksSection = formatLinks(bookmark.links, clippingResults);
  if (linksSection) {
    sections.push(linksSection);
  }

  return sections.join('\n');
}

/**
 * Write bookmark to individual file
 */
export function writeBookmarkFile(bookmark, threadData, mediaResults, clippingResults, config) {
  const filename = generateBookmarkFilename(threadData.rootTweet, config);
  const filepath = path.join(config.bookmarksDir, filename);

  const markdown = generateBookmarkMarkdown(bookmark, threadData, mediaResults, clippingResults, config);

  // Ensure directory exists
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filepath, markdown);

  return { filename, filepath };
}

/**
 * Check if a bookmark file already exists
 */
export function bookmarkFileExists(rootTweet, config) {
  const filename = generateBookmarkFilename(rootTweet, config);
  const filepath = path.join(config.bookmarksDir, filename);
  return fs.existsSync(filepath);
}
