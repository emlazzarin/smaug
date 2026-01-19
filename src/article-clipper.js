import fs from 'fs';
import path from 'path';
import { formatTimestamp } from './utils.js';

let Defuddle = null;

async function getDefuddle() {
  if (!Defuddle) {
    const module = await import('defuddle/node');
    Defuddle = module.Defuddle;
  }
  return Defuddle;
}

const ARTICLE_DOMAINS = [
  'medium.com',
  'substack.com',
  'dev.to',
  'hashnode.dev',
  'wordpress.com',
  'blogspot.com',
  'ghost.io',
  'beehiiv.com',
  'mirror.xyz',
  'notion.site',
  'telegraph.co.uk',
  'theguardian.com',
  'nytimes.com',
  'wsj.com',
  'washingtonpost.com',
  'theatlantic.com',
  'newyorker.com',
  'wired.com',
  'arstechnica.com',
  'techcrunch.com',
  'theverge.com',
  'vice.com',
  'vox.com',
  'slate.com',
  'salon.com',
  'huffpost.com',
  'buzzfeed.com',
  'forbes.com',
  'businessinsider.com',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'cnn.com',
  'npr.org',
  'politico.com',
  'axios.com',
  'fastcompany.com',
  'inc.com',
  'entrepreneur.com',
  'hbr.org',
  'lesswrong.com',
  'astralcodexten.substack.com',
  'gwern.net',
  'paulgraham.com',
  'stratechery.com',
  'ribbonfarm.com',
  'slatestarcodex.com'
];

const SKIP_DOMAINS = [
  'twitter.com',
  'x.com',
  'github.com',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'twitch.tv',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'reddit.com',
  'discord.com',
  'slack.com',
  'notion.so',
  'figma.com',
  'docs.google.com',
  'drive.google.com',
  'dropbox.com',
  'spotify.com',
  'apple.com',
  'amazon.com',
  'ebay.com',
  'etsy.com'
];

const ARTICLE_PATH_PATTERNS = [
  '/blog/', '/post/', '/posts/', '/article/', '/articles/', '/news/', '/story/', '/p/',
  '/general/', '/writing/', '/essays/', '/thoughts/', '/notes/'
];

const ARTICLE_EXTENSIONS = ['html', 'htm'];

const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'pdf'];

export function isClippableArticle(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const pathLower = parsed.pathname.toLowerCase();

    if (SKIP_DOMAINS.some(d => hostname.includes(d))) {
      return false;
    }

    const ext = parsed.pathname.split('.').pop()?.toLowerCase();
    if (MEDIA_EXTENSIONS.includes(ext)) {
      return false;
    }

    // Known article domains
    if (ARTICLE_DOMAINS.some(d => hostname.includes(d))) {
      return true;
    }

    // Article-like path patterns
    if (ARTICLE_PATH_PATTERNS.some(pattern => pathLower.includes(pattern))) {
      return true;
    }

    // HTML files are usually articles
    if (ARTICLE_EXTENSIONS.includes(ext)) {
      return true;
    }

    // Slug-like paths (hyphens or underscores, reasonable length)
    const pathParts = parsed.pathname.split('/').filter(p => p.length > 0);
    if (pathParts.length >= 1) {
      const lastPart = pathParts[pathParts.length - 1].replace(/\.\w+$/, ''); // strip extension
      if ((lastPart.includes('-') || lastPart.includes('_')) && lastPart.length > 15 && lastPart.length < 120) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function slugify(title, maxLength = 50) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

export function generateClippingFilename(url, title, timestamp, config) {
  const tz = config.fileTimezone || 'UTC';
  const ts = formatTimestamp(timestamp, tz);
  const slug = slugify(title || new URL(url).hostname);
  return `${ts}_${slug}.md`;
}

export async function extractArticle(url, options = {}) {
  const { timeout = 30000 } = options;

  try {
    const defuddle = await getDefuddle();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const result = await defuddle(html, url, { markdown: true });

    return {
      success: true,
      url,
      title: result.title || '',
      author: result.author || '',
      description: result.description || '',
      siteName: result.site || '',
      publishedDate: result.published || null,
      content: result.content || '',
      wordCount: result.wordCount || 0
    };
  } catch (error) {
    return {
      success: false,
      url,
      error: error.message
    };
  }
}

function escapeYamlString(str) {
  return str.replace(/"/g, '\\"');
}

function generateClippingMarkdown(article, sourceBookmark) {
  const title = article.title || 'Untitled';
  const lines = [
    '---',
    `title: "${escapeYamlString(title)}"`,
    `source_url: ${article.url}`
  ];

  if (article.author) {
    lines.push(`author: "${escapeYamlString(article.author)}"`);
  }
  if (article.siteName) {
    lines.push(`site: "${escapeYamlString(article.siteName)}"`);
  }
  if (article.publishedDate) {
    lines.push(`published: ${article.publishedDate}`);
  }
  if (article.description) {
    lines.push(`description: "${escapeYamlString(article.description.slice(0, 200))}"`);
  }
  if (sourceBookmark) {
    lines.push(`bookmarked_from: https://x.com/${sourceBookmark.author}/status/${sourceBookmark.id}`);
  }

  lines.push(`clipped_at: ${new Date().toISOString()}`);
  lines.push(`word_count: ${article.wordCount}`);
  lines.push('tags: [clipping]');
  lines.push('---\n');

  lines.push(`# ${title}\n`);
  lines.push(`> [Original article](${article.url})`);
  if (article.author) {
    lines.push(`> by ${article.author}`);
  }
  lines.push('');
  lines.push(article.content);

  return lines.join('\n');
}

export async function clipArticle(url, config, sourceBookmark = null) {
  const clippingsDir = config.clippingsDir || './clippings';

  console.log(`  Extracting article from ${url}...`);
  const article = await extractArticle(url);

  if (!article.success) {
    console.log(`  Failed to extract: ${article.error}`);
    return { success: false, url, error: article.error };
  }

  if (!article.content || article.wordCount < 100) {
    console.log(`  Skipping: content too short (${article.wordCount} words)`);
    return { success: false, url, error: 'Content too short' };
  }

  const timestamp = article.publishedDate || new Date().toISOString();
  const filename = generateClippingFilename(url, article.title, timestamp, config);
  const filepath = path.join(clippingsDir, filename);

  if (!fs.existsSync(clippingsDir)) {
    fs.mkdirSync(clippingsDir, { recursive: true });
  }

  if (fs.existsSync(filepath)) {
    console.log(`  Already clipped: ${filename}`);
    return { success: true, url, filename, filepath, alreadyExists: true, title: article.title };
  }

  const markdown = generateClippingMarkdown(article, sourceBookmark);
  fs.writeFileSync(filepath, markdown);

  console.log(`  Clipped: ${filename} (${article.wordCount} words)`);

  return {
    success: true,
    url,
    filename,
    filepath,
    title: article.title,
    author: article.author,
    wordCount: article.wordCount
  };
}

export async function clipArticlesFromBookmark(bookmark, config) {
  const results = [];
  const links = bookmark.links || [];

  for (const link of links) {
    const url = link.expanded || link.original;

    if (link.type !== 'article' || !isClippableArticle(url)) {
      continue;
    }

    const result = await clipArticle(url, config, bookmark);
    results.push(result);
  }

  return results;
}
