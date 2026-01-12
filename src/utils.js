/**
 * Shared utilities for Smaug
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Get author username from tweet
 * Handles both raw bird CLI format and processed bookmark format
 */
export function getAuthor(tweet) {
  if (typeof tweet.author === 'string') {
    return tweet.author;
  }
  return tweet.author?.username || tweet.user?.screen_name || 'unknown';
}

/**
 * Get author display name from tweet
 * Handles both raw bird CLI format and processed bookmark format
 */
export function getAuthorName(tweet) {
  if (tweet.authorName) {
    return tweet.authorName;
  }
  return tweet.author?.name || tweet.user?.name || getAuthor(tweet);
}

/**
 * Format timestamp as YYYYMMDDHHMMSS
 */
export function formatTimestamp(createdAt, tz = 'UTC') {
  const date = dayjs(createdAt).tz(tz);
  return date.format('YYYYMMDDHHmmss');
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Build environment with Twitter credentials for bird CLI
 */
export function buildBirdEnv(config) {
  const env = { ...process.env };
  if (config.twitter?.authToken) {
    env.AUTH_TOKEN = config.twitter.authToken;
  }
  if (config.twitter?.ct0) {
    env.CT0 = config.twitter.ct0;
  }
  return env;
}
