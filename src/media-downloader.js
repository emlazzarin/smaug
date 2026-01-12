/**
 * Media Downloader - Downloads and saves media files from tweets
 *
 * Handles:
 * - Images: Download full resolution
 * - GIFs: Download full resolution
 * - Videos: Download thumbnail only (with link to video)
 */

import fs from 'fs';
import path from 'path';
import { getAuthor, formatTimestamp, formatBytes } from './utils.js';

/**
 * Get file extension for media type
 */
function getExtensionForMedia(media) {
  if (media.type === 'video') return 'jpg'; // Thumbnail only
  if (media.type === 'animated_gif') return 'gif';

  // For photos, extract from URL or default to jpg
  const url = media.url || '';
  const urlExt = url.match(/\.(\w+)(?:\?|$)/)?.[1]?.toLowerCase();

  if (urlExt && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(urlExt)) {
    return urlExt;
  }
  return 'jpg';
}

/**
 * Generate filename for media
 * Format: YYYYMMDDHHMMSS_authorhandle_N.ext
 */
export function generateMediaFilename(tweet, mediaIndex, media, config) {
  const tz = config.fileTimezone || 'UTC';
  const timestamp = formatTimestamp(tweet.createdAt, tz);
  const author = getAuthor(tweet);
  const ext = getExtensionForMedia(media);
  return `${timestamp}_${author}_${mediaIndex + 1}.${ext}`;
}

/**
 * Download a single media file
 * For videos: download previewUrl (thumbnail) only
 * For photos/GIFs: download full media
 */
export async function downloadMedia(media, destPath, config) {
  // For videos, use the preview/thumbnail URL
  const url = media.type === 'video' ? (media.previewUrl || media.url) : media.url;

  if (!url) {
    return { success: false, error: 'No URL available' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.mediaTimeout || 30000
    );

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const contentLength = response.headers.get('content-length');
    const maxSize = config.maxMediaSize || 10 * 1024 * 1024; // 10MB default

    if (contentLength && parseInt(contentLength) > maxSize) {
      return { success: false, error: `File too large (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB)` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Double-check size after download
    if (buffer.length > maxSize) {
      return { success: false, error: `File too large (${Math.round(buffer.length / 1024 / 1024)}MB)` };
    }

    // Ensure directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);
    return { success: true, size: buffer.length };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Download timeout' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Download all media for a single tweet
 * Returns array of results with filenames
 */
export async function downloadTweetMedia(tweet, mediaDir, config) {
  const media = tweet.media || [];
  const results = [];

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    const filename = generateMediaFilename(tweet, i, item, config);
    const destPath = path.join(mediaDir, filename);

    console.log(`  Downloading media ${i + 1}/${media.length}: ${item.type}...`);

    const result = await downloadMedia(item, destPath, config);

    results.push({
      filename,
      type: item.type,
      success: result.success,
      error: result.error,
      size: result.size,
      // For videos, include the streaming URL
      videoUrl: item.type === 'video' ? item.videoUrl : null
    });

    if (result.success) {
      console.log(`    Saved: ${filename} (${Math.round(result.size / 1024)}KB)`);
    } else {
      console.log(`    Failed: ${result.error}`);
    }
  }

  return results;
}

/**
 * Download media for all tweets in a thread
 * Returns combined array of all media results
 */
export async function downloadThreadMedia(tweets, mediaDir, config) {
  const allResults = [];

  for (const tweet of tweets) {
    if (tweet.media && tweet.media.length > 0) {
      const author = getAuthor(tweet);
      console.log(`  Processing media for @${author}'s tweet...`);
      const results = await downloadTweetMedia(tweet, mediaDir, config);
      allResults.push(...results);
    }
  }

  return allResults;
}

/**
 * Get media stats summary
 */
export function getMediaStats(mediaResults) {
  const total = mediaResults.length;
  const successful = mediaResults.filter(m => m.success).length;
  const failed = mediaResults.filter(m => !m.success).length;
  const totalSize = mediaResults
    .filter(m => m.success && m.size)
    .reduce((sum, m) => sum + m.size, 0);

  return {
    total,
    successful,
    failed,
    totalSizeBytes: totalSize,
    totalSizeFormatted: formatBytes(totalSize)
  };
}

