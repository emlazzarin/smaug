# Smaug 🐉

Archive your Twitter/X bookmarks to individual markdown files with media and full thread context.

*Like a dragon hoarding treasure, Smaug collects the valuable things you bookmark.*

> **Multi-model support:** Smaug works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (default) and [OpenCode](https://github.com/anomalyco/opencode), giving you access to a wide range of AI models. Results may vary depending on the model you choose — test carefully and find what works best for your workflow. See [AI CLI Integration](#ai-cli-integration) for setup details.

## Contents

- [Quick Start](#quick-start)
- [What It Does](#what-it-does)
- [Commands](#commands)
- [Output](#output)
- [Configuration](#configuration)
- [Getting Twitter Credentials](#getting-twitter-credentials)
- [What Smaug Actually Does](#what-smaug-actually-does)
- [Install Globally](#install-globally)
- [Bookmark Folders](#bookmark-folders)
- [Automation](#automation)
- [Categories](#categories)
- [AI CLI Integration](#ai-cli-integration)
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

## What Smaug Actually Does

1. **Fetches bookmarks** from Twitter/X using the bird CLI (can also fetch likes, or both)
2. **Expands t.co links** to reveal actual URLs
3. **Extracts content** from linked pages:
   - GitHub repos (via API: stars, description, README)
   - External articles (title, author, content)
   - X/Twitter long-form articles (full content via bird CLI)
   - Quote tweets and reply threads (full context)
4. **Invokes Claude Code** to analyze and categorize each tweet
5. **Saves to markdown** organized by date with rich context
6. **Files to knowledge library** - GitHub repos to `knowledge/tools/`, articles to `knowledge/articles/`

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

**Note:** This requires bird CLI built from git (not the npm release). See [Troubleshooting](#troubleshooting) for installation instructions.

**Cost warning:** Processing large bookmark backlogs can consume significant Claude tokens. Each bookmark with content-heavy links (long articles, GitHub READMEs, etc.) adds to the context. Process in batches to control costs:

```bash
npx smaug run --limit 50 -t    # Process 50 at a time with token tracking
```

Use the `-t` flag to monitor usage. See [Token Usage Tracking](#token-usage-tracking) for cost estimates by model.

## Categories

Categories define how different bookmark types are handled. Smaug comes with sensible defaults, but you can customize them in `smaug.config.json`.

### Default Categories

| Category | Matches | Action | Destination |
|----------|---------|--------|-------------|
| **github** | github.com | file | `./knowledge/tools/` |
| **article** | medium.com, substack.com, dev.to, blogs | file | `./knowledge/articles/` |
| **x-article** | x.com/i/article/* | file | `./knowledge/articles/` |
| **tweet** | (fallback) | capture | bookmarks.md only |

🔜 _Note: Transcription is flagged but not yet automated. PRs welcome!_

### X/Twitter Long-Form Articles

X articles (`x.com/i/article/*`) are Twitter's native long-form content format. Smaug extracts the full article text using bird CLI:

1. **Direct extraction**: If the bookmarked tweet is the article author's original post, content is extracted directly
2. **Search fallback**: If you bookmark someone sharing/quoting an article, Smaug searches for the original author's tweet and extracts the full content from there
3. **Metadata fallback**: If search fails, basic metadata (title, description) is captured

Example X article bookmark:
```markdown
## @joaomdmoura - Lessons From 2 Billion Agentic Workflows
> [Full article content extracted]

- **Tweet:** https://x.com/joaomdmoura/status/123456789
- **Link:** https://x.com/i/article/987654321
- **Filed:** [lessons-from-2-billion-agentic-workflows.md](./knowledge/articles/lessons-from-2-billion-agentic-workflows.md)
- **What:** Deep dive into patterns from scaling CrewAI to billions of agent executions.
```

### Actions

- **file**: Create a separate markdown file with rich metadata
- **capture**: Add to bookmarks.md only (no separate file)
- **transcribe**: Flag for future transcription *(auto-transcription coming soon! PRs welcome)*

### Custom Categories

Add your own categories in `smaug.config.json`:

```json
{
  "categories": {
    "research": {
      "match": ["arxiv.org", "papers.", "scholar.google"],
      "action": "file",
      "folder": "./knowledge/research",
      "template": "article",
      "description": "Academic papers"
    },
    "newsletter": {
      "match": ["buttondown.email", "beehiiv.com"],
      "action": "file",
      "folder": "./knowledge/newsletters",
      "template": "article",
      "description": "Newsletter issues"
    }
  }
}
```

Your custom categories merge with the defaults. To override a default, use the same key (e.g., `github`, `article`).

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

### Option C: systemd

```bash
# Create /etc/systemd/system/smaug.service
# See docs/systemd-setup.md for details
```

## Output

### bookmarks.md

Your bookmarks organized by date:

```markdown
# Thursday, January 2, 2026

## @simonw - Gist Host Fork for Rendering GitHub Gists
> I forked the wonderful gistpreview.github.io to create gisthost.github.io

- **Tweet:** https://x.com/simonw/status/123456789
- **Link:** https://gisthost.github.io/
- **Filed:** [gisthost-gist-rendering.md](./knowledge/articles/gisthost-gist-rendering.md)
- **What:** Free GitHub Pages-hosted tool that renders HTML files from Gists.

---

## @tom_doerr - Whisper-Flow Real-time Transcription
> This is amazing - real-time transcription with Whisper

- **Tweet:** https://x.com/tom_doerr/status/987654321
- **Link:** https://github.com/dimastatz/whisper-flow
- **Filed:** [whisper-flow.md](./knowledge/tools/whisper-flow.md)
- **What:** Real-time speech-to-text using OpenAI Whisper with streaming support.
```

### knowledge/tools/*.md

GitHub repos get their own files:

```markdown
---
title: "whisper-flow"
type: tool
date_added: 2026-01-02
source: "https://github.com/dimastatz/whisper-flow"
tags: [ai, transcription, whisper, streaming]
via: "Twitter bookmark from @tom_doerr"
---

Real-time speech-to-text transcription using OpenAI Whisper...

## Key Features
- Streaming audio input
- Multiple language support
- Low latency output

## Links
- [GitHub](https://github.com/dimastatz/whisper-flow)
- [Original Tweet](https://x.com/tom_doerr/status/987654321)
```

## Configuration

Copy the example config and customize:

```bash
cp smaug.config.example.json smaug.config.json
```

Example `smaug.config.json`:

```json
{
  "source": "bookmarks",
  "archiveFile": "./bookmarks.md",
  "pendingFile": "./.state/pending-bookmarks.json",
  "stateFile": "./.state/bookmarks-state.json",
  "timezone": "America/New_York",
  "twitter": {
    "authToken": "your_auth_token",
    "ct0": "your_ct0"
  },
  "autoInvokeClaude": true,
  "claudeModel": "sonnet",
  "claudeTimeout": 900000,
  "allowedTools": "Read,Write,Edit,Glob,Grep,Bash,Task,TodoWrite",
  "webhookUrl": null,
  "webhookType": "discord"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `source` | `bookmarks` | What to fetch: `bookmarks` (default), `likes`, or `both` |
| `includeMedia` | `false` | **EXPERIMENTAL**: Include media attachments (photos, videos, GIFs) |
| `archiveFile` | `./bookmarks.md` | Main archive file |
| `timezone` | `America/New_York` | For date formatting |
| `cliTool` | `claude` | AI CLI to use: `claude` or `opencode` |
| `autoInvokeClaude` | `true` | Auto-run Claude Code for analysis |
| `claudeModel` | `sonnet` | Model to use (`sonnet`, `haiku`, or `opus`) |
| `autoInvokeOpencode` | `true` | Auto-run OpenCode for analysis |
| `opencodeModel` | `opencode/glm-4.7-free` | OpenCode model (see OpenCode docs) |
| `claudeTimeout` | `900000` | Max processing time (15 min) |
| `parallelThreshold` | `8` | Min bookmarks before parallel processing kicks in |
| `webhookUrl` | `null` | Discord/Slack webhook for notifications |

Environment variables also work: `AUTH_TOKEN`, `CT0`, `SOURCE`, `INCLUDE_MEDIA`, `ARCHIVE_FILE`, `TIMEZONE`, `CLI_TOOL`, `CLAUDE_MODEL`, `OPENCODE_MODEL`, etc.

### Experimental: Media Attachments

Media extraction (photos, videos, GIFs) is available but disabled by default. To enable:

```bash
# One-time with flag
npx smaug fetch --media

# Or in config
{
  "includeMedia": true
}
```

When enabled, the `media[]` array is included in the pending JSON with:
- `type`: "photo", "video", or "animated_gif"
- `url`: Full-size media URL
- `previewUrl`: Thumbnail (smaller, faster)
- `width`, `height`: Dimensions
- `videoUrl`, `durationMs`: For videos only

⚠️ **Why experimental?**
1. **Requires bird with media support** - PR [#14](https://github.com/steipete/bird/pull/14) adds media extraction. Until merged, you'll need a fork with this PR or wait for an upstream release. Without it, `--media` is a no-op (empty array).
2. **Workflow still being refined** - Short screengrabs (< 30s) don't need transcripts, but longer videos might. We're still figuring out the best handling.

## AI CLI Integration

Smaug supports multiple AI CLI tools for intelligent bookmark processing:

- **Claude Code** (default) - Anthropic's Claude CLI
- **OpenCode** - Alternative AI CLI with support for multiple models

### Using OpenCode (Alternative to Claude)

To use OpenCode instead of Claude Code:

```json
{
  "cliTool": "opencode",
  "opencodeModel": "opencode/glm-4.7-free",
  "autoInvokeOpencode": true
}
```

Available OpenCode models include:
- `opencode/glm-4.7-free` (free tier)
- `opencode/kimi-k2.5-free` (free tier)
- `opencode/claude-sonnet-4-5` (Claude via OpenCode)
- `opencode/gpt-5.2` (GPT via OpenCode)

Set via environment variable:
```bash
export CLI_TOOL=opencode
export OPENCODE_MODEL=opencode/kimi-k2.5-free
```

### Claude Code Integration

Smaug uses Claude Code by default for intelligent bookmark processing. The `.claude/commands/process-bookmarks.md` file contains instructions for:

- Generating descriptive titles (not generic "Article" or "Tweet")
- Filing GitHub repos to `knowledge/tools/`
- Filing articles to `knowledge/articles/`
- Handling quote tweets with full context
- Processing reply threads with parent context
- Parallel processing for large batches (configurable threshold, default 8 bookmarks)

You can also run processing manually:

```bash
claude
> Run /process-bookmarks
```

### Token Usage Tracking

Track your API costs with the `-t` flag:

```bash
npx smaug run -t
# or
npx smaug run --track-tokens
```

This displays a breakdown at the end of each run:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 TOKEN USAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Main (sonnet):
  Input:               85 tokens  <$0.01
  Output:           5,327 tokens  $0.08
  Cache Read:     724,991 tokens  $0.22
  Cache Write:     62,233 tokens  $0.23

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 TOTAL COST: $0.53
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Cost Optimization: Haiku Subagents

For large batches (8+ bookmarks by default), Smaug spawns parallel subagents. By default, these use Haiku instead of Sonnet, which cuts costs nearly in half:

| Configuration | 20 Bookmarks | Time |
|---------------|--------------|------|
| Sonnet subagents | $1.00 | 4m 12s |
| **Haiku subagents** | **$0.53** | 4m 18s |

Same speed, ~50% cheaper. The categorization and filing tasks don't require Sonnet-level reasoning, so Haiku handles them well.

This is configured in `.claude/commands/process-bookmarks.md` with `model="haiku"` in the Task calls.

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
