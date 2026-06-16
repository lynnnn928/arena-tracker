#!/usr/bin/env node
var db = require('./db');
var fs = require('fs');
var path = require('path');
var { execSync } = require('child_process');
var CONFIG_PATH = path.join(__dirname, 'config.json');

db.init();

function config() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }

var args = process.argv.slice(2);
var cmd = args[0];
if (!cmd) { help(); process.exit(0); }

function help() {
  console.log('Arena Tracker CLI');
  console.log('');
  console.log('Commands:');
  console.log('  sync [--tank X]           Sync match data');
  console.log('  status                    System status');
  console.log('  tanks                     List all registered tanks');
  console.log('  tank <name>               Tank details');
  console.log('  rank [--tank X]           Rank score trend');
  console.log('  versions [--tank X]       Version winrate table');
  console.log('  version <cv> [--tank X]   Single version detail');
  console.log('  compare <v1> <v2> [...opts]  Compare two versions');
  console.log('  maps [--tank X]           Map winrate breakdown');
  console.log('  matches [opts]            Filtered match list');
  console.log('  trend [--tank X] [--bin h|d|w]  Winrate over time');
  console.log('  anomalies [--tank X]      Flag anomaly matches');
  console.log('  opponents [--tank X] [--limit N]  Opponent ranking');
  console.log('  match <urlId>             Single match detail');
  console.log('  export <cv> [opts]        Export match data');
  console.log('  publish <file.js> [opts]  Publish code version (--dry-run to preview)');
  console.log('  deploy <file.js> [opts]   Publish + sandbox verify (--dry-run to preview)');
  console.log('  rollback <cv> [--tank X]  Rollback to version');
  console.log('  rebuild                   Rebuild dashboard HTML');
  console.log('  batch <N> <cv> [opts]     Run batch challenges');
  console.log('  record <cv> [opts]        Record iteration note');
  console.log('  analyze [flags]           Analyze maps/opponents/matrix');
  console.log('');
  console.log('Common options:');
  console.log('  --tank <name>    Target tank (default: activeTank)');
  console.log('  --map <id>       Filter by map');
  console.log('  --json           Output raw JSON');
}

function tankNameFromArgs() {
  var idx = args.indexOf('--tank');
  if (idx >= 0 && args[idx+1]) return args[idx+1];
  return config().activeTank || 'RedStar';
}

function mapIdFromArgs() {
  var idx = args.indexOf('--map');
  if (idx >= 0 && args[idx+1]) return args[idx+1];
  return null;
}

function hasFlag(name) {
  return args.indexOf(name) >= 0;
}

function flagValue(name) {
  var idx = args.indexOf(name);
  if (idx >= 0 && args[idx+1]) return args[idx+1];
  return null;
}

function asMarkdown(label, val) { return '**' + label + ':** ' + val; }

function isJson() { return hasFlag('--json'); }

function jsonOrText(json, text) {
  if (isJson()) { console.log(JSON.stringify(json, null, 2)); }
  else { console.log(text); }
}

// == Commands ==

function cmd_sync() {
  var t = flagValue('--tank');
  var cmd = 'node "' + path.join(__dirname, 'sync.js') + '"' + (t ? ' --tank ' + t : '');
  execSync(cmd, { stdio: 'inherit', cwd: __dirname });
}

function cmd_status() {
  var cfg = config();
  var tanks = Object.keys(cfg.tanks);
  var out = [];
  tanks.forEach(function(name) {
    var info = cfg.tanks[name];
    var total = db.query('SELECT COUNT(*) as c FROM matches WHERE tankName=?', [name])[0].c;
    var snap = db.query('SELECT ts, rankScore, rankTier FROM snapshots WHERE tankName=? ORDER BY ts DESC LIMIT 1', [name]);
    out.push({ name: name, id: info.id, matches: total, lastRank: snap[0] || null });
  });
  var txt = '# System Status\n\n';
  out.forEach(function(t) {
    txt += '**' + t.name + '** (id=' + t.id + '): ' + t.matches + ' matches';
    if (t.lastRank) txt += ', Rank=' + t.lastRank.rankScore + ' (' + t.lastRank.rankTier + ') @ ' + t.lastRank.ts.slice(0, 19);
    txt += '\n';
  });
  jsonOrText(out, txt);
}

