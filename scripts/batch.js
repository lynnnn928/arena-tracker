var fs = require('fs');
var path = require('path');
var { apiPost } = require('./lib/http');
var config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

var args = process.argv.slice(2);
var N = 50;
var BATCH = null;
var MAP = 'random';
var tankName = config.activeTank || 'RedStar';

for (var i = 0; i < args.length; i++) {
  if (!isNaN(parseInt(args[i])) && BATCH === null) { N = parseInt(args[i]); continue; }
  if (!isNaN(parseInt(args[i]))) { BATCH = parseInt(args[i]); continue; }
  if (args[i] === '--tank' && args[i+1]) { tankName = args[i+1]; i++; }
  else if (args[i] === '--map' && args[i+1]) { MAP = args[i+1]; i++; }
  else if (!BATCH && isNaN(parseInt(args[i]))) BATCH = parseInt(args[i]);
}

var tank = config.tanks[tankName];
if (!tank) { console.log('Tank not found: ' + tankName); process.exit(1); }
if (!tank.id) { console.log('Tank ' + tankName + ' has no id. Run sync first.'); process.exit(1); }

var MY_ID = tank.id;
var baseUrl = tank.apiBase || 'https://agentank.ai/api';
if (!BATCH) { console.log('Usage: node batch.js <count> <cv> [--map M] [--tank X]'); process.exit(1); }

var results = { W: 0, L: 0, CR: 0, byMap: {} };
var replays = [];

function addResult(map, r) {
  if (!results.byMap[map]) results.byMap[map] = { W: 0, L: 0, CR: 0 };
  results.byMap[map][r]++;
  if (r === 'W') results.W++; else if (r === 'L') results.L++; else results.CR++;
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function runChallenge() {
  try {
    var d = await apiPost(baseUrl + '/agent/tank/challenge', tank.token, { randomOpponent: true, mapId: MAP });
    var mapId = d.mapId || 'unknown';
    var r;
    if (d.winnerTankId === MY_ID) { r = 'W'; } else if (d.winnerTankId && d.winnerTankId !== MY_ID) { r = 'L'; } else { r = 'CR'; }
    if (d.replayUri) replays.push({ r: r, map: mapId, urlId: d.replayUri.split('/').pop() || d.replayUri });
    return { r: r, map: mapId };
  } catch(e) { return { r: 'CR', map: 'error' }; }
}

async function main() {
  var start = Date.now();
  process.stdout.write('[' + tankName + '] v' + BATCH + ' (' + N + '): ');
  for (var i = 0; i < N; i++) {
    var out = await runChallenge();
    addResult(out.map, out.r);
    var pct = results.W+results.L > 0 ? Math.round(results.W/(results.W+results.L)*100) : 0;
    process.stdout.write('' + (i+1) + '/' + N + ' ' + results.W + 'W ' + results.L + 'L (' + pct + '%) ');
    if (i < N-1) await sleep(3000);
  }
  var elapsed = Math.round((Date.now()-start)/1000);
  console.log('\n=== [' + tankName + '] v' + BATCH + ' (' + N + 'g, ' + elapsed + 's) ===');
  console.log('Overall: ' + results.W + 'W ' + results.L + 'L ' + results.CR + 'C = ' + Math.round(results.W/(results.W+results.L+results.CR)*100) + '%');
  console.log('By map:');
  Object.keys(results.byMap).sort().forEach(function(k) {
    var m = results.byMap[k];
    var pct = m.W+m.L > 0 ? Math.round(m.W/(m.W+m.L)*100) : 0;
    console.log('  ' + k + ': ' + m.W + 'W ' + m.L + 'L ' + m.CR + 'C (' + pct + '%)');
  });
}

main().catch(function(e) { console.error('Batch failed:', e.message); process.exit(1); });
