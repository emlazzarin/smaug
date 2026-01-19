# Smaug 🐉

Archive your Twitter/X bookmarks to individual markdown files with media and full thread context.

*Like a dragon hoarding treasure, Smaug collects the valuable things you bookmark.*

## Contents

- [Quick Start](#quick-start)
- [What It Does](#what-it-does)
- [Commands](#commands)
- [Output](#output)
- [Configuration](#configuration)
- [Getting Twitter Credentials](#getting-twitter-credentials)
- [Install Globally](#install-globally)
- [Bookmark Folders](#bookmark-folders)
- [Automation](#automation)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

## Quick Start

```bash
# 1. Install bird CLI (Twitter API wrapper)
npm install -g @steipete/bird@latest
# Or with Homebrew: brew install steipete/tap/bird

# 2. Clone and install Smaug
git clone https://github.com/alexknowshtml/smaug
cd smaug
npm install

# 3. Run the setup wizard
npx smaug setup

# 4. Fetch your bookmarks
npx smaug fetch --all

# 5. Process to individual markdown files
npx smaug process
```

## What It Does

Each bookmark becomes its own markdown file with:

- **Full tweet text** in blockquote format
- **Thread expansion** - same-author threads saved together
- **Conversation context** - replies include parent tweets
- **Quote tweets** clearly marked
- **Downloaded media** - images, GIFs, video thumbnails
- **Obsidian-compatible** `![[embed]]` syntax for media

## Commands

```bash
# Fetch bookmarks
smaug fetch              # Fetch latest 20 bookmarks
smaug fetch 50           # Fetch 50 bookmarks
smaug fetch --all        # Fetch ALL bookmarks (paginated)
smaug fetch --source likes    # Fetch from likes instead
smaug fetch --source both     # Fetch from both bookmarks AND likes
smaug fetch --force      # Re-fetch already archived tweets

# Process to markdown files
smaug process            # Process pending bookmarks to ./bookmarks/
smaug process -n         # Dry run - preview what would be processed

# Status
smaug status             # Show current configuration and counts
smaug setup              # Interactive setup wizard
```

## Output

### Directory Structure

```
bookmarks/
  20260110092719_VitalikButerin.md    # Individual tweet files
  20260110200958_MikeBenzCyber.md     # Named: YYYYMMDDHHMMSS_author.md
  media/
    20260110092719_VitalikButerin_1.jpg   # Downloaded images
    20260110092719_VitalikButerin_2.png   # Named: YYYYMMDDHHMMSS_author_N.ext
```

### Markdown Format

Each file includes YAML frontmatter and formatted content:

```markdown
---
title: "First 60 chars of tweet..."
author: "@VitalikButerin"
author_name: "vitalik.eth"
date: 2026-01-10T09:27:19Z
tweet_url: https://x.com/VitalikButerin/status/2009919975058735479
type: standalone
tags: [ai-tools]
---

# @VitalikButerin

> I agree with maybe 60% of this, but one bit that is particularly
> important to highlight is the explicit separation between what
> the poster calls "the open web" and "the sovereign web"...

---

> **Quoted @tom777kruise (Tom Kruise):**
> 2026-30 predictions...

## Media

![[20260110092719_VitalikButerin_1.jpg]]

## Links

- [https://example.com](https://example.com)

---
*Archived via Smaug*
```

### Thread Handling

**Same-author threads**: All tweets saved in one file, numbered:

```markdown
# Thread by @author

## 1/5
> First tweet

## 2/5
> Second tweet
...
```

**Conversations** (multi-author): Parent context shown, then your bookmarked reply:

```markdown
# Conversation

> **@otheruser (Other User):**
> Parent tweet content

---

## Reply by @you:

> Your reply here
```

## Configuration

Create `smaug.config.json` (or run `smaug setup`):

```json
{
  "bookmarksDir": "./bookmarks",
  "mediaDir": "./bookmarks/media",
  "downloadMedia": true,
  "expandThreads": true,
  "fileTimezone": "UTC",
  "source": "bookmarks",
  "twitter": {
    "authToken": "your_auth_token",
    "ct0": "your_ct0"
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `bookmarksDir` | `./bookmarks` | Directory for markdown files |
| `mediaDir` | `./bookmarks/media` | Directory for downloaded media |
| `downloadMedia` | `true` | Download images/GIFs (thumbnails for videos) |
| `expandThreads` | `true` | Fetch full same-author threads |
| `fileTimezone` | `UTC` | Timezone for filename timestamps |
| `source` | `bookmarks` | What to fetch: `bookmarks`, `likes`, or `both` |
| `maxThreadDepth` | `50` | Maximum tweets to fetch per thread |
| `mediaTimeout` | `30000` | Download timeout in ms |
| `maxMediaSize` | `10485760` | Max file size (10MB default) |

Environment variables: `BOOKMARKS_DIR`, `MEDIA_DIR`, `DOWNLOAD_MEDIA`, `EXPAND_THREADS`, `FILE_TIMEZONE`, `SOURCE`, `AUTH_TOKEN`, `CT0`

## Getting Twitter Credentials

Smaug uses the bird CLI which needs your Twitter session cookies.

1. Open Twitter/X in your browser
2. Open Developer Tools (F12) → Application → Cookies → twitter.com
3. Find and copy:
   - `auth_token`
   - `ct0`
4. Add to `smaug.config.json` or run `smaug setup`

> **Note:** `smaug.config.json` is gitignored to prevent accidentally committing credentials.

## Install Globally

To use `smaug` without `npx`:

```bash
# From the smaug directory
npm install -g .

# Now works from anywhere
smaug fetch --all
smaug process
```

Or for development (changes reflect immediately):

```bash
npm link
```

## Bookmark Folders

If you've organized your Twitter bookmarks into folders, Smaug can preserve that as tags:

```json
{
  "folders": {
    "1234567890": "ai-tools",
    "0987654321": "articles-to-read"
  }
}
```

**Finding folder IDs:** Open a folder in Twitter - the URL is `https://x.com/i/bookmarks/1234567890`

When configured, bookmarks get tagged and the tags appear in frontmatter.

## Automation

Run Smaug automatically:

### PM2 (recommended)

```bash
npm install -g pm2
pm2 start "smaug fetch --all && smaug process" --cron "*/30 * * * *" --name smaug
pm2 save
pm2 startup
```

### Cron

```bash
crontab -e
# Add:
*/30 * * * * cd /path/to/smaug && smaug fetch --all && smaug process >> smaug.log 2>&1
```

## Troubleshooting

### "No pending bookmarks"

Run `smaug fetch` first to fetch bookmarks, then `smaug process`.

### Bird CLI 403 errors

Your Twitter cookies may have expired. Get fresh ones from your browser.

### Only ~50-70 bookmarks fetched

The npm release of bird CLI may not support pagination. Install from git:

```bash
cd /tmp
git clone https://github.com/steipete/bird.git
cd bird
npm install && npm run build:dist
npm link --force
```

Then `smaug fetch --all` will paginate through all bookmarks.

### Media not downloading

Check that:
1. `downloadMedia: true` in config
2. The tweets actually have media attached (check with `smaug process -n`)
3. Media URLs are accessible (some expire)

## Knowledge Extraction (Legacy)

Smaug can also extract content from linked URLs to a `knowledge/` directory:

- GitHub repos → `knowledge/tools/`
- Articles → `knowledge/articles/`

This uses Claude Code for intelligent categorization. See `.claude/commands/process-bookmarks.md` for details. Run with:

```bash
npx smaug run    # Fetch + process with Claude
```

## Credits

- [bird CLI](https://github.com/steipete/bird) by Peter Steinberger
- Built with Claude Code

## License

MIT