function cmd_tanks() {
  var cfg = config();
  var list = Object.keys(cfg.tanks).map(function(name) {
    var t = cfg.tanks[name];
    var cnt = db.query('SELECT COUNT(*) as c FROM matches WHERE tankName=?', [name])[0].c;
    return { name: name, id: t.id, matches: cnt };
  });
  var txt = '# Tanks\n\n| Name | ID | Matches |\n|------|----|---------|\n';
  list.forEach(function(t) { txt += '| ' + t.name + ' | ' + t.id + ' | ' + t.matches + ' |\n'; });
  jsonOrText(list, txt);
}

function cmd_tank(name) {
  if (!name) { console.log('Usage: arena tank <name>'); return; }
  var cfg = config();
  var t = cfg.tanks[name];
  if (!t) { console.log('Tank not found: ' + name); return; }
  var s = db.query('SELECT COUNT(*) as c, SUM(won) as w FROM matches WHERE tankName=?', [name])[0];
  var last = db.query('SELECT ts, myRankScore, myRankTier FROM matches WHERE tankName=? AND myRankScore IS NOT NULL ORDER BY ts DESC LIMIT 1', [name]);
  var maps = db.query('SELECT mapId, COUNT(*) as c, SUM(won) as w FROM matches WHERE tankName=? GROUP BY mapId', [name]);
  var info = { name: name, id: t.id, matches: s.c, wins: s.w || 0, losses: (s.c - (s.w || 0)) };
  if (last[0]) info.lastRank = { score: last[0].myRankScore, tier: last[0].myRankTier, ts: last[0].ts };
  info.maps = maps.map(function(m) { return { mapId: m.mapId, total: m.c, wins: m.w || 0 }; });
  var wr = s.c ? ((s.w || 0) / s.c * 100).toFixed(1) : '-';
  var txt = '# Tank: ' + name + '\n\n';
  txt += asMarkdown('ID', t.id) + '\n';
  txt += asMarkdown('Matches', s.c) + '\n';
  txt += asMarkdown('Winrate', wr + '%') + '\n';
  if (last[0]) txt += asMarkdown('Current Rank', last[0].myRankScore + ' (' + last[0].myRankTier + ')') + '\n';
  txt += '\n### Maps\n\n| Map | Matches | Wins | WR |\n|-----|---------|------|----|\n';
  info.maps.forEach(function(m) { txt += '| ' + m.mapId + ' | ' + m.total + ' | ' + m.wins + ' | ' + (m.wins/m.total*100).toFixed(1) + '% |\n'; });
  jsonOrText(info, txt);
}

