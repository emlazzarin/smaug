/**
 * Smaug - Twitter Bookmarks Archiver
 *
 * Main entry point for programmatic usage.
 */

// Core processing
export {
  fetchAndPrepareBookmarks,
  processAllBookmarks,
  processBookmarkToFile,
  getExistingBookmarkFiles,
  fetchBookmarks,
  fetchTweet,
  expandTcoLink,
  fetchGitHubContent,
  fetchArticleContent,
  isPaywalled,
  loadState,
  saveState
} from './processor.js';

// Thread resolution
export {
  resolveThread,
  fetchThread,
  classifyTweet,
  findAncestorChain
} from './thread-resolver.js';

// Media downloading
export {
  downloadTweetMedia,
  downloadThreadMedia,
  downloadMedia,
  getMediaStats
} from './media-downloader.js';

// Markdown generation
export {
  generateBookmarkMarkdown,
  writeBookmarkFile,
  bookmarkFileExists,
  generateBookmarkFilename
} from './markdown-writer.js';

// Article clipping
export {
  clipArticle,
  clipArticlesFromBookmark,
  extractArticle,
  isClippableArticle,
  generateClippingFilename
} from './article-clipper.js';

// Configuration
export { loadConfig, initConfig } from './config.js';

// Shared utilities
export {
  getAuthor,
  getAuthorName,
  formatTimestamp,
  formatBytes,
  buildBirdEnv
} from './utils.js';

// Scheduled job runner (legacy)
export { run as runJob } from './job.js';
export { default as job } from './job.js';
