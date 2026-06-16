# Server Operations

## Start (Background)

```powershell
Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "scripts/server.js"
```

## Stop

```powershell
Get-Process -Name node
Stop-Process -Id <PID> -Force
```

## API Endpoints

| Method | Path | Function |
|--------|------|----------|
| GET | `/` | Dashboard (arena.html) |
| POST | `/sync` | Trigger sync + rebuild |
| GET | `/sync-status` | Check if syncing |
| POST | `/api/tanks` | Register tank (name + key) |
| GET | `/api/tanks` | List all tanks |
| GET | `/api/stats/:tank` | Statistics |
| GET | `/api/versions/:tank` | Version summary |
| GET | `/api/maps/:tank` | Map stats |
| GET | `/api/matches/:tank` | Match history |
| GET | `/api/rank-history/:tank` | Rank history |
| GET | `/api/opponents/:tank` | Opponent stats |
| GET | `/api/compare/:tank` | Compare versions |

## MCP Server

```bash
cd arena-mcp-server && npm install && node dist/index.js
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Page won't load | Server not running | Check `Get-Process -Name node`, restart |
| Charts empty | CDN blocked | Refresh page |
| Old data | Dashboard stale | Click Sync Data or `node scripts/sync.js; node scripts/build_dashboard.js` |
| Port conflict | Port 3000 in use | Kill existing node, restart |
