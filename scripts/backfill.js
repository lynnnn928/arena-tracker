const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const OUR_TANK_ID = 3654;
const OUR_TANK_NAME = 'RedStar';
const TMP_FILE = path.join(__dirname, '_backfill_tmp.json');

db.init();

const AUTH = 'agtk_f4e73b67953923eaf549d56f5b9c05483123';

function apiGetFile(url) {
  execSync('curl.exe -s --max-time 120 "' + url + '" -H "Authorization: Bearer ' + AUTH + '" --output "' + TMP_FILE + '"', {timeout: 130000});
  var raw = fs.readFileSync(TMP_FILE, 'utf8');
  return JSON.parse(raw);
}

function getRankChange(rankChanges, tankId) {
  if (!rankChanges || !Array.isArray(rankChanges)) return null;
  return rankChanges.find(function(r) { return r.tankId === tankId; }) || null;
}

function parseMatch(m) {
  var isChallenger = m.challengerTankId === OUR_TANK_ID;
  var myRC = getRankChange(m.rankChanges, OUR_TANK_ID);
  var won = m.winnerTankId === OUR_TANK_ID;

  return {
    urlId: m.urlId,
    tankName: OUR_TANK_NAME,
    source: m.source || 'ranked',
    cv: isChallenger ? m.challengerCodeVersion : m.defenderCodeVersion,
    mapId: m.mapId,
    won: won,
    reason: m.resultReason,
    rankChanges: myRC ? myRC.delta : null,
    myRankScore: myRC ? myRC.afterRankScore : null,
    myRankTier: isChallenger ? m.challengerRankTier : m.defenderRankTier,
    opponentName: isChallenger ? m.defenderTankName : m.challengerTankName,
    opponentId: isChallenger ? m.defenderTankId : m.challengerTankId,
    opponentRankScore: isChallenger ? m.defenderRankScore : m.challengerRankScore,
    opponentCodeVersion: isChallenger ? m.defenderCodeVersion : m.challengerCodeVersion,
    excitementScore: m.excitementScore,
    ts: m.settledAt || m.createdAt
  };
}

var totalInserted = 0;
var totalSkipped = 0;
var startOffset = 0;
var offset = startOffset;
var pageSize = 100;
var maxPages = 50;
var hasMore = true;

console.log('Starting backfill from offset ' + offset + '...');

for (var page = 0; page < maxPages && hasMore; page++) {
  var resp;
  try {
    resp = apiGetFile('https://agentank.ai/api/agent/tank/matches?limit=' + pageSize + '&offset=' + offset);
  } catch(e) {
    console.log('  API error at offset ' + offset + ': ' + (e.stderr || e.message || '').slice(0, 120));
    break;
  }

  var matches = resp.matches || resp;
  if (!matches || matches.length === 0) break;

  hasMore = resp.hasMore !== false;

  matches.forEach(function(m) {
    if (db.matchExists(m.urlId)) {
      totalSkipped++;
      return;
    }
    var data = parseMatch(m);
    db.insertMatch(data);
    totalInserted++;
  });

  offset += matches.length;
  console.log('  page ' + (page + 1) + ' (offset=' + offset + '): +' + matches.length + ' (' + totalInserted + ' new / ' + totalSkipped + ' dup) total=' + db.countMatches());
}

console.log('\nDone. Inserted: ' + totalInserted + ', Skipped (dups): ' + totalSkipped);
console.log('Total in DB: ' + db.countMatches() + ' matches');

var bySource = db.query('SELECT source, COUNT(*) as c FROM matches GROUP BY source ORDER BY c DESC');
console.log('By source:', JSON.stringify(bySource));

try { fs.unlinkSync(TMP_FILE); } catch(e) {}
db.close();
