var { execFileSync } = require('child_process');

function curlRequest(method, url, token, data) {
  var args = ['-sS', '-X', method, '-H', 'Authorization: Bearer ' + token, '-H', 'Accept: application/json'];
  if (data !== undefined && data !== null) {
    args.push('-H', 'Content-Type: application/json');
    args.push('--data-binary', JSON.stringify(data));
  }
  args.push('-w', '\n__HTTP_STATUS__:%{http_code}');
  args.push(url);
  var out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    var msg = (e.stderr || e.message || '').toString();
    return Promise.reject(new Error('curl error: ' + msg.slice(0, 200)));
  }
  var idx = out.lastIndexOf('__HTTP_STATUS__:');
  var statusCode = 0;
  var body = out;
  if (idx >= 0) {
    statusCode = parseInt(out.slice(idx + '__HTTP_STATUS__:'.length).trim(), 10) || 0;
    body = out.slice(0, idx).replace(/\n$/, '');
  }
  if (statusCode >= 200 && statusCode < 300) {
    try { return Promise.resolve(JSON.parse(body)); }
    catch (e) { return Promise.reject(new Error('Invalid JSON: ' + body.slice(0, 200))); }
  }
  return Promise.reject(new Error('HTTP ' + statusCode + ': ' + body.slice(0, 200)));
}

function apiGet(url, token) { return curlRequest('GET', url, token); }
function apiPost(url, token, data) { return curlRequest('POST', url, token, data || {}); }

module.exports = { apiGet, apiPost };
