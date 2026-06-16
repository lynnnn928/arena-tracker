// [DEPRECATED] 此文件已归档，不再使用。
// 动态看板由 arena.html（客户端渲染，API 驱动）替代。
// 保留用于参考和历史比较。
// 最后使用版本：v3 (2026-06-15)

const db = require('./db');
const fs = require('fs');
const path = require('path');
db.init();
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
// Order from config, not alphabetical
const tanks = Object.keys(cfg.tanks).filter(function(name) {
  return db.query('SELECT COUNT(*) as c FROM matches WHERE tankName=?', [name])[0].c > 0;
});
const activeTank = cfg.activeTank || tanks[0] || 'RedStar';

function binMatchesByTime(matches) {
  if (!matches || matches.length === 0) return [];
  var sorted = matches.slice().sort((a,b) => a.ts < b.ts ? -1 : 1);
  var minT = new Date(sorted[0].ts).getTime();
  var maxT = new Date(sorted[sorted.length-1].ts).getTime();
  var span = maxT - minT;
  var binCount = Math.min(40, Math.max(5, Math.floor(matches.length / 40)));
  var binSize = span / binCount;
  if (binSize < 60000) { binSize = 60000; binCount = Math.ceil(span / binSize); }
  var bins = [];
  for (var i = 0; i < binCount; i++) {
    var lo = minT + i * binSize;
    var hi = lo + binSize;
    var inBin = sorted.filter(m => { var t = new Date(m.ts).getTime(); return t >= lo && t < hi; });
    if (inBin.length === 0) continue;
    var wins = inBin.filter(m => m.won).length;
    bins.push({
      label: new Date(lo).toISOString().slice(5,16),
      total: inBin.length, wins: wins,
      winRate: Math.round(wins / inBin.length * 1000) / 10,
      avgRankDelta: Math.round(inBin.reduce((s,m) => s+(m.rankChanges||0),0)/inBin.length)
    });
  }
  return bins;
}

function sampleRankByHour(records) {
  var byKey = {};  // key = "2026-06-09T13"
  records.forEach(function(r) {
    var key = r.ts.slice(0, 14);
    if (!byKey[key] || r.ts > byKey[key].ts) byKey[key] = r;
  });
  return Object.keys(byKey).sort().map(function(k) { return byKey[k]; });
}

function sampleRankByDay(records) {
  var byKey = {};
  records.forEach(function(r) {
    var key = r.ts.slice(0, 10);
    if (!byKey[key] || r.ts > byKey[key].ts) byKey[key] = r;
  });
  return Object.keys(byKey).sort().map(function(k) { return byKey[k]; });
}

function shortMapName(id) {
  const map = {"classic":"Classic","arena":"Arena","public-map-55":"TelePuz","public-map-53":"MOBA","public-map-16":"Zen","public-map-15":"MudMaze","public-map-6":"HideSeek","public-map-1":"Smile","random":"Random"};
  return map[id] || id;
}

function buildData() {
  var data = { tanks: [], generatedAt: new Date().toISOString() };
  tanks.forEach(function(tank) {
    var summary = db.getMatchSummary(tank);
    var mapBk = db.getMapBreakdown(tank);
    var verSum = db.getVersionSummary(tank);
    var verMat = db.getVersionMapMatrix(tank);
    var allM = db.getAllMatchesCompact(tank);
    var rankH = db.getRankHistory(tank);
    var matchRankH = db.getMatchRankHistory(tank);
    // Deduplicate consecutive same scores for cleaner chart
    var lastScore = null;
    var dedupedRankH = matchRankH.filter(function(r) {
      if (r.rankScore === lastScore) return false;
      lastScore = r.rankScore;
      return true;
    });
    var cvSet = {}, mapSet = {};
    verMat.forEach(function(r) { cvSet[r.cv] = true; mapSet[r.mapId] = true; });
    var cvs = Object.keys(cvSet).sort(function(a,b) { return Number(a) - Number(b); });
    var maps = Object.keys(mapSet).sort();
    var matrix = cvs.map(function(cv) {
      var row = { cv: Number(cv) };
      maps.forEach(function(mapId) {
        var cell = verMat.find(r => r.cv === Number(cv) && r.mapId === mapId);
        row[mapId] = cell ? { total: cell.total, wins: cell.wins, winRate: cell.winRate } : null;
      });
      return row;
    });
    var timeBins = binMatchesByTime(allM);
    var rankedMatches = allM.filter(m => m.rankChanges !== null && m.rankChanges !== undefined);
    data.versionNotes = db.getVersionNotes();
    data.mapCache = db.getMapCache();
    data.tanks.push({
      name: tank, summary, mapBreakdown: mapBk, versionSummary: verSum,
      matrix: { cvs, maps, rows: matrix },
      allMatches: allM, rankHistory: rankH, matchRankHistory: dedupedRankH,
      hourlyRankHistory: sampleRankByHour(dedupedRankH),
      dailyRankHistory: sampleRankByDay(dedupedRankH),
      timeBins: timeBins,
      rankedMatchCount: rankedMatches.length,
      totalRankDelta: rankedMatches.reduce((s,m) => s+(m.rankChanges||0),0)
    });
  });
  return data;
}

