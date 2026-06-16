var http = require('http');
var { execSync } = require('child_process');
var fs = require('fs');
var path = require('path');
var { apiGet } = require('./lib/http');
var PORT = 3000;
var BUILDING = false;
var CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function runSync(cb) {
  if (BUILDING) { cb('syncing...'); return; }
  BUILDING = true;
  try {
    execSync('node "' + path.join(__dirname, 'sync.js') + '"', { encoding: 'utf8', timeout: 60000, cwd: __dirname });
    execSync('node "' + path.join(__dirname, 'build_dashboard.js') + '"', { encoding: 'utf8', timeout: 60000, cwd: __dirname });
    BUILDING = false;
    cb(null, 'OK');
  } catch(e) {
    BUILDING = false;
    cb(e.message);
  }
}

function parseBody(req, cb) {
  var body = '';
  req.on('data', function(chunk) { body += chunk; });
  req.on('end', function() {
    try { cb(null, JSON.parse(body)); } catch(e) { cb('Invalid JSON'); }
  });
}

var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Sync trigger
  if (req.url === '/sync' && req.method === 'POST') {
    runSync(function(err, msg) {
      res.writeHead(err ? 500 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: !err, message: msg || err }));
    });
    return;
  }

  if (req.url === '/sync-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ building: BUILDING }));
    return;
  }

  // Tank registration
  if (req.url === '/api/tanks' && req.method === 'POST') {
    parseBody(req, function(err, data) {
      if (err) { res.writeHead(400); res.end(JSON.stringify({ ok: false, message: err })); return; }
      if (!data.name || !data.key) { res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'name and key required' })); return; }
      // Validate key by fetching tank info (async)
      apiGet('https://agentank.ai/api/agent/tank', data.key).then(function(info) {
        var tankId = info.tankId || info.id || (info.tank && info.tank.id);
        if (!tankId) { res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'Invalid token - could not resolve tank' })); return; }
        var cfg = readConfig();
        cfg.tanks[data.name] = { id: tankId, token: data.key, apiBase: 'https://agentank.ai/api' };
        writeConfig(cfg);
        // Trigger sync + dashboard rebuild (non-fatal)
        try { execSync('node "' + path.join(__dirname, 'sync.js') + '" --tank "' + data.name + '"', { encoding: 'utf8', timeout: 60000, cwd: __dirname }); } catch(e) {}
        try { execSync('node "' + path.join(__dirname, 'build_dashboard.js') + '"', { encoding: 'utf8', timeout: 30000, cwd: __dirname }); } catch(e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, tankId: tankId }));
      }).catch(function(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, message: 'Failed to validate token: ' + (e.message || '').slice(0, 100) }));
      });
    });
    return;
  }

  // List tanks
  if (req.url === '/api/tanks' && req.method === 'GET') {
    var cfg = readConfig();
    var list = Object.keys(cfg.tanks).map(function(name) {
      return { name: name, id: cfg.tanks[name].id };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  // Get tank statistics
  var statsMatch = req.url.match(/^\/api\/stats\/([^\/]+)$/);
  if (statsMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(statsMatch[1]);
    var db = require('./db').init();
    var summary = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as winRate,
        SUM(CASE WHEN reason = 'noShot' OR myShots = 0 THEN 1 ELSE 0 END) as noShotGames
      FROM matches WHERE tankName = ?
    `).get(tankName);
    var rank = db.prepare(`
      SELECT myRankScore as rankScore, myRankTier as rankTier FROM matches 
      WHERE tankName = ? AND myRankScore IS NOT NULL ORDER BY ts DESC LIMIT 1
    `).get(tankName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, ...summary, ...rank }));
    return;
  }

  // Get version summary
  var versionsMatch = req.url.match(/^\/api\/versions\/([^\/]+)$/);
  if (versionsMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(versionsMatch[1]);
    var db = require('./db').init();
    var versions = db.prepare(`
      SELECT cv,
        COUNT(*) as total,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as winRate
      FROM matches WHERE tankName = ? AND cv IS NOT NULL
      GROUP BY cv ORDER BY cv
    `).all(tankName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, versions }));
    return;
  }

  // Get map statistics
  var mapsMatch = req.url.match(/^\/api\/maps\/([^\/]+)$/);
  if (mapsMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(mapsMatch[1]);
    var db = require('./db').init();
    var maps = db.prepare(`
      SELECT mapId,
        COUNT(*) as total,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as winRate
      FROM matches WHERE tankName = ?
      GROUP BY mapId ORDER BY total DESC
    `).all(tankName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, maps }));
    return;
  }

  // Get matches
  var matchesMatch = req.url.match(/^\/api\/matches\/([^\/]+)$/);
  if (matchesMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(matchesMatch[1]);
    var url = new URL(req.url, 'http://localhost');
    var limit = parseInt(url.searchParams.get('limit') || '50');
    var cv = url.searchParams.get('cv') ? parseInt(url.searchParams.get('cv')) : null;
    var mapId = url.searchParams.get('map') || null;
    var won = url.searchParams.get('won') !== null ? (url.searchParams.get('won') === 'true' ? 1 : 0) : null;
    var db = require('./db').init();
    var sql = 'SELECT urlId, ts, mapId, cv, won, reason, myShots, meStars, rankChanges, opponentName FROM matches WHERE tankName = ?';
    var params = [tankName];
    if (cv !== null) { sql += ' AND cv = ?'; params.push(cv); }
    if (mapId) { sql += ' AND mapId = ?'; params.push(mapId); }
    if (won !== null) { sql += ' AND won = ?'; params.push(won); }
    sql += ' ORDER BY ts DESC LIMIT ?';
    params.push(limit);
    var matches = db.prepare(sql).all(...params);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, matches }));
    return;
  }

  // Get rank history
  var rankMatch = req.url.match(/^\/api\/rank-history\/([^\/]+)$/);
  if (rankMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(rankMatch[1]);
    var url = new URL(req.url, 'http://localhost');
    var limit = parseInt(url.searchParams.get('limit') || '50');
    var db = require('./db').init();
    var history = db.prepare(`
      SELECT ts, myRankScore as rankScore, myRankTier as rankTier, cv
      FROM matches WHERE tankName = ? AND myRankScore IS NOT NULL
      ORDER BY ts DESC LIMIT ?
    `).all(tankName, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, history }));
    return;
  }

  // Get opponents
  var opponentsMatch = req.url.match(/^\/api\/opponents\/([^\/]+)$/);
  if (opponentsMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(opponentsMatch[1]);
    var url = new URL(req.url, 'http://localhost');
    var limit = parseInt(url.searchParams.get('limit') || '20');
    var db = require('./db').init();
    var opponents = db.prepare(`
      SELECT 
        opponentName,
        COUNT(*) as total,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as winRate
      FROM matches 
      WHERE tankName = ? AND opponentName IS NOT NULL AND opponentName != ''
      GROUP BY opponentName
      HAVING total >= 3
      ORDER BY total DESC LIMIT ?
    `).all(tankName, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, opponents }));
    return;
  }

  // Compare versions
  var compareMatch = req.url.match(/^\/api\/compare\/([^\/]+)$/);
  if (compareMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(compareMatch[1]);
    var url = new URL(req.url, 'http://localhost');
    var cv1 = parseInt(url.searchParams.get('cv1'));
    var cv2 = parseInt(url.searchParams.get('cv2'));
    var mapId = url.searchParams.get('map') || null;
    if (isNaN(cv1) || isNaN(cv2)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'cv1 and cv2 required' }));
      return;
    }
    var db = require('./db').init();
    var sql = `
      SELECT cv,
        COUNT(*) as total,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        ROUND(SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as winRate
      FROM matches WHERE tankName = ? AND cv IN (?, ?)
    `;
    var params = [tankName, cv1, cv2];
    if (mapId) { sql += ' AND mapId = ?'; params.push(mapId); }
    sql += ' GROUP BY cv';
    var comparison = db.prepare(sql).all(...params);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, mapId: mapId || 'all', comparison }));
    return;
  }

  // Version x Map matrix
  var matrixMatch = req.url.match(/^\/api\/matrix\/([^\/]+)$/);
  if (matrixMatch && req.method === 'GET') {
    var tankName = decodeURIComponent(matrixMatch[1]);
    var db = require('./db').init();
    var rows = db.prepare('SELECT cv, mapId, COUNT(*) as total, SUM(CASE WHEN won=1 THEN 1 ELSE 0 END) as wins, ROUND(AVG(won)*100,1) as winRate FROM matches WHERE tankName=? AND cv IS NOT NULL GROUP BY cv, mapId ORDER BY cv, mapId').all(tankName);
    var cvs = [...new Set(rows.map(r => r.cv))].sort((a,b) => a - b);
    var maps = [...new Set(rows.map(r => r.mapId))].sort();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tank: tankName, cvs, maps, rows }));
    return;
  }

  // Parse pathname to support query strings like /arena.html?preview=1
  var pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch(e) { pathname = req.url; }
  if (pathname === '/') pathname = '/arena.html';
  // Prevent path traversal
  if (pathname.indexOf('..') >= 0) { res.writeHead(403); res.end('Forbidden'); return; }
  var filePath = path.join(__dirname, pathname);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  var ext = path.extname(filePath);
  var mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, function() {
  console.log('Dashboard: http://localhost:' + PORT);
  console.log('Sync via: POST http://localhost:' + PORT + '/sync');
  console.log('Register tank via: POST http://localhost:' + PORT + '/api/tanks');
});
