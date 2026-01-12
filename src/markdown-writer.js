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
 * Format links section
 */
function formatLinks(links) {
  if (!links || links.length === 0) return '';

  const lines = ['\n## Links\n'];

  for (const link of links) {
    const url = link.expanded || link.original;
    // Skip twitter media links
    if (url.includes('/photo/') || url.includes('/video/')) continue;
    lines.push(`- [${url}](${url})`);
  }

  // Only return if we have actual links
  if (lines.length <= 1) return '';
  return lines.join('\n');
}

/**
 * Generate YAML frontmatter
 */
function generateFrontmatter(threadData, bookmark, config) {
  const { type, tweets, rootTweet } = threadData;
  const primaryTweet = tweets[tweets.length - 1]; // The bookmarked tweet
  const author = getAuthor(primaryTweet);
  const authorName = getAuthorName(primaryTweet);

  const lines = [
    '---',
    `title: ${escapeYaml(generateTitle(primaryTweet))}`,
    `author: "@${author}"`,
    `author_name: ${escapeYaml(authorName)}`,
    `date: ${rootTweet.createdAt}`,
    `tweet_url: https://x.com/${author}/status/${primaryTweet.id}`,
    `type: ${type}`
  ];

  if (type === 'thread') {
    lines.push(`thread_length: ${tweets.length}`);
  }

  if (bookmark.tags && bookmark.tags.length > 0) {
    lines.push(`tags: [${bookmark.tags.join(', ')}]`);
  }

  lines.push('---\n');
  return lines.join('\n');
}

/**
 * Generate full markdown content for a bookmark
 */
export function generateBookmarkMarkdown(bookmark, threadData, mediaResults, config) {
  const { type, tweets, rootTweet } = threadData;
  const primaryTweet = tweets[tweets.length - 1];
  const author = getAuthor(rootTweet);

  const sections = [];

  // Frontmatter
  sections.push(generateFrontmatter(threadData, bookmark, config));

  // Main content based on type
  if (type === 'thread' && tweets.length > 1) {
    // Thread: show all tweets numbered
    sections.push(`# Thread by @${author}\n`);

    for (let i = 0; i < tweets.length; i++) {
      sections.push(`## ${i + 1}/${tweets.length}`);
      sections.push(formatTweetContent(tweets[i]));
      sections.push('');
    }
  } else if (type === 'conversation') {
    // Conversation: show parent context, then the reply
    sections.push(`# Conversation\n`);

    // Show ancestor tweets
    for (let i = 0; i < tweets.length - 1; i++) {
      sections.push(formatTweetContent(tweets[i], { isParent: true }));
      sections.push('');
    }

    sections.push('---\n');
    sections.push(`## Reply by @${getAuthor(primaryTweet)}:\n`);
    sections.push(formatTweetContent(primaryTweet));
  } else {
    // Standalone tweet
    sections.push(`# @${author}\n`);
    sections.push(formatTweetContent(primaryTweet));
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

  // Links section
  const linksSection = formatLinks(bookmark.links);
  if (linksSection) {
    sections.push(linksSection);
  }

  // Footer
  sections.push('\n---\n*Archived via [Smaug](https://github.com/alexknowshtml/smaug)*');

  return sections.join('\n');
}

/**
 * Write bookmark to individual file
 */
export function writeBookmarkFile(bookmark, threadData, mediaResults, config) {
  const filename = generateBookmarkFilename(threadData.rootTweet, config);
  const filepath = path.join(config.bookmarksDir, filename);

  const markdown = generateBookmarkMarkdown(bookmark, threadData, mediaResults, config);

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
