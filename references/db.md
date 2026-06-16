# Database Schema

SQLite file: `scripts/arena.db` (auto-created in scripts/)
Multi-tank: all tanks share one DB, distinguished by `tankName` column.

## matches

```sql
urlId            TEXT PRIMARY KEY,
tankName         TEXT NOT NULL DEFAULT 'RedStar',
source           TEXT,
cv               INTEGER,
mapId            TEXT,
won              INTEGER,
reason           TEXT,
frames           INTEGER,
myShots, oppShots,
meStars, oppStars,
rankChanges      INTEGER,
myRankScore      INTEGER,
myRankTier       TEXT,
opponentName     TEXT,
opponentId       INTEGER,
opponentRankScore INTEGER,
opponentCodeVersion INTEGER,
myRunTime, opponentRunTime INTEGER,
excitementScore  INTEGER,
ts               TEXT
```

## version_notes, snapshots, map_cache — see `db.js` CREATE TABLE statements.

## Queries

```bash
node scripts/arena.js versions
node scripts/arena.js compare 72 74 --tank RedStar
node scripts/arena.js maps --tank RedStar
node scripts/arena.js opponents --limit 10
node scripts/arena.js rank
node scripts/arena.js matches --cv 74 --result loss --limit 10
```
