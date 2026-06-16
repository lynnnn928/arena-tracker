// record_iteration.js — record or update a version iteration note
// Usage:
//   node record_iteration.js <version> [options]

var d = require('./db');
d.init();

var version = parseInt(process.argv[2]);
if (!version) {
  console.log('Usage: node record_iteration.js <version> [options]');
  console.log('');
  console.log('Options (structured template):');
  console.log('  --parent N           Parent version number');
  console.log('  --signal             "what data indicated the problem"');
  console.log('  --root-cause         "root cause analysis"');
  console.log('  --theory             "hypothesis / theory behind the fix"');
  console.log('  --change-type        bugfix | tuning | experiment | refactor | rollback');
  console.log('  --scope              single-map | mechanic | general | architecture');
  console.log('  --key-diff           "key change summary"');
  console.log('  --target             "expected improvement target"');
  console.log('  --result-data        "actual results data"');
  console.log('  --conclusion         solved | partial | failed | pending');
  console.log('');
  console.log('Shortcut for quick notes (sets type=tuning, scope=mechanic):');
  console.log('  node record_iteration.js <version> --quick "one-line note"');
  process.exit(1);
}

var args = process.argv.slice(3);
function getFlag(name) {
  var idx = args.indexOf('--' + name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

var quickNote = getFlag('quick');
var existing = d.getVersionNote(version);

var note = {
  version: version,
  parent_version: parseInt(getFlag('parent')) || (existing ? existing.parent_version : null),
  signal: getFlag('signal') || (existing ? existing.signal : null),
  root_cause: getFlag('root-cause') || (existing ? existing.root_cause : null),
  theory: getFlag('theory') || (existing ? existing.theory : null),
  change_type: getFlag('change-type') || (existing ? existing.change_type : null),
  scope: getFlag('scope') || (existing ? existing.scope : null),
  key_diff: getFlag('key-diff') || (existing ? existing.key_diff : null),
  target: getFlag('target') || (existing ? existing.target : null),
  result_data: getFlag('result-data') || (existing ? existing.result_data : null),
  conclusion: getFlag('conclusion') || (existing ? existing.conclusion : 'pending')
};

if (quickNote) {
  note.signal = quickNote;
  note.change_type = note.change_type || 'tuning';
  note.scope = note.scope || 'mechanic';
}

d.insertVersionNote(note);
console.log('Version ' + version + ' note saved.');
if (quickNote) {
  console.log('  Quick: ' + quickNote);
} else {
  var keys = ['signal','root_cause','theory','change_type','scope','key_diff','target','result_data','conclusion'];
  keys.forEach(function(k) {
    if (note[k]) console.log('  ' + k + ': ' + (String(note[k]).slice(0, 120)));
  });
}
d.close();
