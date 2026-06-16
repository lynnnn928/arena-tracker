var fs = require('fs');
var path = require('path');
var db = require('./db');
var { apiGet } = require('./lib/http');
var CONFIG_PATH = path.join(__dirname, '..', 'config.json');

db.init();

var args = process.argv.slice(2);
var filterTank = null;
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--tank' && args[i+1]) filterTank = args[i+1];
}

var config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
var tanks = Object.keys(config.tanks);
if (filterTank) {
  if (!config.tanks[filterTank]) { console.log('Tank not found: ' + filterTank); process.exit(1); }
  tanks = [filterTank];
}

function getRankChange(rankChanges, tankId) {
  if (!rankChanges || !Array.isArray(rankChanges)) return null;
  var found = null;
  rankChanges.forEach(function(r) { if (r.tankId === tankId) found = r; });
  return found;
}

async function syncTank(tankName, tankConfig) {
  var tankId = tankConfig.id;
  var token = tankConfig.token;
  var baseUrl = tankConfig.apiBase || 'https://agentank.ai/api';

  if (!tankId) {
    try {
      var info = await apiGet(baseUrl + '/agent/tank', token);
      tankId = info.tankId || info.id || (info.tank && info.tank.id);
      if (tankId) {
        tankConfig.id = tankId;
        config.tanks[tankName] = tankConfig;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('  Resolved ' + tankName + ' tankId = ' + tankId);
      } else {
        console.log('  Could not resolve tankId for ' + tankName + ', skipping');
        return { inserted: 0, total: 0 };
      }
    } catch(e) {
      console.log('  API error fetching tank info for ' + tankName + ': ' + (e.message || '').slice(0, 80));
      return { inserted: 0, total: 0 };
    }
  }

  var inserted = 0;
  var offset = 0;
  var pageSize = 100;

  while (true) {
    var resp;
    try {
      resp = await apiGet(baseUrl + '/agent/tank/matches?limit=' + pageSize + '&offset=' + offset, token);
    } catch(e) {
      console.log('  API error at offset ' + offset + ': ' + (e.message || '').slice(0, 120));
      break;
    }

    var matches = resp.matches || [];
    if (matches.length === 0) break;

    var ourMatches = matches.filter(function(m) {
      return m.challengerTankId === tankId || m.defenderTankId === tankId;
    });
    var pageNew = 0;
    var pageDup = 0;

    ourMatches.forEach(function(m) {
      if (db.matchExists(m.urlId)) {
        pageDup++;
        return;
      }
      var isChallenger = m.challengerTankId === tankId;
      var myRC = getRankChange(m.rankChanges, tankId);
      db.insertMatch({
        urlId: m.urlId, tankName: tankName, source: m.source || 'agent',
        cv: isChallenger ? m.challengerCodeVersion : m.defenderCodeVersion,
        mapId: m.mapId, mapW: null, mapH: null, tactic: null,
        won: m.winnerTankId === tankId ? 1 : 0, reason: m.resultReason || null,
        frames: null, myShots: null, oppShots: null, meStars: null, oppStars: null, noShot: null,
        rankChanges: myRC ? (myRC.afterRankScore - myRC.beforeRankScore) : null,
        myRankScore: myRC ? myRC.afterRankScore : null,
        myRankTier: myRC ? myRC.afterRankTier : null,
        opponentName: isChallenger ? m.defenderTankName : m.challengerTankName,
        opponentId: isChallenger ? m.defenderTankId : m.challengerTankId,
        opponentRankScore: isChallenger ? m.defenderRankScore : m.challengerRankScore,
        opponentCodeVersion: isChallenger ? m.defenderCodeVersion : m.challengerCodeVersion,
        myRunTime: null, opponentRunTime: null, excitementScore: m.excitementScore || null,
        ts: m.settledAt || m.createdAt
      });
      inserted++;
      pageNew++;
    });

    if (pageNew === 0 && pageDup > 0) {
      console.log('  [' + tankName + '] offset=' + offset + ': 0 new, all dup - caught up');
      break;
    }

    console.log('  [' + tankName + '] offset=' + offset + ': +' + pageNew + ' new (' + ourMatches.length + ' ours)');
    offset += pageSize;
  }

  return { inserted: inserted, total: db.query('SELECT COUNT(*) as c FROM matches WHERE tankName=?', [tankName])[0].c };
}

async function main() {
  var totalInserted = 0;
  for (var i = 0; i < tanks.length; i++) {
    var name = tanks[i];
    console.log('Syncing ' + name + '...');
    var r = await syncTank(name, config.tanks[name]);
    totalInserted += r.inserted;
  }
  console.log('Sync complete. ' + totalInserted + ' new matches inserted.');
  db.close();
}

main().catch(function(e) { console.error('Sync failed:', e.message); db.close(); process.exit(1); });
