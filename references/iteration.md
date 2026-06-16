# Version Iteration Template

Use `node scripts/arena.js record` to log structured notes for each code version.

## Fields

| Field | Meaning | When |
|-------|---------|------|
| `signal` | What data indicated a problem | When found |
| `root_cause` | Root cause after analysis | After analysis |
| `theory` | Logic behind the fix | Before coding |
| `change_type` | bugfix/tuning/experiment/refactor/rollback | On publish |
| `scope` | single-map/mechanic/general/architecture | On publish |
| `key_diff` | One-line summary of the change | On publish |
| `target` | Quantified goal | On publish |
| `result_data` | Actual validation data | After verification |
| `conclusion` | solved/partial/failed/pending | After verification |

## CLI Usage

```bash
node scripts/arena.js record <version> --parent <parent> \
  --signal "..." \
  --root-cause "..." \
  --theory "..." \
  --change-type bugfix \
  --scope general \
  --conclusion solved
```

## Example

```bash
node scripts/arena.js record 68 --parent 67 \
  --signal "v67 TelePuz 50% but Random 70% - possible noise" \
  --root-cause "Sample too small (10 each)" \
  --theory "Run larger sample to verify v67" \
  --change-type experiment \
  --scope general \
  --conclusion pending
```

## Iteration Workflow

1. `node scripts/publish.js versions/v<new>.js --tank <name>` — deploy
2. `node scripts/sync.js --tank <name>` — gather data
3. `node scripts/arena.js compare <old> <new>` — analyze
4. `node scripts/arena.js record <new> --signal "..." --conclusion ...` — document
