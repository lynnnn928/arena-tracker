var fs = require('fs');
var path = require('path');
var { apiPost } = require('./lib/http');

var args = process.argv.slice(2);
var filePath = args[0];
var tankName = 'RedStar';
var notes = '';
var idx = 1;
while (idx < args.length) {
  if (args[idx] === '--tank' && args[idx+1]) { tankName = args[idx+1]; idx += 2; }
  else if (args[idx] === '--notes' && args[idx+1]) { notes = args[idx+1]; idx += 2; }
  else idx++;
}

if (!filePath) {
  console.log('Usage: node publish.js <file.js> [--tank name] [--notes "string"]');
  process.exit(1);
}

var config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
var tank = config.tanks[tankName];
if (!tank) { console.log('Tank not found: ' + tankName); process.exit(1); }

var absPath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(absPath)) { console.log('File not found: ' + absPath); process.exit(1); }
var code = fs.readFileSync(absPath, 'utf8');

var payload = { code: code, submittedBy: 'arena-cli', branch: 'main' };
if (notes) payload.notes = notes;

apiPost(tank.apiBase + '/agent/tank/code', tank.token, payload).then(function(d) {
  var ver = d.version ? d.version.version : (d.codeVersion || d.version);
  console.log('Published as v' + ver + ' for ' + tankName);
  console.log(ver);
}).catch(function(e) {
  console.log('Publish failed: ' + e.message);
  process.exit(1);
});
