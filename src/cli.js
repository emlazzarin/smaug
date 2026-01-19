#!/usr/bin/env node

/**
 * Smaug CLI
 *
 * Commands:
 *   setup    - Interactive setup wizard (recommended for first-time users)
 *   run      - Run the full job (fetch + process with Claude Code)
 *   fetch    - Fetch bookmarks and prepare them for processing
 *   process  - Process pending bookmarks with Claude Code
 *   status   - Show current configuration and status
 *   init     - Create a config file (non-interactive)
 */

import { fetchAndPrepareBookmarks, processAllBookmarks, getExistingBookmarkFiles } from './processor.js';
import { initConfig, loadConfig } from './config.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';

const args = process.argv.slice(2);
const command = args[0];

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function setup() {
  console.log(`
🐉 Smaug Setup Wizard
━━━━━━━━━━━━━━━━━━━━━

This will set up Smaug to automatically archive your Twitter bookmarks.
`);

  // Step 1: Check for bird CLI with bookmarks support (v0.5.0+)
  console.log('Step 1: Checking for bird CLI...');
  try {
    const versionOutput = execSync('bird --version', { stdio: 'pipe', encoding: 'utf8' });
    const versionMatch = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);

    if (versionMatch) {
      const [, major, minor] = versionMatch.map(Number);
      if (major === 0 && minor < 5) {
        console.log(`  ✗ bird CLI v${versionMatch[0]} found, but v0.5.0+ required for bookmarks support

  Update it:
    npm install -g @steipete/bird@latest

  Or with Homebrew:
    brew upgrade steipete/tap/bird

  Then run this setup again.
`);
        process.exit(1);
      }
      console.log(`  ✓ bird CLI v${versionMatch[0]} found (bookmarks supported)\n`);
    } else {
      console.log('  ✓ bird CLI found\n');
    }
  } catch {
    console.log(`  ✗ bird CLI not found

  Install it:
    npm install -g @steipete/bird@latest

  Or with Homebrew:
    brew install steipete/tap/bird

  Then run this setup again.
`);
    process.exit(1);
  }

  // Step 2: Get Twitter credentials
  console.log(`Step 2: Twitter Authentication

  You need your Twitter cookies to fetch bookmarks.

  To get them:
  1. Open Twitter/X in your browser
  2. Press F12 to open Developer Tools
  3. Go to Application → Cookies → twitter.com
  4. Find 'auth_token' and 'ct0'
`);

  const authToken = await prompt('  Paste your auth_token: ');
  if (!authToken) {
    console.log('  ✗ auth_token is required');
    process.exit(1);
  }

  const ct0 = await prompt('  Paste your ct0: ');
  if (!ct0) {
    console.log('  ✗ ct0 is required');
    process.exit(1);
  }

  // Step 3: Test credentials
  console.log('\nStep 3: Testing credentials...');
  try {
    const env = { ...process.env, AUTH_TOKEN: authToken, CT0: ct0 };
    execSync('bird bookmarks -n 1 --json', { env, stdio: 'pipe', timeout: 30000 });
    console.log('  ✓ Credentials work!\n');
  } catch (error) {
    console.log(`  ✗ Could not fetch bookmarks. Check your credentials and try again.
  Error: ${error.message}
`);
    process.exit(1);
  }

  // Step 4: Create config
  console.log('Step 4: Creating configuration...');
  const config = {
    bookmarksDir: './bookmarks',
    mediaDir: './bookmarks/media',
    downloadMedia: true,
    expandThreads: true,
    fileTimezone: 'UTC',
    pendingFile: './.state/pending-bookmarks.json',
    stateFile: './.state/bookmarks-state.json',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    twitter: {
      authToken,
      ct0
    },
    autoInvokeClaude: false
  };

  fs.writeFileSync('./smaug.config.json', JSON.stringify(config, null, 2) + '\n');
  console.log('  ✓ Created smaug.config.json');
  console.log('  ⚠️  This file contains your credentials and is gitignored.');
  console.log('     Never commit it or share it publicly.\n');

  // Step 5: Ask about automation
  console.log('Step 5: Automation Setup\n');
  const wantsCron = await prompt('  Set up automatic fetching every 30 minutes? (y/n): ');

  if (wantsCron.toLowerCase() === 'y') {
    const cwd = process.cwd();
    const cronLine = `*/30 * * * * cd ${cwd} && npx smaug run >> ${cwd}/smaug.log 2>&1`;

    console.log(`
  Add this line to your crontab:

  ${cronLine}

  To edit your crontab, run:
    crontab -e

  Or use PM2 for a simpler setup:
    npm install -g pm2
    pm2 start "npx smaug run" --cron "*/30 * * * *" --name smaug
    pm2 save
`);
  }

  // Step 6: First fetch
  console.log('\nStep 6: Fetching your bookmarks...\n');

  try {
    const result = await fetchAndPrepareBookmarks({ count: 20 });

    if (result.count > 0) {
      console.log(`  ✓ Fetched ${result.count} bookmarks!\n`);
    } else {
      console.log('  ✓ No new bookmarks to fetch (your bookmark list may be empty)\n');
    }
  } catch (error) {
    console.log(`  Warning: Could not fetch bookmarks: ${error.message}\n`);
  }

  // Done!
  console.log(`
━━━━━━━━━━━━━━━━━━━━━
🐉 Setup Complete!
━━━━━━━━━━━━━━━━━━━━━

Your bookmarks will be saved to: ./bookmarks/
Each tweet gets its own markdown file with media.

Commands:
  npx smaug fetch    Fetch new bookmarks
  npx smaug process  Process pending to individual files
  npx smaug status   Check status

Happy hoarding! 🐉
`);
}

