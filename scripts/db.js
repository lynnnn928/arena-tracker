const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'arena.db');

let db;

function init() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  // Migration: add columns that newer CREATE TABLE includes
  try { db.exec("ALTER TABLE version_notes ADD COLUMN signal TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN root_cause TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN theory TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN change_type TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN scope TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN key_diff TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN target TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN result_data TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE version_notes ADD COLUMN conclusion TEXT"); } catch(e) {}
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_cache (
      mapId TEXT PRIMARY KEY,
      mapW INTEGER,
      mapH INTEGER,
      cells INTEGER,
      walls INTEGER,
      wallRatio REAL,
      tactic TEXT,
      ts TEXT
    );

    CREATE TABLE IF NOT EXISTS version_notes (
      version INTEGER PRIMARY KEY,
      parent_version INTEGER,
      signal TEXT,
      root_cause TEXT,
      theory TEXT,
      change_type TEXT CHECK(change_type IN ('bugfix','tuning','experiment','refactor','rollback','unknown')) DEFAULT 'unknown',
      scope TEXT CHECK(scope IN ('single-map','mechanic','general','architecture','unknown')) DEFAULT 'unknown',
      key_diff TEXT,
      target TEXT,
      result_data TEXT,
      conclusion TEXT CHECK(conclusion IN ('solved','partial','failed','pending','unknown')) DEFAULT 'pending',
      ts TEXT
    );

    CREATE TABLE IF NOT EXISTS matches (
      urlId TEXT PRIMARY KEY,
      tankName TEXT NOT NULL DEFAULT 'RedStar',
      source TEXT NOT NULL DEFAULT 'challenge',
      cv INTEGER,
      mapId TEXT,
      mapW INTEGER,
      mapH INTEGER,
      tactic TEXT,
      won INTEGER,
      reason TEXT,
      frames INTEGER,
      myShots INTEGER DEFAULT 0,
      oppShots INTEGER DEFAULT 0,
      meStars INTEGER DEFAULT 0,
      oppStars INTEGER DEFAULT 0,
      noShot INTEGER DEFAULT 0,
      rankChanges INTEGER,
      myRankScore INTEGER,
      myRankTier TEXT,
      opponentName TEXT,
      opponentId INTEGER,
      opponentRankScore INTEGER,
      opponentCodeVersion INTEGER,
      myRunTime INTEGER,
      opponentRunTime INTEGER,
      excitementScore INTEGER,
      ts TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_matches_tank ON matches(tankName);
    CREATE INDEX IF NOT EXISTS idx_matches_cv ON matches(cv);
    CREATE INDEX IF NOT EXISTS idx_matches_map ON matches(mapId);
    CREATE INDEX IF NOT EXISTS idx_matches_ts ON matches(ts);

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      tankName TEXT NOT NULL DEFAULT 'RedStar',
      wins INTEGER,
      losses INTEGER,
      rankScore INTEGER,
      rankTier TEXT,
      cv INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_tank ON snapshots(tankName);
    CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);

    CREATE TABLE IF NOT EXISTS path_summaries (
      matchUrlId TEXT PRIMARY KEY,
      myMoves INTEGER DEFAULT 0,
      myTurns INTEGER DEFAULT 0,
      firstShotFrame INTEGER,
      minDistToEnemy INTEGER,
      skillUsed TEXT,
      skillSuccess INTEGER,
      bombsUsed INTEGER,
      FOREIGN KEY (matchUrlId) REFERENCES matches(urlId)
    );
  `);
}

function insertMatch(m) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO matches
    (urlId, tankName, source, cv, mapId, mapW, mapH, tactic,
     won, reason, frames, myShots, oppShots, meStars, oppStars, noShot,
     rankChanges, myRankScore, myRankTier,
     opponentName, opponentId, opponentRankScore, opponentCodeVersion,
     myRunTime, opponentRunTime, excitementScore, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    m.urlId || null,
    m.tankName || 'RedStar',
    m.source || 'challenge',
    m.cv ?? null,
    m.mapId || null,
    m.mapW ?? null,
    m.mapH ?? null,
    m.tactic || null,
    m.won ? 1 : 0,
    m.reason || null,
    m.frames ?? null,
    m.myShots ?? 0,
    m.oppShots ?? 0,
    m.meStars ?? 0,
    m.oppStars ?? 0,
    m.myShots === 0 ? 1 : 0,
    m.rankChanges ?? null,
    m.myRankScore ?? null,
    m.myRankTier || null,
    m.opponentName || null,
    m.opponentId ?? null,
    m.opponentRankScore ?? null,
    m.opponentCodeVersion ?? null,
    m.myRunTime ?? null,
    m.opponentRunTime ?? null,
    m.excitementScore ?? null,
    m.ts || new Date().toISOString()
  );
}

function insertSnapshot(s) {
  const stmt = db.prepare(`
    INSERT INTO snapshots (ts, tankName, wins, losses, rankScore, rankTier, cv)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(s.ts, s.tankName || 'RedStar', s.wins ?? 0, s.losses ?? 0,
    s.rankScore ?? 0, s.rankTier || null, s.cv ?? null);
}

function queryMatches(filters) {
  let sql = 'SELECT * FROM matches WHERE 1=1';
  const params = [];
  if (filters.tankName) { sql += ' AND tankName = ?'; params.push(filters.tankName); }
  if (filters.cv) { sql += ' AND cv = ?'; params.push(filters.cv); }
  if (filters.mapId) { sql += ' AND mapId = ?'; params.push(filters.mapId); }
  if (filters.minCv) { sql += ' AND cv >= ?'; params.push(filters.minCv); }
  if (filters.maxCv) { sql += ' AND cv <= ?'; params.push(filters.maxCv); }
  if (filters.source) { sql += ' AND source = ?'; params.push(filters.source); }
  sql += ' ORDER BY ts DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  return db.prepare(sql).all(...params);
}