function renderHtml(data) {
  const jsonData = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arena Tracker</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
var CHARTS = {}; // Alias for backward compat
(function(){if(typeof Chart!=='undefined')return;
var s=document.createElement('script');
s.src='https://unpkg.com/chart.js@4/dist/chart.umd.min.js';
s.onerror=function(){console.error('Chart.js failed to load from both CDNs')};
document.head.appendChild(s);})();
</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f0e8;color:#2d1f0f;padding:20px;max-width:1400px;margin:0 auto}
.tab-row{display:flex;gap:6px;flex-wrap:wrap}
.tab{padding:7px 16px;border-radius:6px;border:1px solid #d4c5a9;cursor:pointer;background:#faf7f2;color:#6b5c4a;font-size:13px;user-select:none}
.tab:hover{background:#ebe5d9}
.tab.active{background:#a02020;color:#fff;border-color:#a02020}
.tank-tab{font-weight:500}
.page{display:none}
.page.active{display:block}
.card{background:#fff;border:1px solid #d4c5a9;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.card h3{font-size:14px;color:#6b5c4a;margin-bottom:12px;font-weight:600}
.stat-row{display:flex;gap:16px;flex-wrap:wrap}
.stat{text-align:center;min-width:80px;padding:8px 12px;background:#faf7f2;border-radius:6px;border:1px solid #d4c5a9}
.stat .value{font-size:24px;font-weight:600;color:#2d1f0f}
.stat .label{font-size:11px;color:#6b5c4a;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px}
.chart-box{position:relative;height:280px;margin-bottom:8px}
.chart-box-sm{position:relative;height:220px;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid #ebe5d9;white-space:nowrap}
th{color:#6b5c4a;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
td{color:#2d1f0f}
.win{color:#5a7d3a}
.loss{color:#a02020}
.cell{text-align:center;padding:4px 6px;font-size:12px;border:1px solid #ebe5d9;min-width:48px}
.cell-good{background:#e8f5e1;color:#5a7d3a}
.cell-ok{background:#f0f5e8;color:#7a9d5a}
.cell-mid{background:#f5f0e0;color:#c9a227}
.cell-bad{background:#f5e8e0;color:#d4764a}
.cell-terrible{background:#f5e1e1;color:#a02020}
.cell-empty{background:#faf7f2;color:#9a8b78}
.legend-row{display:flex;gap:12px;font-size:11px;margin:8px 0;flex-wrap:wrap;color:#6b5c4a}
.legend-item{display:flex;align-items:center;gap:4px}
.legend-dot{width:12px;height:12px;border-radius:2px;display:inline-block}
.paginator{display:flex;align-items:center;gap:12px;margin-top:12px;padding:8px 0}
.paginator button{padding:4px 14px;border-radius:4px;border:1px solid #d4c5a9;cursor:pointer;background:#faf7f2;color:#2d1f0f;font-size:13px}
.paginator button:hover{background:#ebe5d9}
.paginator button:disabled{opacity:0.4;cursor:default}
.paginator span{font-size:13px;color:#6b5c4a}
.filter-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.filter-bar select{padding:4px 8px;border-radius:4px;border:1px solid #d4c5a9;background:#fff;color:#2d1f0f;font-size:12px}
.filter-bar select:focus{outline:none;border-color:#a02020}
.updated{font-size:11px;color:#9a8b78;text-align:right;margin-top:8px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:900px){.grid-2{grid-template-columns:1fr}}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500}
.badge-plat{background:#e0f0f8;color:#3a7ca5}
.badge-gold{background:#f5f0e0;color:#c9a227}
.badge-grandmaster{background:#f5e1e1;color:#a02020}
.copy-btn{padding:3px 10px;font-size:11px;border:1px solid #d4c5a9;border-radius:4px;background:#faf7f2;color:#6b5c4a;cursor:pointer}
.copy-btn:hover{background:#ebe5d9;color:#2d1f0f}
.tank-avatar{width:48px;height:48px;background:#d4960a;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;margin-right:12px;flex-shrink:0}
.tank-header{display:flex;align-items:center;margin-bottom:12px}
.tank-info{flex:1}
.tank-name{font-size:20px;font-weight:700;color:#2d1f0f;margin-bottom:2px}
.tank-meta{font-size:12px;color:#6b5c4a}
.with-claude{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;background:#e0f0f8;color:#3a7ca5;margin-left:8px}
.rank-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.rank-grandmaster{background:#f5e1e1;color:#a02020}
.rank-diamond{background:#e0f0f8;color:#3a7ca5}
.rank-platinum{background:#e0f8f0;color:#3a7ca5}
.rank-gold{background:#f5f0e0;color:#c9a227}
.rank-silver{background:#f0f0f0;color:#6b5c4a}
.header-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #d4c5a9}
.sync-btn{padding:4px 12px;font-size:12px;background:#a02020;border:1px solid #801818;color:#fff;border-radius:4px;cursor:pointer}
.sync-btn:hover{background:#801818}
.tier-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500}
.tier-master{background:#f5e1e1;color:#a02020}
.tier-champion{background:#f5f0e0;color:#c9a227}
.tier-platinum{background:#e0f0f8;color:#3a7ca5}
.tier-gold{background:#f5f0e0;color:#c9a227}
.tier-silver{background:#f0f0f0;color:#6b5c4a}
.tier-bronze{background:#f5e8e0;color:#d4764a}
.rank-filter{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
.rank-filter select,.rank-filter button{padding:4px 8px;border-radius:4px;border:1px solid #d4c5a9;background:#fff;color:#2d1f0f;font-size:12px;cursor:pointer}
.rank-filter button:hover{background:#ebe5d9}
.rank-filter button.active{background:#a02020;color:#fff;border-color:#a02020}
</style>
</head>
<body>

<div class="header-bar">
<div class="tank-header">
<div class="tank-avatar">⭐</div>
<div class="tank-info">
<div class="tank-name" data-i18n="title">Agentank 坦克数据分析基地</div>
<div class="tank-meta">${data.tanks.length} <span data-i18n="tanksRegistered">tanks registered</span> | ${data.tanks.reduce((s,t) => s+t.allMatches.length, 0)} <span data-i18n="totalMatches">total matches</span></div>
</div>
</div>
<div style="text-align:right;font-size:11px;color:#6b5c4a;white-space:nowrap">
<div style="margin-bottom:4px">
<span id="langZh" style="cursor:pointer;padding:2px 8px;border-radius:4px;background:#a02020;color:#fff;border:1px solid #d4c5a9;font-size:11px" onclick="switchLang('zh')">中文</span>
<span id="langEn" style="cursor:pointer;padding:2px 8px;border-radius:4px;background:#faf7f2;color:#6b5c4a;border:1px solid #d4c5a9;font-size:11px" onclick="switchLang('en')">EN</span>
</div>
<div>${data.generatedAt}</div>
<div style="margin-top:4px"><button id="syncBtn" onclick="syncData()" class="sync-btn" data-i18n="syncData">Sync Data</button><span id="syncStatus" style="margin-left:6px;color:#6b5c4a"></span></div>
</div>
</div>

<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
${data.tanks.map((t,i) => `<div class="tab tank-tab${i===0?' active':''}" onclick="switchTank('${t.name}')">${t.name}</div>`).join('')}
<div class="tab" onclick="showRegisterForm()" style="color:#a02020;font-weight:600;border-color:#a02020">+</div>
</div>

  <div class="tab-row" id="sectionTabs" style="margin-bottom:20px">
<div class="tab active" data-section="overview" onclick="switchSection('overview')" data-i18n="sections.overview">概览</div>
<div class="tab" data-section="versions" onclick="switchSection('versions')" data-i18n="sections.versions">版本矩阵</div>
<div class="tab" data-section="maps" onclick="switchSection('maps')" data-i18n="sections.maps">地图分析</div>
<div class="tab" data-section="matches" onclick="switchSection('matches')" data-i18n="sections.matches">比赛记录</div>
<div class="tab" data-section="rank" onclick="switchSection('rank')" data-i18n="sections.rank">排位追踪</div>
<div class="tab" data-section="iterations" onclick="switchSection('iterations')" data-i18n="sections.iterations">迭代历史</div>
</div>

${data.tanks.map(function(tank) {
  const s = tank.summary;
  var h = '';

  // === OVERVIEW ===
  h += `<div class="page active" id="page-${tank.name}-overview">
<div class="stat-row">
<div class="stat"><div class="value">${s.total||0}</div><div class="label" data-i18n="stats.total">场次</div></div>
<div class="stat"><div class="value">${s.winRate||0}%</div><div class="label" data-i18n="stats.winRate">胜率</div></div>
<div class="stat"><div class="value">${s.wins||0}</div><div class="label" data-i18n="stats.wins">胜场</div></div>
<div class="stat"><div class="value">${(s.total||0)-(s.wins||0)}</div><div class="label" data-i18n="stats.losses">负场</div></div>
<div class="stat"><div class="value">${s.noShotGames||0}</div><div class="label" data-i18n="stats.noShot">未射击</div></div>
<div class="stat"><div class="value">${tank.matchRankHistory && tank.matchRankHistory.length>0 ? tank.matchRankHistory[tank.matchRankHistory.length-1].rankScore : '-'}</div><div class="label" data-i18n="stats.rankScore">排位分数</div></div>
<div class="stat"><div class="value">${tank.rankedMatchCount}</div><div class="label" data-i18n="stats.withRankDelta">有排位变化</div></div>
<div class="stat"><div class="value">${tank.totalRankDelta>=0?'+':''}${tank.totalRankDelta}</div><div class="label" data-i18n="stats.netRankDelta">净排位变化</div></div>
</div>
<div class="grid-2" style="margin-top:16px">
<div class="card"><h3 data-i18n="charts.winRateByVer">各版本胜率</h3><div class="chart-box"><canvas id="c-${tank.name}-ver"></canvas></div></div>
<div class="card"><h3 data-i18n="charts.winRateOverTime">胜率趋势</h3><div class="chart-box"><canvas id="c-${tank.name}-time"></canvas></div></div>
</div>`;
  if (tank.matchRankHistory && tank.matchRankHistory.length > 1) {
    h += `<div class="card"><h3 data-i18n="charts.rankScoreHistory">排位分数历史</h3> (${tank.matchRankHistory.length} <span data-i18n="charts.uniqueScoreChanges">个唯一分数变化</span>)<div class="chart-box-sm"><canvas id="c-${tank.name}-rank"></canvas></div></div>`;
  }
  h += `</div>`;

  // === VERSIONS ===
  h += `<div class="page" id="page-${tank.name}-versions">
<div class="card"><h3 data-i18n="charts.versionXMap">版本 x 地图 胜率</h3><p style="font-size:12px;color:#6b5c4a;margin-bottom:4px" data-i18n="charts.versionXMapDesc">行 = 代码版本, 列 = 地图 (垂直滚动)</p>
<div class="legend-row">
<div class="legend-item"><span class="legend-dot" style="background:#5a7d3a"></span> >=60%</div>
<div class="legend-item"><span class="legend-dot" style="background:#7a9d5a"></span> 50-59%</div>
<div class="legend-item"><span class="legend-dot" style="background:#c9a227"></span> 40-49%</div>
<div class="legend-item"><span class="legend-dot" style="background:#d4764a"></span> 25-39%</div>
<div class="legend-item"><span class="legend-dot" style="background:#a02020"></span> <25%</div>
<div class="legend-item"><span class="legend-dot" style="background:#faf7f2;border:1px solid #d4c5a9"></span> <span data-i18n="charts.noData">无数据</span></div>
</div>
<table><tr><th>Version / Map</th>${tank.matrix.maps.map(m => `<th>${shortMapName(m)}</th>`).join('')}<th data-i18n="charts.total">合计</th></tr>
${tank.matrix.rows.map(function(row) {
  var allCells = tank.matrix.maps.map(function(mapId) { return row[mapId]; }).filter(Boolean);
  var totalGames = allCells.reduce(function(s,c) { return s + c.total; }, 0);
  var totalWins = allCells.reduce(function(s,c) { return s + c.wins; }, 0);
  var totalWr = totalGames > 0 ? Math.round(totalWins / totalGames * 1000) / 10 : null;
  return `<tr><td style="font-weight:500">v${row.cv}</td>${tank.matrix.maps.map(function(mapId) {
    var cell = row[mapId];
    if (!cell) return '<td class="cell cell-empty">-</td>';
    var cls = cell.winRate >= 60 ? 'cell-good' : cell.winRate >= 50 ? 'cell-ok' : cell.winRate >= 40 ? 'cell-mid' : cell.winRate >= 25 ? 'cell-bad' : 'cell-terrible';
    return `<td class="cell ${cls}">${cell.winRate}%<br><span style="font-size:10px;opacity:0.7">${cell.wins}/${cell.total}</span></td>`;
  }).join('')}<td class="cell ${totalWr >= 50 ? 'cell-good' : 'cell-terrible'}" style="font-weight:600">${totalWr === null ? '-' : totalWr + '%'}<br><span style="font-size:10px;opacity:0.7">${totalWins}/${totalGames}</span></td></tr>`;
}).join('')}</table></div></div>`;

  // === MAPS ===
  h += `<div class="page" id="page-${tank.name}-maps">
<div class="card"><h3 data-i18n="maps.breakdown">地图分布</h3><div class="chart-box"><canvas id="c-${tank.name}-maps"></canvas></div></div>
<div class="card"><h3 data-i18n="maps.stats">地图统计</h3>
<table><tr><th data-i18n="maps.map">地图</th><th data-i18n="maps.matches">场次</th><th data-i18n="maps.wins">胜场</th><th data-i18n="maps.winRate">胜率</th><th data-i18n="maps.noShot">未射击</th><th data-i18n="maps.avgShots">平均射击</th><th data-i18n="maps.versions">版本</th></tr>
${tank.mapBreakdown.map(function(m) {
  var vr = m.firstCv === m.lastCv ? 'v' + m.firstCv : 'v' + m.firstCv + '-' + m.lastCv;
  return `<tr><td style="font-weight:500">${shortMapName(m.mapId)}</td><td>${m.total}</td><td>${m.wins}</td><td class="${m.winRate>=50?'win':'loss'}">${m.winRate}%</td><td>${m.noShotGames||0}</td><td>${m.avgShots||0}</td><td style="font-size:11px;color:#6b5c4a">${vr}</td></tr>`;
}).join('')}</table></div>`;

  // Map info card (only in maps page)
  if (data.mapCache && data.mapCache.length > 0) {
    h += `<div class="card"><h3>地图信息（从回放推算）</h3><table><tr><th>地图</th><th>尺寸</th><th>格数</th><th>策略分类</th></tr>`;
    data.mapCache.forEach(function(m) {
      var tacticLabel = m.tactic === 'tiny' ? '<span style="color:#d29922">Tiny</span>' : m.tactic === 'open' ? 'Open' : m.tactic;
      h += `<tr><td style="font-weight:500">${shortMapName(m.mapId)}</td><td>${m.mapW}×${m.mapH}</td><td>${m.cells}</td><td>${tacticLabel}</td></tr>`;
    });
    h += `</table></div>`;
  }
  h += `</div>`;

  // === MATCHES ===
  h += `<div class="page" id="page-${tank.name}-matches">
<div class="card"><h3 data-i18n="matches.allMatches">所有比赛</h3> <span style="font-weight:400;color:#6b5c4a;font-size:12px">(${tank.allMatches.length} total)</span>
<div class="filter-bar">
<select id="filt-${tank.name}-map" onchange="filterMatches('${tank.name}')"><option value="" data-i18n="matches.allMaps">所有地图</option>${tank.matrix.maps.map(m => `<option value="${m}">${shortMapName(m)}</option>`).join('')}</select>
<select id="filt-${tank.name}-cv" onchange="filterMatches('${tank.name}')"><option value="" data-i18n="matches.allVersions">所有版本</option>${tank.versionSummary.map(v => `<option value="${v.cv}">v${v.cv}</option>`).join('')}</select>
<select id="filt-${tank.name}-result" onchange="filterMatches('${tank.name}')"><option value="" data-i18n="matches.allResults">所有结果</option><option value="win" data-i18n="matches.win">胜利</option><option value="loss" data-i18n="matches.loss">失败</option></select>
<select id="filt-${tank.name}-reason" onchange="filterMatches('${tank.name}')"><option value="" data-i18n="matches.allReasons">所有原因</option><option value="crashed">Crashed</option><option value="runTime">RunTime</option><option value="star">Star</option><option value="error">Error</option></select>
<button class="copy-btn" onclick="copyMatchTable('${tank.name}')" data-i18n="matches.copyTable">复制表格</button>
</div>
<div id="matchTableContainer-${tank.name}"></div>
<div class="paginator" id="paginator-${tank.name}">
<button id="prevBtn-${tank.name}" onclick="prevPage('${tank.name}')" data-i18n="matches.prev">上一页</button>
<span id="pageInfo-${tank.name}"></span>
<button id="nextBtn-${tank.name}" onclick="nextPage('${tank.name}')" data-i18n="matches.next">下一页</button>
</div></div></div>`;

  // === RANK ===
  h += `<div class="page" id="page-${tank.name}-rank">`;
  if (tank.matchRankHistory && tank.matchRankHistory.length > 1) {
    var hrCnt = tank.hourlyRankHistory.length;
    var dyCnt = tank.dailyRankHistory.length;
    h += `<div class="card"><h3 data-i18n="rank.history">排位分数历史</h3>
<div style="display:flex;gap:8px;margin-bottom:12px">
<button class="tab active" id="rankBtn-${tank.name}-hourly" onclick="setRankSample('${tank.name}','hourly')"><span data-i18n="rank.hourly">每小时</span> (${hrCnt})</button>
<button class="tab" id="rankBtn-${tank.name}-daily" onclick="setRankSample('${tank.name}','daily')"><span data-i18n="rank.daily">每日</span> (${dyCnt})</button>
</div>
<div class="chart-box"><canvas id="c-${tank.name}-rank-full"></canvas></div></div>
<div class="card"><h3 data-i18n="rank.timeline">排位时间线</h3>
<div class="rank-filter">
<select id="rankTierFilter-${tank.name}" onchange="filterRankTimeline('${tank.name}')">
<option value="">All Tiers</option>
<option value="master">Master</option>
<option value="champion">Champion</option>
<option value="platinum">Platinum</option>
<option value="gold">Gold</option>
<option value="silver">Silver</option>
<option value="bronze">Bronze</option>
</select>
<select id="rankCvFilter-${tank.name}" onchange="filterRankTimeline('${tank.name}')">
<option value="">All CV</option>
${tank.versionSummary.map(v => `<option value="${v.cv}">v${v.cv}</option>`).join('')}
</select>
<button id="rankSortTimeAsc-${tank.name}" class="active" onclick="sortRankTimeline('${tank.name}','timeAsc')">时间 ↑</button>
<button id="rankSortTimeDesc-${tank.name}" onclick="sortRankTimeline('${tank.name}','timeDesc')">时间 ↓</button>
</div>
<div id="rankTimelineContainer-${tank.name}"></div>
<div class="paginator" id="rankPaginator-${tank.name}">
<button id="rankPrevBtn-${tank.name}" onclick="rankPrevPage('${tank.name}')" data-i18n="matches.prev">上一页</button>
<span id="rankPageInfo-${tank.name}"></span>
<button id="rankNextBtn-${tank.name}" onclick="rankNextPage('${tank.name}')" data-i18n="matches.next">下一页</button>
</div></div>`;
  } else {
    h += '<div class="card"><p style="color:#6b5c4a" data-i18n="rank.noData">未找到排位数据。</p></div>';
  }
  h += '</div>';

  // === ITERATIONS ===
  h += `<div class="page" id="page-${tank.name}-iterations">
<div class="card"><h3 data-i18n="iterations.hypothesisTimeline">版本假设与结论时间线</h3><div class="chart-box-sm"><canvas id="c-${tank.name}-iter"></canvas></div></div>
<div id="iterTimeline-${tank.name}"></div>
</div>`;

  return h;
}).join('')}

<div class="updated"><span data-i18n="footer.generated">生成时间:</span> ${data.generatedAt} | ${data.tanks.reduce((s,t) => s+t.allMatches.length, 0)} <span data-i18n="footer.matchesTracked">场比赛已追踪</span>${data.generatedAt ? '<button id="syncBtn" onclick="syncData()" style="margin-left:12px;padding:2px 10px;font-size:11px;background:#a02020;border:1px solid #801818;color:#fff;border-radius:4px;cursor:pointer" data-i18n="syncData">同步数据</button><span id="syncStatus" style="margin-left:8px;font-size:11px;color:#6b5c4a"></span>' : ''}</div>

<script>
const DATA = ${jsonData};

var I18N = {
  zh: {
    title: 'Agentank 坦克数据分析基地',
    tanksRegistered: '辆坦克已注册',
    totalMatches: '场比赛',
    syncData: '同步数据',
    syncing: '同步中...',
    syncOk: '同步成功，正在重载...',
    syncError: '同步失败：',
    syncHint: '请启动服务器: node server.js',
    sections: {
      overview: '概览',
      versions: '版本矩阵',
      maps: '地图分析',
      matches: '比赛记录',
      rank: '排位追踪',
      iterations: '迭代历史'
    },
    stats: {
      total: '场次',
      winRate: '胜率',
      wins: '胜场',
      losses: '负场',
      noShot: '未射击',
      rankScore: '排位分数',
      withRankDelta: '有排位变化',
      netRankDelta: '净排位变化'
    },
    charts: {
      winRateByVer: '各版本胜率',
      winRateOverTime: '胜率趋势',
      rankScoreHistory: '排位分数历史',
      uniqueScoreChanges: '个唯一分数变化',
      winRate: '胜率 %',
      games: '场次',
      matches: '比赛',
      rankScoreHourly: '排位分数 (每小时)',
      versionXMap: '版本 x 地图 胜率',
      versionXMapDesc: '行 = 代码版本, 列 = 地图 (垂直滚动)',
      noData: '无数据',
      total: '合计'
    },
    maps: {
      breakdown: '地图分布',
      stats: '地图统计',
      map: '地图',
      matches: '场次',
      wins: '胜场',
      winRate: '胜率',
      noShot: '未射击',
      avgShots: '平均射击',
      versions: '版本',
      info: '地图信息（从回放推算）',
      mapName: '地图',
      size: '尺寸',
      cells: '格数',
      strategy: '策略分类'
    },
    matches: {
      allMatches: '所有比赛',
      allMaps: '所有地图',
      allVersions: '所有版本',
      allResults: '所有结果',
      allReasons: '所有原因',
      win: '胜利',
      loss: '失败',
      copyTable: '复制表格',
      prev: '上一页',
      next: '下一页'
    },
    rank: {
      history: '排位分数历史',
      hourly: '每小时',
      daily: '每日',
      timeline: '排位时间线',
      noData: '未找到排位数据。'
    },
    iterations: {
      hypothesisTimeline: '版本假设与结论时间线',
      noData: '暂无可迭代记录。',
      signal: '📊 信号:',
      rootCause: '🔍 根因:',
      theory: '💡 假设:',
      keyDiff: '🔧 关键改动:',
      target: '🎯 目标:',
      verifyData: '📋 验证数据:'
    },
    conclusions: {
      solved: '✅ 已解决',
      partial: '🟡 部分有效',
      failed: '❌ 无效',
      pending: '⏳ 待验证'
    },
    changeTypes: {
      bugfix: '🐛 修复 Bug',
      tuning: '🔧 参数调整',
      experiment: '🧪 实验',
      refactor: '🏗️ 重构',
      rollback: '↩️ 回滚'
    },
    scopes: {
      'single-map': '🗺️ 单地图',
      mechanic: '⚙️ 机制',
      general: '📐 通用',
      architecture: '🏛️ 架构'
    },
    register: {
      title: '注册坦克',
      tankName: '坦克名称',
      tankKey: '坦克密钥',
      register: '注册',
      cancel: '取消'
    },
    footer: {
      generated: '生成时间:',
      matchesTracked: '场比赛已追踪'
    }
  },
  en: {
    title: 'Agentank Tank Data Analysis Base',
    tanksRegistered: 'tanks registered',
    totalMatches: 'total matches',
    syncData: 'Sync Data',
    syncing: 'syncing...',
    syncOk: 'OK - reloading...',
    syncError: 'Error: ',
    syncHint: 'Start server with: node server.js',
    sections: {
      overview: 'Overview',
      versions: 'Version Matrix',
      maps: 'Map Analysis',
      matches: 'Match History',
      rank: 'Rank Tracking',
      iterations: 'Iteration History'
    },
    stats: {
      total: 'Matches',
      winRate: 'Win Rate',
      wins: 'Wins',
      losses: 'Losses',
      noShot: 'No-Shot',
      rankScore: 'Rank Score',
      withRankDelta: 'With RankDelta',
      netRankDelta: 'Net RankDelta'
    },
    charts: {
      winRateByVer: 'Win Rate by Version',
      winRateOverTime: 'Win Rate over Time',
      rankScoreHistory: 'Rank Score History',
      uniqueScoreChanges: 'unique score changes',
      winRate: 'Win Rate %',
      games: 'Games',
      matches: 'Matches',
      rankScoreHourly: 'Rank Score (hourly)',
      versionXMap: 'Version x Map Win Rate',
      versionXMapDesc: 'Rows = code versions, Columns = maps (vertical scroll)',
      noData: 'No data',
      total: 'Total'
    },
    maps: {
      breakdown: 'Map Breakdown',
      stats: 'Map Stats',
      map: 'Map',
      matches: 'Matches',
      wins: 'Wins',
      winRate: 'Win Rate',
      noShot: 'No-Shot',
      avgShots: 'Avg Shots',
      versions: 'Versions',
      info: 'Map Info (from replay analysis)',
      mapName: 'Map',
      size: 'Size',
      cells: 'Cells',
      strategy: 'Strategy'
    },
    matches: {
      allMatches: 'All Matches',
      allMaps: 'All Maps',
      allVersions: 'All Versions',
      allResults: 'All Results',
      allReasons: 'All Reasons',
      win: 'Win',
      loss: 'Loss',
      copyTable: 'Copy Table',
      prev: 'Prev',
      next: 'Next'
    },
    rank: {
      history: 'Rank Score History',
      hourly: 'Hourly',
      daily: 'Daily',
      timeline: 'Rank Timeline',
      noData: 'No rank data found in match records.'
    },
    iterations: {
      hypothesisTimeline: 'Version Hypothesis & Verdict Timeline',
      noData: 'No iteration records yet.',
      signal: '📊 Signal:',
      rootCause: '🔍 Root Cause:',
      theory: '💡 Theory:',
      keyDiff: '🔧 Key Change:',
      target: '🎯 Target:',
      verifyData: '📋 Verify Data:'
    },
    conclusions: {
      solved: '✅ Solved',
      partial: '🟡 Partial',
      failed: '❌ Failed',
      pending: '⏳ Pending'
    },
    changeTypes: {
      bugfix: '🐛 Bug Fix',
      tuning: '🔧 Tuning',
      experiment: '🧪 Experiment',
      refactor: '🏗️ Refactor',
      rollback: '↩️ Rollback'
    },
    scopes: {
      'single-map': '🗺️ Single Map',
      mechanic: '⚙️ Mechanic',
      general: '📐 General',
      architecture: '🏛️ Architecture'
    },
    register: {
      title: 'Register Tank',
      tankName: 'Tank Name',
      tankKey: 'Tank Key',
      register: 'Register',
      cancel: 'Cancel'
    },
    footer: {
      generated: 'Generated:',
      matchesTracked: 'matches tracked'
    }
  }
};

var currentLang = localStorage.getItem('lang') || 'zh';
function t(key) {
  var keys = key.split('.');
  var val = I18N[currentLang];
  for (var i = 0; i < keys.length; i++) { val = val && val[keys[i]]; }
  return val || key;
}
function i18n(key) {
  var keys = key.split('.');
  var val = I18N[currentLang];
  for (var i = 0; i < keys.length; i++) { val = val && val[keys[i]]; }
  return val || key;
}
function switchLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
  location.reload();
}
function updateI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    var text = t(key);
    if (text) el.textContent = text;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
    var key = el.getAttribute('data-i18n-html');
    var text = t(key);
    if (text) el.innerHTML = text;
  });
  var langZh = document.getElementById('langZh');
  var langEn = document.getElementById('langEn');
  if (langZh && langEn) {
    if (currentLang === 'zh') {
      langZh.style.background = '#a02020';
      langZh.style.color = '#fff';
      langEn.style.background = '#faf7f2';
      langEn.style.color = '#6b5c4a';
    } else {
      langEn.style.background = '#a02020';
      langEn.style.color = '#fff';
      langZh.style.background = '#faf7f2';
      langZh.style.color = '#6b5c4a';
    }
  }
}

var syncing = false;
function syncData() {
  if (syncing) return;
  syncing = true;
  var btn = document.getElementById('syncBtn');
  var st = document.getElementById('syncStatus');
  if (btn) btn.disabled = true;
  if (st) st.textContent = t('syncing');
  fetch(window.location.origin + '/sync', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { if (st) st.textContent = t('syncOk'); setTimeout(function() { location.reload(); }, 500); }
    else { if (st) st.textContent = t('syncError') + (d.message||'unknown'); syncing = false; if (btn) btn.disabled = false; }
  }).catch(function(e) {
    if (st) st.textContent = t('syncHint');
    syncing = false;
    if (btn) btn.disabled = false;
  });
}
var charts = {};
var matchPage = {};
var matchFiltered = {};
var PAGE_SIZE = 50;
var currentTank = '${activeTank}';
var currentSection = 'overview';

function switchTank(name) {
  currentTank = name;
  document.querySelectorAll('.tank-tab').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tank-tab').forEach(function(el) { if (el.textContent.trim() === name) el.classList.add('active'); });
  showPage(name, currentSection);
  setTimeout(function() { renderSectionCharts(name, currentSection); }, 50);
}

function switchSection(section) {
  currentSection = section;
  document.querySelectorAll('[data-section]').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('[data-section]').forEach(function(el) { if (el.getAttribute('data-section') === section) el.classList.add('active'); });
  showPage(currentTank, section);
  setTimeout(function() { renderSectionCharts(currentTank, section); }, 50);
}

function showPage(tank, section) {
  document.querySelectorAll('.page').forEach(function(el) { el.classList.remove('active'); });
  var el = document.getElementById('page-' + tank + '-' + section);
  if (el) el.classList.add('active');
}

function renderSectionCharts(tankName, section) {
  Object.keys(charts).forEach(function(k) { if (k.startsWith(tankName)) { try { charts[k].destroy(); } catch(e) {} delete charts[k]; } });
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  if (section === 'overview') renderOverview(t);
  else if (section === 'maps') renderMapChart(t);
  else if (section === 'rank') { rankPage[tankName] = 0; renderRankChartWithSample(t, 'hourly'); }
  else if (section === 'matches') { matchPage[tankName] = 0; matchFiltered[tankName] = null; filterMatches(tankName); }
  else if (section === 'iterations') renderIterations(t);
}

function renderOverview(t) {
  var c1 = document.getElementById('c-' + t.name + '-ver');
  if (c1 && t.versionSummary.length > 0) { try {
    charts[t.name + '-ver'] = new Chart(c1, { type: 'bar', data: {
      labels: t.versionSummary.map(function(v) { return 'v' + v.cv; }),
      datasets: [
        { label: i18n('charts.winRate'), data: t.versionSummary.map(function(v) { return v.winRate; }),
          backgroundColor: t.versionSummary.map(function(v) { return v.winRate >= 50 ? '#5a7d3a' : '#a02020'; }),
          borderRadius: 4, yAxisID: 'y' },
        { label: i18n('charts.games'), data: t.versionSummary.map(function(v) { return v.total; }),
          backgroundColor: 'rgba(160,32,32,0.3)', borderRadius: 4, yAxisID: 'y1' }
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, grid: { color: '#ebe5d9' } },
                 y1: { beginAtZero: true, position: 'right', grid: { display: false } } },
        plugins: { legend: { labels: { color: '#6b5c4a' } } } }
    }); } catch(e) { console.warn('Chart ver:', e); }
  }
  var c2 = document.getElementById('c-' + t.name + '-time');
  if (c2 && t.timeBins.length > 1) { try {
    charts[t.name + '-time'] = new Chart(c2, { type: 'line', data: {
      labels: t.timeBins.map(function(b) { return b.label; }),
      datasets: [
        { label: i18n('charts.winRate'), data: t.timeBins.map(function(b) { return b.winRate; }),
          borderColor: '#5a7d3a', backgroundColor: 'rgba(90,125,58,0.1)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y' },
        { label: i18n('charts.matches'), data: t.timeBins.map(function(b) { return b.total; }),
          borderColor: 'rgba(160,32,32,0.5)', backgroundColor: 'rgba(160,32,32,0.05)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y1' }
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, grid: { color: '#ebe5d9' } },
                 y1: { beginAtZero: true, position: 'right', grid: { display: false } } },
        plugins: { legend: { labels: { color: '#6b5c4a' } } } }
    }); } catch(e) { console.warn('Chart time:', e); }
  }
  var c3 = document.getElementById('c-' + t.name + '-rank');
  if (c3 && t.matchRankHistory && t.matchRankHistory.length > 1) { try {
    charts[t.name + '-rank'] = new Chart(c3, { type: 'line', data: {
      labels: t.matchRankHistory.map(function(r) { return r.ts ? r.ts.slice(5,19).replace('T',' ') : ''; }),
      datasets: [{ label: i18n('charts.rankScoreHourly'), data: t.matchRankHistory.map(function(r) { return r.rankScore; }),
        borderColor: '#3a7ca5', backgroundColor: 'rgba(58,124,165,0.1)', fill: true, tension: 0.3, pointRadius: 2,
        borderWidth: 1.5 }]
    }, options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { grid: { color: '#ebe5d9' } } },
      plugins: { legend: { labels: { color: '#6b5c4a' } } } }
    }); } catch(e) { console.warn('Chart rank overview:', e); }
  }
}

function renderMapChart(t) {
  var ctx = document.getElementById('c-' + t.name + '-maps');
  if (!ctx || t.mapBreakdown.length === 0) return;
  try {
  charts[t.name + '-maps'] = new Chart(ctx, { type: 'bar', data: {
    labels: t.mapBreakdown.map(function(m) { return shortMapName(m.mapId); }),
    datasets: [
      { label: i18n('charts.winRate'), data: t.mapBreakdown.map(function(m) { return m.winRate; }),
        backgroundColor: t.mapBreakdown.map(function(m) { return m.winRate >= 60 ? '#5a7d3a' : m.winRate >= 50 ? '#7a9d5a' : m.winRate >= 40 ? '#c9a227' : m.winRate >= 25 ? '#d4764a' : '#a02020'; }),
        borderRadius: 4 },
      { label: i18n('charts.games'), data: t.mapBreakdown.map(function(m) { return m.total; }),
        backgroundColor: 'rgba(160,32,32,0.3)', borderRadius: 4, yAxisID: 'y1' }
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, grid: { color: '#ebe5d9' } },
               y1: { beginAtZero: true, position: 'right', grid: { display: false } } },
      plugins: { legend: { labels: { color: '#6b5c4a' } } } }
  }); } catch(e) { console.warn('Chart maps:', e); }
}

function renderRankChart(t) {
  renderRankChartWithSample(t, 'hourly');
}

function renderRankChartWithSample(t, mode) {
  var data = mode === 'daily' ? t.dailyRankHistory : t.hourlyRankHistory;
  if (!data || data.length < 2) {
    data = t.hourlyRankHistory || t.dailyRankHistory;
    if (!data || data.length < 2) return;
  }
  var ctx = document.getElementById('c-' + t.name + '-rank-full');
  if (!ctx) return;
  if (charts[t.name + '-rank-full']) { try { charts[t.name + '-rank-full'].destroy(); } catch(e) {} }
  try {
  charts[t.name + '-rank-full'] = new Chart(ctx, { type: 'line', data: {
    labels: data.map(function(r) { return r.ts ? r.ts.slice(5,19).replace('T',' ') : ''; }),
    datasets: [{ label: 'Rank Score (' + mode + ')', data: data.map(function(r) { return r.rankScore; }),
      borderColor: '#3a7ca5', backgroundColor: 'rgba(58,124,165,0.1)', fill: true, tension: 0.3, pointRadius: 3,
      borderWidth: 1.5 }]
  }, options: { responsive: true, maintainAspectRatio: false,
    scales: { y: { grid: { color: '#ebe5d9' } } },
    plugins: { legend: { labels: { color: '#6b5c4a' } } } }
  }); } catch(e) { console.warn('Chart rank:', e); }
  // Also render rank timeline table with same mode
  renderRankTimeline(t.name, mode);
}

var rankPage = {};
var RANK_PAGE_SIZE = 30;
var rankFilter = {};
var rankSort = {};

function setRankSample(tankName, mode) {
  document.getElementById('rankBtn-' + tankName + '-hourly').classList.remove('active');
  document.getElementById('rankBtn-' + tankName + '-daily').classList.remove('active');
  document.getElementById('rankBtn-' + tankName + '-' + mode).classList.add('active');
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  renderRankChartWithSample(t, mode);
}

function filterRankTimeline(tankName) {
  rankFilter[tankName] = {
    tier: document.getElementById('rankTierFilter-' + tankName).value,
    cv: document.getElementById('rankCvFilter-' + tankName).value
  };
  rankPage[tankName] = 0;
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  var mode = document.getElementById('rankBtn-' + tankName + '-hourly').classList.contains('active') ? 'hourly' : 'daily';
  renderRankTimeline(tankName, mode);
}

function sortRankTimeline(tankName, sortBy) {
  rankSort[tankName] = sortBy;
  document.querySelectorAll('[id^="rankSort"]').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('rankSort' + sortBy.charAt(0).toUpperCase() + sortBy.slice(1) + '-' + tankName).classList.add('active');
  rankPage[tankName] = 0;
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  var mode = document.getElementById('rankBtn-' + tankName + '-hourly').classList.contains('active') ? 'hourly' : 'daily';
  renderRankTimeline(tankName, mode);
}

function tierBadgeClass(tier) {
  if (!tier) return '';
  var t = tier.toLowerCase();
  if (t === 'master') return 'tier-master';
  if (t === 'champion') return 'tier-champion';
  if (t === 'platinum') return 'tier-platinum';
  if (t === 'gold') return 'tier-gold';
  if (t === 'silver') return 'tier-silver';
  if (t === 'bronze') return 'tier-bronze';
  return '';
}

function renderRankTimeline(tankName, mode) {
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  var list = mode === 'daily' ? t.dailyRankHistory : (t.hourlyRankHistory || t.matchRankHistory);
  if (!list || list.length === 0) return;

  // Apply filters
  var filter = rankFilter[tankName] || {};
  var filtered = list.filter(function(r) {
    if (filter.tier && r.rankTier !== filter.tier) return false;
    if (filter.cv && String(r.cv) !== filter.cv) return false;
    return true;
  });

  // Apply sort
  var sortBy = rankSort[tankName] || 'timeAsc';
  filtered.sort(function(a, b) {
    if (sortBy === 'timeDesc') return (b.ts || '').localeCompare(a.ts || '');
    return (a.ts || '').localeCompare(b.ts || '');
  });

  if (!rankPage[tankName]) rankPage[tankName] = 0;
  var page = rankPage[tankName];
  var total = filtered.length;
  var pages = Math.ceil(total / RANK_PAGE_SIZE);
  var start = page * RANK_PAGE_SIZE;
  var end = Math.min(start + RANK_PAGE_SIZE, total);
  var items = filtered.slice(start, end);
  var table = '<table><tr><th>Time</th><th>Rank Score</th><th>Tier</th><th>CV</th></tr>';
  items.forEach(function(r) {
    var tierClass = tierBadgeClass(r.rankTier);
    var hilite = r.ts === list[0].ts ? ' style="background:#faf7f2"' : '';
    table += '<tr' + hilite + '><td style="font-size:11px;color:#6b5c4a">' + (r.ts||'').slice(0,19) + '</td><td><b>' + r.rankScore + '</b></td><td><span class="tier-badge ' + tierClass + '">' + (r.rankTier||'-') + '</span></td><td>' + (r.cv||'-') + '</td></tr>';
  });
  table += '</table>';
  document.getElementById('rankTimelineContainer-' + tankName).innerHTML = table;
  document.getElementById('rankPageInfo-' + tankName).textContent = 'Page ' + (page + 1) + ' / ' + pages + ' (' + total + ' points)';
  document.getElementById('rankPrevBtn-' + tankName).disabled = page <= 0;
  document.getElementById('rankNextBtn-' + tankName).disabled = page >= pages - 1;
}

function rankPrevPage(tankName) { if ((rankPage[tankName] || 0) > 0) { rankPage[tankName]--; renderRankTimeline(tankName, document.getElementById('rankBtn-' + tankName + '-hourly').classList.contains('active') ? 'hourly' : 'daily'); } }
function rankNextPage(tankName) {
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  var mode = document.getElementById('rankBtn-' + tankName + '-hourly').classList.contains('active') ? 'hourly' : 'daily';
  var list = mode === 'daily' ? t.dailyRankHistory : (t.hourlyRankHistory || t.matchRankHistory);
  // Apply same filters as renderRankTimeline
  var filter = rankFilter[tankName] || {};
  var filtered = (list || []).filter(function(r) {
    if (filter.tier && r.rankTier !== filter.tier) return false;
    if (filter.cv && String(r.cv) !== filter.cv) return false;
    return true;
  });
  if ((rankPage[tankName] || 0) < Math.ceil(filtered.length / RANK_PAGE_SIZE) - 1) { rankPage[tankName]++; renderRankTimeline(tankName, mode); }
}

function conclusionColor(v) { return v === 'solved' ? '#5a7d3a' : v === 'partial' ? '#c9a227' : v === 'failed' ? '#a02020' : '#6b5c4a'; }
function conclusionLabel(v) { return i18n('conclusions.' + v) || '未知'; }
function changeTypeLabel(v) { return i18n('changeTypes.' + v) || v || '未知'; }
function scopeLabel(v) { return i18n('scopes.' + v) || v || '未知'; }

function renderIterations(t) {
  var notes = DATA.versionNotes || [];
  if (notes.length === 0) {
    document.getElementById('iterTimeline-' + t.name).innerHTML = '<p style="color:#6b5c4a">' + i18n('iterations.noData') + '</p>';
    return;
  }

  // Chart: version winrate with iteration markers
  try {
  var ctx = document.getElementById('c-' + t.name + '-iter');
  if (ctx && t.versionSummary.length > 0) {
    charts[t.name + '-iter'] = new Chart(ctx, { type: 'bar', data: {
      labels: t.versionSummary.map(function(v) { return 'v' + v.cv; }),
      datasets: [
        { label: i18n('charts.winRate'), data: t.versionSummary.map(function(v) { return v.winRate; }),
          backgroundColor: t.versionSummary.map(function(v) {
            var n = notes.find(function(x) { return x.version === v.cv; });
            return n ? conclusionColor(n.conclusion) : (v.winRate >= 50 ? '#5a7d3a' : '#a02020');
          }),
          borderRadius: 4 },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, grid: { color: '#ebe5d9' } } },
        plugins: {
          legend: { labels: { color: '#6b5c4a' } },
          tooltip: { callbacks: {
            afterLabel: function(c) {
              var cv = t.versionSummary[c.dataIndex].cv;
              var n = notes.find(function(x) { return x.version === cv; });
              return n ? conclusionLabel(n.conclusion) : '';
            }
          }}
        } }
    });
  } } catch(e) { console.warn('Chart iter:', e); }

  // Timeline
  var html = '';
  notes.forEach(function(n) {
    var v = t.versionSummary.find(function(x) { return x.cv === n.version; });
    var wr = v ? v.winRate + '% (' + v.wins + '/' + v.total + ')' : '暂无数据';
    html += '<div class="card" style="border-left:4px solid ' + conclusionColor(n.conclusion) + '">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px">';
    html += '<h3 style="margin:0;font-size:15px;color:#2d1f0f">v' + n.version + (n.parent_version ? ' ← v' + n.parent_version : '') + '</h3>';
    html += '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
    html += '<span class="badge" style="background:' + conclusionColor(n.conclusion) + ';color:#fff">' + conclusionLabel(n.conclusion) + '</span>';
    html += '<span class="badge" style="background:#faf7f2;color:#6b5c4a;border:1px solid #d4c5a9">' + changeTypeLabel(n.change_type) + '</span>';
    html += '<span class="badge" style="background:#faf7f2;color:#6b5c4a;border:1px solid #d4c5a9">' + scopeLabel(n.scope) + '</span>';
    html += ' <span style="font-size:12px;color:#6b5c4a">' + wr + '</span></span>';
    html += '</div>';
    if (n.signal) html += '<p style="font-size:13px;margin-bottom:6px"><span style="color:#c9a227">' + i18n('iterations.signal') + '</span> ' + escHtml(n.signal) + '</p>';
    if (n.root_cause) html += '<p style="font-size:13px;margin-bottom:6px"><span style="color:#a02020">' + i18n('iterations.rootCause') + '</span> ' + escHtml(n.root_cause) + '</p>';
    if (n.theory) html += '<p style="font-size:13px;margin-bottom:6px"><span style="color:#3a7ca5">' + i18n('iterations.theory') + '</span> ' + escHtml(n.theory) + '</p>';
    if (n.key_diff) html += '<p style="font-size:13px;margin-bottom:6px"><span style="color:#6b5c4a">' + i18n('iterations.keyDiff') + '</span> ' + escHtml(n.key_diff) + '</p>';
    if (n.target) html += '<p style="font-size:13px;margin-bottom:6px"><span style="color:#5a7d3a">' + i18n('iterations.target') + '</span> ' + escHtml(n.target) + '</p>';
    if (n.result_data) html += '<p style="font-size:13px;margin-bottom:6px"><span style="color:#c9a227">' + i18n('iterations.verifyData') + '</span> ' + escHtml(n.result_data) + '</p>';
    html += '<div style="font-size:11px;color:#6b5c4a;margin-top:6px">' + (n.ts ? n.ts.slice(0,19).replace('T',' ') : '') + '</div>';
    html += '</div>';
  });
  document.getElementById('iterTimeline-' + t.name).innerHTML = html;
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function filterMatches(tankName) {
  var t = DATA.tanks.find(function(x) { return x.name === tankName; });
  if (!t) return;
  var mapF = document.getElementById('filt-' + tankName + '-map').value;
  var cvF = document.getElementById('filt-' + tankName + '-cv').value;
  var resF = document.getElementById('filt-' + tankName + '-result').value;
  var reaF = document.getElementById('filt-' + tankName + '-reason').value;
  var list = t.allMatches;
  if (mapF) list = list.filter(function(m) { return m.mapId === mapF; });
  if (cvF) list = list.filter(function(m) { return String(m.cv) === cvF; });
  if (resF === 'win') list = list.filter(function(m) { return m.won; });
  else if (resF === 'loss') list = list.filter(function(m) { return !m.won; });
  if (reaF) list = list.filter(function(m) { return m.reason === reaF; });
  matchFiltered[tankName] = list;
  matchPage[tankName] = 0;
  renderMatchTable(tankName);
}

function renderMatchTable(tankName) {
  var list = matchFiltered[tankName];
  if (!list) { var t = DATA.tanks.find(function(x) { return x.name === tankName; }); if (t) list = t.allMatches; }
  if (!list) return;
  var page = matchPage[tankName] || 0;
  var pages = Math.ceil(list.length / PAGE_SIZE);
  var start = page * PAGE_SIZE;
  var end = Math.min(start + PAGE_SIZE, list.length);
  var items = list.slice(start, end);
  var table = '<table><tr><th>Time</th><th>Map</th><th>CV</th><th>Result</th><th>Reason</th><th>Shots</th><th>Stars</th><th>Source</th><th>RankDelta</th><th>Opponent</th></tr>';
  items.forEach(function(m) {
    var ts = m.ts ? m.ts.slice(5,19).replace('T', ' ') : '';
    table += '<tr><td style="font-size:11px;color:#6b5c4a">' + ts + '</td>' +
      '<td>' + shortMapName(m.mapId) + '</td>' +
      '<td>' + (m.cv || '-') + '</td>' +
      '<td class="' + (m.won ? 'win' : 'loss') + '">' + (m.won ? 'WIN' : 'LOSS') + '</td>' +
      '<td>' + (m.reason || '-') + '</td>' +
      '<td>' + (m.myShots || 0) + '</td>' +
      '<td>' + (m.meStars || 0) + '</td>' +
      '<td style="font-size:11px;color:#6b5c4a">' + (m.source || '-') + '</td>' +
      '<td>' + (m.rankChanges !== null && m.rankChanges !== undefined ? (m.rankChanges >= 0 ? '+' : '') + m.rankChanges : '-') + '</td>' +
      '<td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis">' + (m.opponentName || '-') + '</td></tr>';
  });
  table += '</table>';
  document.getElementById('matchTableContainer-' + tankName).innerHTML = table;
  document.getElementById('pageInfo-' + tankName).textContent = 'Page ' + (page + 1) + ' / ' + pages + ' (' + list.length + ' matches)';
  document.getElementById('prevBtn-' + tankName).disabled = page <= 0;
  document.getElementById('nextBtn-' + tankName).disabled = page >= pages - 1;
}

function prevPage(tankName) { if ((matchPage[tankName] || 0) > 0) { matchPage[tankName]--; renderMatchTable(tankName); } }
function nextPage(tankName) {
  var list = matchFiltered[tankName] || DATA.tanks.find(function(x) { return x.name === tankName; }).allMatches;
  if ((matchPage[tankName] || 0) < Math.ceil(list.length / PAGE_SIZE) - 1) { matchPage[tankName]++; renderMatchTable(tankName); }
}

function copyMatchTable(tankName) {
  var table = document.querySelector('#matchTableContainer-' + tankName + ' table');
  if (!table) return;
  var rows = [];
  table.querySelectorAll('tr').forEach(function(tr) {
    var cols = [];
    tr.querySelectorAll('th, td').forEach(function(td) { cols.push(td.textContent.trim()); });
    rows.push(cols.join('\\t'));
  });
  navigator.clipboard.writeText(rows.join('\\n')).catch(function() {
    var ta = document.createElement('textarea');
    ta.value = rows.join('\\n');
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function shortMapName(id) {
  var map = {"classic":"Classic","arena":"Arena","public-map-55":"TelePuz","public-map-53":"MOBA","public-map-16":"Zen","public-map-15":"MudMaze","public-map-6":"HideSeek","public-map-1":"Smile","random":"Random"};
  return map[id] || id;
}

// === Register Tank ===
function showRegisterForm() {
  var overlay = document.getElementById('registerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'registerOverlay';
    overlay.innerHTML = '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:999;display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)hideRegisterForm()">' +
      '<div style="background:#fff;border:1px solid #d4c5a9;border-radius:12px;padding:24px;width:400px;max-width:90%" onclick="event.stopPropagation()">' +
      '<h3 style="margin-bottom:16px;color:#2d1f0f">' + i18n('register.title') + '</h3>' +
      '<div style="margin-bottom:12px"><label style="display:block;font-size:12px;color:#6b5c4a;margin-bottom:4px">' + i18n('register.tankName') + '</label>' +
      '<input id="regName" type="text" placeholder="e.g. Kiko" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #d4c5a9;background:#faf7f2;color:#2d1f0f;font-size:13px;outline:none"></div>' +
      '<div style="margin-bottom:16px"><label style="display:block;font-size:12px;color:#6b5c4a;margin-bottom:4px">' + i18n('register.tankKey') + '</label>' +
      '<input id="regKey" type="password" placeholder="agtk_..." style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #d4c5a9;background:#faf7f2;color:#2d1f0f;font-size:13px;outline:none"></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button onclick="registerTank()" style="flex:1;padding:8px;border-radius:6px;border:none;background:#a02020;color:#fff;cursor:pointer;font-size:13px">' + i18n('register.register') + '</button>' +
      '<button onclick="hideRegisterForm()" style="flex:1;padding:8px;border-radius:6px;border:1px solid #d4c5a9;background:transparent;color:#6b5c4a;cursor:pointer;font-size:13px">' + i18n('register.cancel') + '</button>' +
      '</div>' +
      '<div id="regStatus" style="margin-top:12px;font-size:12px;color:#6b5c4a"></div>' +
      '</div></div>';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
}

function hideRegisterForm() {
  var overlay = document.getElementById('registerOverlay');
  if (overlay) overlay.style.display = 'none';
}

function registerTank() {
  var name = document.getElementById('regName').value.trim();
  var key = document.getElementById('regKey').value.trim();
  var st = document.getElementById('regStatus');
  if (!name || !key) { st.textContent = 'Please fill in both fields.'; st.style.color = '#f85149'; return; }
  st.textContent = 'Registering...'; st.style.color = '#8b949e';
  fetch('/api/tanks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, key: key }) })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        st.innerHTML = 'Registered! Reloading...';
        setTimeout(function() { location.reload(); }, 1000);
      } else {
        st.textContent = 'Failed: ' + (d.message || 'unknown');
        st.style.color = '#f85149';
      }
    })
    .catch(function(e) {
      st.textContent = 'Connection error. Make sure server is running.';
      st.style.color = '#f85149';
    });
}

document.addEventListener('DOMContentLoaded', function() {
  updateI18n();
  try { switchSection('overview'); } catch(e) { console.warn('Init error:', e); }
});
</script>
</body>
</html>`;
}

var data = buildData();
var html = renderHtml(data);
fs.writeFileSync(path.join(__dirname, 'arena.html'), html);
console.log('Dashboard built: arena.html');
console.log('Tanks: ' + data.tanks.map(t => t.name + ' (' + t.allMatches.length + ' matches)').join(', '));
db.close();
