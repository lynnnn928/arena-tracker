---
name: game-strategy-optimizer
description: Track match history from battle games (API backfill → SQLite → dashboard), analyze version performance, and iterate AI agent strategies using empirical data. Use when the user wants to set up game data tracking, analyze version regression, optimize bot/tank strategy, or build a data-driven iteration loop.
---

# Game Strategy Optimizer

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start dashboard
node scripts/server.js

# 3. Open http://localhost:3000 → click "+ Register Tank" → enter Tank Key
```

## Directory Structure

```
game-strategy-optimizer-1.0.0/
├── SKILL.md
├── references/           # Reference docs
│   ├── db.md             # Schema + queries
│   ├── iteration.md      # Iteration template
│   ├── maps.md           # Map strategies
│   └── server.md         # Server + API
├── package.json          # Dependencies
├── config.json           # Tank credentials (auto-filled)
├── scripts/              # All executable code
│   ├── arena.js          # CLI tool (21 commands)
│   ├── server.js         # HTTP server + API
│   ├── sync.js           # Data sync
│   ├── build_dashboard.js
│   ├── publish.js
│   ├── batch.js / backfill.js
│   ├── record_iteration.js
│   ├── db.js             # SQLite wrapper
│   ├── lib/http.js       # HTTP module
│   ├── arena-mcp-server/     # MCP Server (self-contained, independent)
│   ├── package.json
│   ├── dist/index.js
│   └── src/index.ts
├── assets/               # Static assets
└── versions/             # Your code versions
```

## CLI Commands

Run all commands from the skill root directory:

```bash
# Server
node scripts/server.js
node scripts/sync.js --tank <name>
node scripts/build_dashboard.js

# Analysis
node scripts/arena.js versions
node scripts/arena.js compare <v1> <v2> --tank <name>
node scripts/arena.js maps --tank <name>
node scripts/arena.js opponents --limit 10
node scripts/arena.js rank --tank <name>
node scripts/arena.js matches --cv <n> --result loss --limit 10
node scripts/arena.js tanks

# Operations
node scripts/arena.js batch <N> <cv> --map <map> --tank <name>
node scripts/arena.js record <cv> --signal "..." --conclusion solved
node scripts/arena.js export <cv> --format csv
node scripts/publish.js versions/v<X>.js --tank <name>
```

All commands support `--json` and `--tank <name>`.

## MCP Server

```bash
cd arena-mcp-server && npm install && node dist/index.js
```

Tools: `get_stats`, `get_version_summary`, `get_map_stats`, `compare_versions`, `get_rank_history`, `get_matches`, `get_tanks`, `get_opponents`, `get_version_detail`

## Workflow

1. `node scripts/arena.js versions` — check stats
2. `node scripts/arena.js compare 72 74` — find regression
3. `node scripts/publish.js versions/v<new>.js --tank <name>` — deploy
4. `node scripts/sync.js --tank <name>` — gather data
5. `node scripts/arena.js compare <old> <new>` — verify
6. `node scripts/arena.js record <cv> --signal "..." --conclusion solved` — document