async function main() {
  switch (command) {
    case 'setup':
      await setup();
      break;

    case 'init':
      initConfig(args[1]);
      break;

    case 'run': {
      // Run the full job (same as node src/job.js)
      const jobPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'job.js');
      const trackTokens = args.includes('--track-tokens') || args.includes('-t');

      // Parse --limit flag
      const limitIdx = args.findIndex(a => a === '--limit' || a === '-l');
      let limit = null;
      if (limitIdx !== -1 && args[limitIdx + 1]) {
        limit = parseInt(args[limitIdx + 1], 10);
        if (isNaN(limit) || limit <= 0) {
          console.error('Invalid --limit value. Must be a positive number.');
          process.exit(1);
        }
      }

      try {
        const jobModule = await import(pathToFileURL(jobPath).href);
        const result = await jobModule.default.run({ trackTokens, limit });
        process.exit(result.success ? 0 : 1);
      } catch (err) {
        console.error('Failed to run job:', err.message);
        process.exit(1);
      }
      break;
    }

    case 'fetch': {
      const count = parseInt(args.find(a => a.match(/^\d+$/)) || '20', 10);
      const specificIds = args.filter(a => a.match(/^\d{10,}$/));
      const force = args.includes('--force') || args.includes('-f');
      const fetchAll = args.includes('--all') || args.includes('-a') || args.includes('-all');

      // Parse --source flag
      const sourceIdx = args.findIndex(a => a === '--source' || a === '-s');
      let source = null;
      if (sourceIdx !== -1 && args[sourceIdx + 1]) {
        source = args[sourceIdx + 1];
        if (!['bookmarks', 'likes', 'both'].includes(source)) {
          console.error(`Invalid source: ${source}. Must be 'bookmarks', 'likes', or 'both'.`);
          process.exit(1);
        }
      }

      // Parse --max-pages flag
      const maxPagesIdx = args.findIndex(a => a === '--max-pages');
      const maxPages = maxPagesIdx !== -1 && args[maxPagesIdx + 1]
        ? parseInt(args[maxPagesIdx + 1], 10)
        : null;

      const result = await fetchAndPrepareBookmarks({
        count,
        specificIds: specificIds.length > 0 ? specificIds : null,
        force,
        source,
        includeMedia: true,
        all: fetchAll,
        maxPages
      });

      if (result.count > 0) {
        console.log(`\n✓ Prepared ${result.count} tweets.`);
        console.log(`  Output: ${result.pendingFile}`);
        console.log('\nNext: Run `npx smaug run` to process with Claude');
      } else {
        console.log('\nNo new tweets to process.');
      }
      break;
    }

    case 'process': {
      const dryRun = args.includes('--dry-run') || args.includes('-n');

      if (dryRun) {
        // Show pending without processing
        const config = loadConfig();

        if (!fs.existsSync(config.pendingFile)) {
          console.log('No pending bookmarks. Run `smaug fetch` first.');
          process.exit(0);
        }

        const pending = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));

        if (pending.bookmarks.length === 0) {
          console.log('No pending bookmarks to process.');
          process.exit(0);
        }

        console.log(`Found ${pending.bookmarks.length} pending bookmarks:\n`);
        for (const b of pending.bookmarks.slice(0, 10)) {
          console.log(`  - @${b.author}: ${b.text.slice(0, 50)}...`);
        }
        if (pending.bookmarks.length > 10) {
          console.log(`  ... and ${pending.bookmarks.length - 10} more`);
        }
        console.log('\nRun `smaug process` (without --dry-run) to process them.');
      } else {
        // Actually process bookmarks to individual files
        const result = await processAllBookmarks();

        if (result.processed === 0 && result.skipped === 0 && result.failed === 0) {
          console.log('\nNo bookmarks to process. Run `smaug fetch` first.');
        } else {
          console.log(`\nDone! Files saved to: ./bookmarks/`);
        }
      }
      break;
    }

    case 'status': {
      const config = loadConfig();
      const verbose = args.includes('-v') || args.includes('--verbose');

      console.log('Smaug Status\n');
      console.log(`Bookmarks:   ${config.bookmarksDir}`);
      console.log(`Media:       ${config.mediaDir}`);
      console.log(`Download:    ${config.downloadMedia ? '✓ enabled' : 'disabled'}`);
      console.log(`Threads:     ${config.expandThreads ? '✓ expand same-author' : 'disabled'}`);
      console.log(`Source:      ${config.source || 'bookmarks'}`);
      console.log(`Twitter:     ${config.twitter?.authToken ? '✓ configured' : '✗ not configured'}`);

      if (fs.existsSync(config.pendingFile)) {
        const pending = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));
        console.log(`Pending:     ${pending.bookmarks.length} bookmarks`);
      } else {
        console.log('Pending:     0 bookmarks');
      }

      if (fs.existsSync(config.stateFile)) {
        const state = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
        console.log(`Last fetch:  ${state.last_check || 'never'}`);
      }

      // Count archived bookmark files
      const bookmarkFiles = getExistingBookmarkFiles(config);
      console.log(`Archived:    ${bookmarkFiles.length} bookmark files`);

      // Count media files
      if (fs.existsSync(config.mediaDir)) {
        const mediaFiles = fs.readdirSync(config.mediaDir).filter(f => !f.startsWith('.'));
        console.log(`Media files: ${mediaFiles.length}`);
      }

      // Show folder breakdown
      const folders = config.folders || {};
      if (Object.keys(folders).length > 0 && bookmarkFiles.length > 0) {
        console.log(`\nConfigured folders: ${Object.keys(folders).length}`);

        if (verbose) {
          // Count bookmarks per tag by reading frontmatter
          const tagCounts = {};
          let untagged = 0;

          for (const file of bookmarkFiles) {
            try {
              const content = fs.readFileSync(file, 'utf8');
              const tagsMatch = content.match(/^tags:\s*\[([^\]]*)\]/m);
              if (tagsMatch && tagsMatch[1].trim()) {
                const tags = tagsMatch[1].split(',').map(t => t.trim());
                for (const tag of tags) {
                  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                }
              } else {
                untagged++;
              }
            } catch (e) {
              // Skip files that can't be read
            }
          }

          console.log('\nBookmarks by folder:');
          for (const [folderId, folderName] of Object.entries(folders)) {
            const count = tagCounts[folderName] || 0;
            console.log(`  ${folderName}: ${count}`);
          }
          if (untagged > 0) {
            console.log(`  (untagged): ${untagged}`);
          }
        } else {
          console.log('  (use -v for per-folder breakdown)');
        }
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    default:
      console.log(`
🐉 Smaug - Twitter Bookmarks & Likes Archiver

Each bookmark is saved as an individual markdown file with:
  - Full thread context (same-author threads expanded)
  - Downloaded media (images, GIFs, video thumbnails)
  - Obsidian-compatible ![[embed]] syntax

Commands:
  setup          Interactive setup wizard (start here!)
  fetch [n]      Fetch n tweets (default: 20)
  fetch --all    Fetch ALL bookmarks (paginated)
  fetch --source <source>  Fetch from: bookmarks, likes, or both
  fetch --force  Re-fetch even if already archived
  process        Process pending bookmarks to individual files
  process -n     Dry run - show pending without processing
  status         Show current status
  status -v      Show per-folder breakdown

Examples:
  smaug setup                    # First-time setup
  smaug fetch                    # Fetch latest bookmarks
  smaug fetch 50                 # Fetch 50 tweets
  smaug fetch --all              # Fetch ALL bookmarks (paginated)
  smaug fetch --source likes     # Fetch from likes only
  smaug process                  # Process to ./bookmarks/
  smaug process -n               # Preview what would be processed

Output:
  bookmarks/
    20260111143022_author.md     # Individual tweet files
    media/
      20260111143022_author_1.jpg  # Downloaded media

Config (smaug.config.json):
  "bookmarksDir": "./bookmarks"     Output directory
  "downloadMedia": true             Download images/GIFs
  "expandThreads": true             Fetch full threads
  "source": "bookmarks"             Default source

More info: https://github.com/alexknowshtml/smaug
`);
      break;
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