function cmd_rank() {
  var tankName = tankNameFromArgs();
  var rows = db.getMatchRankHistory(tankName);
  if (!rows || rows.length === 0) { console.log('No rank data for ' + tankName); return; }
  var last = rows[rows.length - 1];
  var first = rows[0];
  var delta = last.rankScore - first.rankScore;
  var txt = '# Rank Trend: ' + tankName + '\n\n';
  txt += 'Start: ' + first.rankScore + ' → Current: **' + last.rankScore + '** (' + (delta >=0 ? '+' : '') + delta + ')\n\n';
  txt += '| Time | Score | Tier | CV |\n|------|-------|------|----|\n';
  rows.slice(-50).forEach(function(r) {
    txt += '| ' + (r.ts ? r.ts.slice(5, 19).replace('T', ' ') : '') + ' | ' + r.rankScore + ' | ' + (r.rankTier || '-') + ' | v' + r.cv + ' |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_versions() {
  var tankName = tankNameFromArgs();
  var rows = db.getVersionSummary(tankName).filter(function(v) { return v.total >= 5; });
  if (rows.length === 0) { console.log('No version data for ' + tankName); return; }
  rows.sort(function(a,b) { return b.winRate - a.winRate; });
  var txt = '# Version Winrate: ' + tankName + '\n\n';
  txt += '| Version | Winrate | Wins | Total | Shots |\n|---------|---------|------|-------|-------|\n';
  rows.forEach(function(v) {
    txt += '| v' + v.cv + ' | ' + v.winRate + '% | ' + v.wins + ' | ' + v.total + ' | ' + v.avgShots + ' |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_version(cv) {
  if (!cv) { console.log('Usage: arena version <cv> [--tank X]'); return; }
  var tankName = tankNameFromArgs();
  var rows = db.query('SELECT mapId, COUNT(*) as c, SUM(won) as w FROM matches WHERE cv=? AND tankName=? GROUP BY mapId', [Number(cv), tankName]);
  var total = db.query('SELECT COUNT(*) as c, SUM(won) as w FROM matches WHERE cv=? AND tankName=?', [Number(cv), tankName])[0];
  var info = { version: Number(cv), tank: tankName, total: total.c, wins: total.w || 0, maps: rows.map(function(m) { return { mapId: m.mapId, total: m.c, wins: m.w || 0 }; }) };
  var txt = '# Version v' + cv + ' (' + tankName + ')\n\n';
  txt += asMarkdown('Total', info.total) + '\n';
  txt += asMarkdown('Wins', info.wins) + '\n';
  txt += asMarkdown('Winrate', info.total ? (info.wins/info.total*100).toFixed(1) + '%' : '-') + '\n\n';
  txt += '| Map | Total | Wins | WR |\n|-----|-------|------|----|\n';
  info.maps.forEach(function(m) { txt += '| ' + m.mapId + ' | ' + m.total + ' | ' + m.wins + ' | ' + (m.wins/m.total*100).toFixed(1) + '% |\n'; });
  jsonOrText(info, txt);
}

function cmd_compare(v1, v2) {
  if (!v1 || !v2) { console.log('Usage: arena compare <v1> <v2> [--map M] [--tank X]'); return; }
  var tankName = tankNameFromArgs();
  var mapId = mapIdFromArgs();
  var where = 'cv IN (?,?) AND tankName=?';
  var params = [Number(v1), Number(v2), tankName];
  if (mapId) { where += ' AND mapId=?'; params.push(mapId); }
  var rows = db.query('SELECT cv, COUNT(*) as c, SUM(won) as w FROM matches WHERE ' + where + ' GROUP BY cv', params);
  var txt = '# Compare v' + v1 + ' vs v' + v2 + ' (' + tankName + ')' + (mapId ? ' on ' + mapId : '') + '\n\n';
  txt += '| Version | Wins | Total | Winrate |\n|---------|------|-------|---------|\n';
  var best = null;
  rows.forEach(function(r) {
    var wr = r.w/r.c*100;
    txt += '| v' + r.cv + ' | ' + (r.w||0) + ' | ' + r.c + ' | ' + wr.toFixed(1) + '% |\n';
    if (!best || wr > best.wr) best = { cv: r.cv, wr: wr };
  });
  if (best && rows.length === 2) {
    var diff = Math.abs(rows[0].w/rows[0].c*100 - rows[1].w/rows[1].c*100);
    txt += '\n**Difference:** ' + diff.toFixed(1) + '%\n';
    txt += '**Winner:** v' + best.cv + ' (' + best.wr.toFixed(1) + '%)\n';
  }
  jsonOrText(rows, txt);
}

function cmd_maps() {
  var tankName = tankNameFromArgs();
  var rows = db.getMapBreakdown(tankName);
  if (rows.length === 0) { console.log('No map data for ' + tankName); return; }
  rows.sort(function(a,b) { return a.winRate - b.winRate; });
  var txt = '# Map Winrate: ' + tankName + '\n\n';
  txt += '| Map | Winrate | Wins | Total | Shots |\n|-----|---------|------|-------|-------|\n';
  rows.forEach(function(m) {
    txt += '| ' + m.mapId + ' | ' + m.winRate + '% | ' + m.wins + ' | ' + m.total + ' | ' + m.avgShots + ' |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_matches() {
  var tankName = tankNameFromArgs();
  var mapId = mapIdFromArgs();
  var cv = flagValue('--cv');
  var result = flagValue('--result');
  var reason = flagValue('--reason');
  var limit = parseInt(flagValue('--limit') || '50');

  var where = ['tankName=?'];
  var params = [tankName];
  if (mapId) { where.push('mapId=?'); params.push(mapId); }
  if (cv) { where.push('cv=?'); params.push(Number(cv)); }
  if (result === 'win') where.push('won=1');
  else if (result === 'loss') where.push('won=0');
  if (reason) { where.push('reason=?'); params.push(reason); }

  var sql = 'SELECT ts, mapId, cv, won, reason, myShots, meStars, source, rankChanges, opponentName FROM matches WHERE ' + where.join(' AND ') + ' ORDER BY ts DESC LIMIT ?';
  params.push(limit);
  var rows = db.query(sql, params);
  if (rows.length === 0) { console.log('No matches found.'); return; }
  var txt = '# Matches (' + tankName + ')\n\n';
  txt += '| Time | Map | CV | Result | Reason | Shots | Stars | RankΔ | Opponent |\n|------|-----|----|--------|--------|-------|-------|-------|----------|\n';
  rows.forEach(function(m) {
    txt += '| ' + (m.ts ? m.ts.slice(5, 19).replace('T', ' ') : '') + ' | ' + m.mapId + ' | v' + m.cv + ' | ' + (m.won ? 'WIN' : 'LOSS') + ' | ' + (m.reason || '-') + ' | ' + (m.myShots || 0) + ' | ' + (m.meStars || 0) + ' | ' + (m.rankChanges != null ? (m.rankChanges >= 0 ? '+' : '') + m.rankChanges : '-') + ' | ' + (m.opponentName || '-') + ' |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_trend() {
  var tankName = tankNameFromArgs();
  var bin = flagValue('--bin') || 'd';
  var rows = db.getMatchRankHistory(tankName);
  if (!rows || rows.length < 2) { console.log('Not enough data.'); return; }
  var txt = '# Rank Trend: ' + tankName + ' (bin=' + bin + ')\n\n';
  txt += '| Time | Rank Score | Tier | CV |\n|------|-----------|------|----|\n';
  rows.forEach(function(r) {
    txt += '| ' + (r.ts ? r.ts.slice(5, 19).replace('T', ' ') : '') + ' | ' + r.rankScore + ' | ' + (r.rankTier || '-') + ' | v' + r.cv + ' |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_anomalies() {
  var tankName = tankNameFromArgs();
  var threshold = parseInt(flagValue('--threshold') || '30');
  var rows = db.query('SELECT ts, mapId, cv, won, rankChanges, opponentName FROM matches WHERE tankName=? AND rankChanges IS NOT NULL AND ABS(rankChanges) >= ? ORDER BY ABS(rankChanges) DESC LIMIT 20', [tankName, threshold]);
  if (rows.length === 0) { console.log('No anomalies found for threshold=' + threshold); return; }
  var txt = '# Anomaly Matches (' + tankName + ', Δ≥' + threshold + ')\n\n';
  txt += '| Time | Map | CV | Result | RankΔ | Opponent |\n|------|-----|----|--------|-------|----------|\n';
  rows.forEach(function(m) {
    txt += '| ' + (m.ts ? m.ts.slice(5, 19).replace('T', ' ') : '') + ' | ' + m.mapId + ' | v' + m.cv + ' | ' + (m.won ? 'WIN' : 'LOSS') + ' | ' + (m.rankChanges >= 0 ? '+' : '') + m.rankChanges + ' | ' + (m.opponentName || '-') + ' |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_opponents() {
  var tankName = tankNameFromArgs();
  var limit = parseInt(flagValue('--limit') || '15');
  var rows = db.query('SELECT opponentName, COUNT(*) as c, SUM(won) as w FROM matches WHERE tankName=? AND opponentName IS NOT NULL AND opponentName !=\'\' GROUP BY opponentName ORDER BY c DESC LIMIT ?', [tankName, limit]);
  if (rows.length === 0) { console.log('No opponent data.'); return; }
  var txt = '# Opponent Winrate (' + tankName + ', top ' + limit + ')\n\n';
  txt += '| Opponent | Matches | Wins | Loses | WR vs |\n|----------|---------|------|-------|-------|\n';
  rows.forEach(function(r) {
    var losses = r.c - (r.w || 0);
    txt += '| ' + r.opponentName + ' | ' + r.c + ' | ' + (r.w||0) + ' | ' + losses + ' | ' + ((r.w||0)/r.c*100).toFixed(1) + '% |\n';
  });
  jsonOrText(rows, txt);
}

function cmd_match(urlId) {
  if (!urlId) { console.log('Usage: arena match <urlId>'); return; }
  var rows = db.query('SELECT * FROM matches WHERE urlId=?', [urlId]);
  if (rows.length === 0) { console.log('Match not found: ' + urlId); return; }
  var m = rows[0];
  var txt = '# Match: ' + urlId + '\n\n';
  txt += '| Field | Value |\n|-------|-------|\n';
  txt += '| Tank | ' + m.tankName + ' |\n';
  txt += '| CV | v' + m.cv + ' |\n';
  txt += '| Map | ' + m.mapId + ' |\n';
  txt += '| Result | ' + (m.won ? 'WIN' : 'LOSS') + ' |\n';
  txt += '| Reason | ' + (m.reason || '-') + ' |\n';
  txt += '| RankΔ | ' + (m.rankChanges != null ? (m.rankChanges >= 0 ? '+' : '') + m.rankChanges : '-') + ' |\n';
  txt += '| Shots | ' + (m.myShots || 0) + ' |\n';
  txt += '| Stars | ' + (m.meStars || 0) + ' |\n';
  txt += '| Opponent | ' + (m.opponentName || '-') + ' |\n';
  txt += '| Opponent CV | v' + (m.opponentCodeVersion || '-') + ' |\n';
  txt += '| Source | ' + (m.source || '-') + ' |\n';
  txt += '| Time | ' + (m.ts || '-') + ' |\n';
  jsonOrText(m, txt);
}

function cmd_export(cv) {
  if (!cv) { console.log('Usage: arena export <cv> [--tank X] [--format csv|json]'); return; }
  var tankName = tankNameFromArgs();
  var format = flagValue('--format') || 'json';
  var rows = db.query('SELECT urlId, ts, mapId, won, reason, myShots, meStars, rankChanges, opponentName, opponentCodeVersion FROM matches WHERE cv=? AND tankName=?', [Number(cv), tankName]);
  if (format === 'csv') {
    console.log('urlId,ts,mapId,won,reason,myShots,meStars,rankChange,opponent,opponentCV');
    rows.forEach(function(r) { console.log([r.urlId, r.ts, r.mapId, r.won, r.reason, r.myShots||0, r.meStars||0, r.rankChanges||0, r.opponentName, r.opponentCodeVersion].join(',')); });
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }
}

function cmd_publish(filePath) {
  if (!filePath) { console.log('Usage: arena publish <file.js> [--tank X] [--notes "string"] [--dry-run]'); return; }
  var notes = flagValue('--notes') || '';
  var tankFlag = tankNameFromArgs();
  var dryRun = hasFlag('--dry-run');
  if (dryRun) { console.log('[dry-run] would publish ' + filePath + ' for ' + tankFlag); return; }
  var cmd = 'node "' + path.join(__dirname, 'publish.js') + '" "' + filePath + '" --tank ' + tankFlag;
  if (notes) cmd += ' --notes "' + notes + '"';
  execSync(cmd, { stdio: 'inherit', cwd: __dirname });
}

function cmd_deploy(filePath) {
  if (!filePath) { console.log('Usage: arena deploy <file.js> [--tank X] [--dry-run]'); return; }
  var tankFlag = tankNameFromArgs();
  var dryRun = hasFlag('--dry-run');
  if (dryRun) { console.log('[dry-run] would deploy ' + filePath + ' for ' + tankFlag + ' (publish + 20 challenges)'); return; }
  // Publish
  var out = execSync('node "' + path.join(__dirname, 'publish.js') + '" "' + filePath + '" --tank ' + tankFlag, { encoding: 'utf8', cwd: __dirname });
  var lines = out.trim().split('\n');
  var ver = lines[lines.length - 1].trim();
  console.log('Published v' + ver + ', now sandbox verifying...');
  // Sandbox verify: run 20 challenges
  execSync('node "' + path.join(__dirname, 'batch.js') + '" 20 ' + ver + ' --tank ' + tankFlag + ' --map random', { stdio: 'inherit', cwd: __dirname });
}

function cmd_rollback(cv) {
  if (!cv) { console.log('Usage: arena rollback <cv> [--tank X]'); return; }
  var tankFlag = tankNameFromArgs();
  var verFile = path.join(__dirname, 'versions', 'v' + cv + '.js');
  if (!fs.existsSync(verFile)) { console.log('Version file not found: ' + verFile); return; }
  execSync('node "' + path.join(__dirname, 'publish.js') + '" "' + verFile + '" --tank ' + tankFlag + ' --notes "rollback to v' + cv + '"', { stdio: 'inherit', cwd: __dirname });
}

function cmd_batch() {
  var count = args[1];
  var cv = args[2];
  if (!count || !cv) { console.log('Usage: arena batch <N> <cv> [--map M] [--tank X]'); return; }
  var tankFlag = tankNameFromArgs();
  var mapFlag = mapIdFromArgs();
  var cmd = 'node "' + path.join(__dirname, 'batch.js') + '" ' + count + ' ' + cv + ' --tank ' + tankFlag;
  if (mapFlag) cmd += ' --map ' + mapFlag;
  execSync(cmd, { stdio: 'inherit', cwd: __dirname });
}

function cmd_record(cv) {
  if (!cv) { console.log('Usage: arena record <cv> [--signal "..." --root-cause "..." --theory "..." --change-type X --scope X --key-diff "..." --target "..." --result-data "..." --conclusion X]'); return; }
  var recordCmd = 'node "' + path.join(__dirname, 'record_iteration.js') + '" ' + cv;
  var opts = ['signal', 'root-cause', 'theory', 'change-type', 'scope', 'key-diff', 'target', 'result-data', 'conclusion', 'parent'];
  opts.forEach(function(opt) {
    var val = flagValue('--' + opt);
    if (val) recordCmd += ' --' + opt + ' "' + val + '"';
  });
  execSync(recordCmd, { stdio: 'inherit', cwd: __dirname });
}

function cmd_analyze() {
  var tankName = tankNameFromArgs();
  if (hasFlag('--map')) {
    var mapId = flagValue('--map') || flagValue('--map');
    var sql = mapId
      ? 'SELECT cv, COUNT(*) as c, SUM(won) as w FROM matches WHERE tankName=? AND mapId=? AND cv IS NOT NULL GROUP BY cv ORDER BY c DESC'
      : 'SELECT mapId, COUNT(*) as c, SUM(won) as w, ROUND(AVG(won)*100,1) as wr FROM matches WHERE tankName=? GROUP BY mapId ORDER BY c DESC';
    var params = mapId ? [tankName, mapId] : [tankName];
    var rows = db.query(sql, params);
    if (!rows.length) { console.log('No data for ' + tankName + (mapId ? ' map=' + mapId : '')); return; }
    if (mapId) {
      var txt = '# Map Analysis: ' + tankName + ' / ' + mapId + '\n\n';
      txt += '| Version | Matches | Wins | Losses | WR |\n|---------|---------|------|--------|----|\n';
      rows.forEach(function(r) { var w=r.w||0; var l=r.c-w; txt += '| v' + r.cv + ' | ' + r.c + ' | ' + w + ' | ' + l + ' | ' + (w/r.c*100).toFixed(1) + '% |\n'; });
      jsonOrText(rows, txt);
    } else {
      var txt = '# Map Analysis: ' + tankName + '\n\n';
      txt += '| Map | Matches | Wins | Losses | WR |\n|-----|---------|------|--------|----|\n';
      rows.forEach(function(r) { var w=r.w||0; var l=r.c-w; txt += '| ' + r.mapId + ' | ' + r.c + ' | ' + w + ' | ' + l + ' | ' + r.wr + '% |\n'; });
      jsonOrText(rows, txt);
    }
  } else if (hasFlag('--opponent')) {
    var limit = parseInt(flagValue('--limit') || '20');
    var opponent = flagValue('--opponent');
    if (opponent) {
      var rows = db.query('SELECT cv, COUNT(*) as c, SUM(won) as w, ROUND(AVG(won)*100,1) as wr FROM matches WHERE tankName=? AND opponentName=? AND cv IS NOT NULL GROUP BY cv ORDER BY c DESC', [tankName, opponent]);
      if (!rows.length) { console.log('No data for opponent: ' + opponent); return; }
      var txt = '# Opponent Analysis: ' + tankName + ' vs ' + opponent + '\n\n';
      txt += '| Version | Matches | Wins | Losses | WR |\n|---------|---------|------|--------|----|\n';
      rows.forEach(function(r) { var w=r.w||0; var l=r.c-w; txt += '| v' + r.cv + ' | ' + r.c + ' | ' + w + ' | ' + l + ' | ' + r.wr + '% |\n'; });
      jsonOrText(rows, txt);
    } else {
      var rows = db.query('SELECT opponentName, COUNT(*) as c, SUM(won) as w, ROUND(AVG(won)*100,1) as wr FROM matches WHERE tankName=? AND opponentName IS NOT NULL AND opponentName!=\'\' GROUP BY opponentName ORDER BY c DESC LIMIT ?', [tankName, limit]);
      if (!rows.length) { console.log('No opponent data for ' + tankName); return; }
      var txt = '# Opponent Analysis: ' + tankName + ' (top ' + limit + ')\n\n';
      txt += '| Opponent | Matches | Wins | Losses | WR | Streak Info |\n|----------|---------|------|--------|----|-------------|\n';
      rows.forEach(function(r) { var w=r.w||0; var l=r.c-w; var last5=db.query('SELECT won FROM matches WHERE tankName=? AND opponentName=? ORDER BY ts DESC LIMIT 5', [tankName, r.opponentName]).map(function(x){return x.won?'W':'L'}).join(''); txt += '| ' + r.opponentName + ' | ' + r.c + ' | ' + w + ' | ' + l + ' | ' + r.wr + '% | ' + last5 + ' |\n'; });
      jsonOrText(rows, txt);
    }
  } else if (hasFlag('--matrix')) {
    var rows = db.getVersionMapMatrix(tankName);
    if (!rows.length) { console.log('No matrix data for ' + tankName); return; }
    var cvs = [...new Set(rows.map(function(r){return r.cv}))].sort(function(a,b){return a-b});
    var maps = [...new Set(rows.map(function(r){return r.mapId}))].sort();
    var mapRows = {};
    rows.forEach(function(r){ mapRows[r.cv+'_'+r.mapId]=r; });
    var txt = '# Version x Map Winrate Matrix: ' + tankName + '\n\n';
    txt += '| CV | ' + maps.join(' | ') + ' |\n';
    txt += '|----|' + maps.map(function(){return '----'}).join('|') + '|\n';
    cvs.forEach(function(cv){
      txt += '| v' + cv + ' | ';
      maps.forEach(function(mapId){
        var r = mapRows[cv+'_'+mapId];
        txt += r ? r.winRate + '%' : '-';
        txt += ' | ';
      });
      txt += '\n';
    });
    jsonOrText(rows, txt);
  } else {
    console.log('Usage: arena analyze [--map [ID]] [--opponent [NAME]] [--matrix] [--tank X] [--json]');
    console.log('');
    console.log('Examples:');
    console.log('  arena analyze --map              All maps breakdown');
    console.log('  arena analyze --map random       Version breakdown on random map');
    console.log('  arena analyze --opponent         Top 20 opponents');
    console.log('  arena analyze --opponent BotA    Version breakdown vs BotA');
    console.log('  arena analyze --matrix           Version x Map matrix table');
  }
}
switch (cmd) {
  case 'sync': cmd_sync(); break;
  case 'status': cmd_status(); break;
  case 'tanks': cmd_tanks(); break;
  case 'tank': cmd_tank(args[1]); break;
  case 'rank': cmd_rank(); break;
  case 'versions': cmd_versions(); break;
  case 'version': cmd_version(args[1]); break;
  case 'compare': cmd_compare(args[1], args[2]); break;
  case 'maps': cmd_maps(); break;
  case 'matches': cmd_matches(); break;
  case 'trend': cmd_trend(); break;
  case 'anomalies': cmd_anomalies(); break;
  case 'opponents': cmd_opponents(); break;
  case 'match': cmd_match(args[1]); break;
  case 'export': cmd_export(args[1]); break;
  case 'publish': cmd_publish(args[1]); break;
  case 'deploy': cmd_deploy(args[1]); break;
  case 'rollback': cmd_rollback(args[1]); break;
  case 'batch': cmd_batch(); break;
  case 'record': cmd_record(args[1]); break;
  case 'rebuild': console.log('Deprecated: arena.html is now dynamic (server.js)'); break;
  case 'analyze': cmd_analyze(); break;
  default: help(); break;
}

db.close();