function getMatchSummary(tankName) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(won) as wins,
      ROUND(AVG(won) * 100, 1) as winRate,
      SUM(noShot) as noShotGames,
      ROUND(AVG(myShots), 1) as avgShots,
      ROUND(AVG(meStars), 1) as avgStars,
      ROUND(AVG(frames), 1) as avgFrames
    FROM matches WHERE tankName = ?
  `).get(tankName);
  return stats;
}

function getMapBreakdown(tankName) {
  return db.prepare(`
    SELECT mapId, tactic, mapW, mapH,
      COUNT(*) as total,
      SUM(won) as wins,
      ROUND(AVG(won) * 100, 1) as winRate,
      SUM(noShot) as noShotGames,
      ROUND(AVG(myShots), 1) as avgShots,
      MIN(cv) as firstCv,
      MAX(cv) as lastCv
    FROM matches WHERE tankName = ?
    GROUP BY mapId ORDER BY winRate ASC
  `).all(tankName);
}

function getVersionMapMatrix(tankName) {
  return db.prepare(`
    SELECT cv, mapId,
      COUNT(*) as total,
      SUM(won) as wins,
      ROUND(AVG(won) * 100, 1) as winRate
    FROM matches WHERE tankName = ? AND cv IS NOT NULL
    GROUP BY cv, mapId ORDER BY cv, mapId
  `).all(tankName);
}

function getVersionSummary(tankName) {
  return db.prepare(`
    SELECT cv,
      COUNT(*) as total,
      SUM(won) as wins,
      ROUND(AVG(won) * 100, 1) as winRate,
      SUM(noShot) as noShotGames,
      ROUND(AVG(myShots), 1) as avgShots,
      MIN(ts) as firstSeen,
      MAX(ts) as lastSeen
    FROM matches WHERE tankName = ? AND cv IS NOT NULL
    GROUP BY cv ORDER BY cv
  `).all(tankName);
}

function getRankHistory(tankName) {
  // From snapshots table (periodic manual polls)
  return db.prepare(`SELECT ts, rankScore, rankTier, wins, losses, cv
    FROM snapshots WHERE tankName = ? ORDER BY ts ASC`).all(tankName);
}

function getMatchRankHistory(tankName) {
  // From matches table (every match has rankScore)
  return db.prepare(`SELECT ts, myRankScore as rankScore, myRankTier as rankTier, cv
    FROM matches WHERE tankName = ? AND myRankScore IS NOT NULL
    ORDER BY ts ASC`).all(tankName);
}

function getRecentMatches(tankName, limit) {
  return db.prepare(`
    SELECT * FROM matches WHERE tankName = ?
    ORDER BY ts DESC LIMIT ?
  `).all(tankName, limit || 20);
}

function matchExists(urlId) {
  if (!urlId) return false;
  const row = db.prepare('SELECT 1 FROM matches WHERE urlId = ?').get(urlId);
  return !!row;
}

function countMatches(tankName) {
  if (tankName) return db.prepare('SELECT COUNT(*) as c FROM matches WHERE tankName = ?').get(tankName).c;
  return db.prepare('SELECT COUNT(*) as c FROM matches').get().c;
}

function getTankNames() {
  return db.prepare(`SELECT DISTINCT tankName FROM matches UNION SELECT DISTINCT tankName FROM snapshots ORDER BY tankName`).all();
}

function getAllMatchesCompact(tankName) {
  return db.prepare(`SELECT urlId, ts, mapId, cv, won, reason, source, rankChanges, opponentName, myShots, meStars
    FROM matches WHERE tankName = ? ORDER BY ts DESC`).all(tankName);
}

function query(sql, params) {
  if (!params) return db.prepare(sql).all();
  return db.prepare(sql).all(...params);
}

function run(sql, params) {
  if (!params) return db.prepare(sql).run();
  return db.prepare(sql).run(...params);
}

function close() {
  if (db) db.close();
}

function insertVersionNote(n) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO version_notes
    (version, parent_version, signal, root_cause, theory, change_type, scope, key_diff, target, result_data, conclusion, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    n.version,
    n.parent_version ?? null,
    n.signal || null,
    n.root_cause || null,
    n.theory || null,
    n.change_type || 'unknown',
    n.scope || 'unknown',
    n.key_diff || null,
    n.target || null,
    n.result_data || null,
    n.conclusion || 'pending',
    n.ts || new Date().toISOString()
  );
}

function getVersionNotes() {
  return db.prepare(`SELECT * FROM version_notes ORDER BY version DESC`).all();
}

function getVersionNote(version) {
  return db.prepare(`SELECT * FROM version_notes WHERE version = ?`).get(version);
}

function insertMapCache(m) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO map_cache (mapId, mapW, mapH, cells, walls, wallRatio, tactic, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(m.mapId, m.mapW, m.mapH, m.cells, m.walls ?? null, m.wallRatio ?? null, m.tactic || null, m.ts || new Date().toISOString());
}

function getMapCache() {
  return db.prepare(`SELECT * FROM map_cache ORDER BY mapId`).all();
}

function getMapCacheById(mapId) {
  return db.prepare(`SELECT * FROM map_cache WHERE mapId = ?`).get(mapId);
}

module.exports = { init, insertMatch, insertSnapshot, queryMatches, insertMapCache, getMapCache, getMapCacheById,
  insertVersionNote, getVersionNotes, getVersionNote,
  getMatchSummary, getMapBreakdown, getVersionMapMatrix, getVersionSummary,
  getRankHistory, getMatchRankHistory, getRecentMatches, matchExists, getTankNames, countMatches,
  getAllMatchesCompact, query, run, close };
