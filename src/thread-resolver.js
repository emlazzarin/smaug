/**
 * Thread Resolver - Fetches and classifies tweet threads
 *
 * Handles:
 * - Same-author threads (traverse up and down)
 * - Multi-author conversations (traverse up only)
 * - Standalone tweets
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAuthor, buildBirdEnv } from './utils.js';

/**
 * Fetch a single tweet by ID
 */
export function fetchTweet(config, tweetId) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    const tmpFile = path.join(os.tmpdir(), `smaug-tweet-${tweetId}-${Date.now()}.json`);

    execSync(`${birdCmd} read ${tweetId} --json > "${tmpFile}"`, {
      timeout: 15000,
      env,
      shell: true
    });

    const output = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    return JSON.parse(output);
  } catch (error) {
    console.log(`  Could not fetch tweet ${tweetId}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch full thread using bird thread command
 */
export function fetchThread(config, tweetId) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    const tmpFile = path.join(os.tmpdir(), `smaug-thread-${tweetId}-${Date.now()}.json`);

    execSync(`${birdCmd} thread ${tweetId} --json > "${tmpFile}"`, {
      timeout: 60000,
      env,
      shell: true
    });

    const output = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : (parsed.tweets || [parsed]);
  } catch (error) {
    console.log(`  Could not fetch thread for ${tweetId}: ${error.message}`);
    return null;
  }
}

/**
 * Classify a tweet's thread type based on its parent
 * @returns 'standalone' | 'thread' | 'conversation'
 */
export function classifyTweet(tweet, parentTweet) {
  if (!tweet.inReplyToStatusId) {
    return 'standalone';
  }

  if (!parentTweet) {
    return 'standalone';
  }

  const tweetAuthor = getAuthor(tweet);
  const parentAuthor = getAuthor(parentTweet);

  return tweetAuthor === parentAuthor ? 'thread' : 'conversation';
}

/**
 * Walk up the reply chain to find the root tweet
 * Returns array of tweets from root to current (inclusive)
 */
export function findAncestorChain(tweet, config, maxDepth = 50) {
  const chain = [tweet];
  let current = tweet;
  let depth = 0;

  while (current.inReplyToStatusId && depth < maxDepth) {
    const parent = fetchTweet(config, current.inReplyToStatusId);
    if (!parent) break;

    chain.unshift(parent);
    current = parent;
    depth++;
  }

  return chain;
}

/**
 * Determine if the ancestor chain is a same-author thread
 */
function isSameAuthorThread(chain) {
  if (chain.length <= 1) return false;

  const firstAuthor = getAuthor(chain[0]);
  return chain.every(tweet => getAuthor(tweet) === firstAuthor);
}

/**
 * Resolve complete thread context for a bookmark
 *
 * For same-author threads: returns all tweets in the thread
 * For conversations: returns ancestor chain only (up to bookmarked tweet)
 * For standalone: returns just the tweet (or thread if it's a thread root)
 */
export function resolveThread(bookmark, config) {
  const expandThreads = config.expandThreads !== false;
  const maxDepth = config.maxThreadDepth || 50;
  const bookmarkAuthor = getAuthor(bookmark);

  // Always try to fetch the full thread context using bird thread
  // This catches both:
  // 1. Threads where we bookmarked a reply (has ancestors)
  // 2. Threads where we bookmarked the root (has descendants)
  if (expandThreads) {
    const fullThread = fetchThread(config, bookmark.id);

    if (fullThread && fullThread.length > 1) {
      // Filter to only same-author tweets
      const sameAuthorTweets = fullThread.filter(t => getAuthor(t) === bookmarkAuthor);

      if (sameAuthorTweets.length > 1) {
        // Sort by date (oldest first for now, will be reversed in markdown-writer)
        sameAuthorTweets.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateA - dateB;
        });

        return {
          type: 'thread',
          tweets: sameAuthorTweets,
          rootTweet: sameAuthorTweets[0]
        };
      }
    }
  }

  // If no reply and no thread found, it's standalone
  if (!bookmark.inReplyToStatusId) {
    return {
      type: 'standalone',
      tweets: [bookmark],
      rootTweet: bookmark
    };
  }

  // Walk up to find ancestor chain (for conversations with other authors)
  const ancestorChain = findAncestorChain(bookmark, config, maxDepth);
  const rootTweet = ancestorChain[0];

  // Determine if this is a same-author thread or conversation
  const isSameAuthor = isSameAuthorThread(ancestorChain);

  if (isSameAuthor) {
    return {
      type: 'thread',
      tweets: ancestorChain,
      rootTweet
    };
  }

  // For conversations (multi-author), return the ancestor chain
  return {
    type: 'conversation',
    tweets: ancestorChain,
    rootTweet
  };
}

/**
 * Get the primary tweet (the one that was bookmarked) from thread data
 */
export function getBookmarkedTweet(threadData, bookmarkId) {
  return threadData.tweets.find(t => t.id === bookmarkId) ||
         threadData.tweets[threadData.tweets.length - 1];
}
