// Test the pinned web server in a fresh profile without a model or EDA process.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(root, 'runtime', 'smoke-home-'));
const node = path.join(root, '.tools/node_modules/node-win-x64/bin/node.exe');
const bin = path.join(root, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js');
const env = { ...process.env, DSH_HOME: home, PATH: `${path.dirname(node)};${process.env.PATH}` };
for (const name of Object.keys(env)) {
  if (/KEY|PASSWORD|SECRET|TOKEN/i.test(name)) delete env[name];
}
const child = spawn(node, [bin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
});
let exited = false;
let output = '';
let resolveURL;
let rejectURL;
const ready = new Promise((resolve, reject) => { resolveURL = resolve; rejectURL = reject; });
child.on('error', rejectURL);
child.on('exit', (code, signal) => { exited = true; rejectURL(new Error(`DSH exited ${code}/${signal}`)); });
function collect(chunk) {
  output = (output + chunk.toString()).slice(-300000);
  const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*[?&]token=[A-Za-z0-9._~%-]+/);
  if (match) resolveURL(match[0]);
}
child.stdout.on('data', collect);
child.stderr.on('data', collect);
const timer = setTimeout(() => rejectURL(new Error('DSH startup exceeded 90 seconds')), 90000);
(async () => {
  const result = { version: '0.2.1-rc.2', home, verifiedAt: new Date().toISOString() };
  try {
    const url = await ready;
    clearTimeout(timer);
    const first = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    assert.equal(first.status, 303, 'token URL must redirect after cookie authentication');
    const cookies = first.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookies, 'authentication cookie must be returned');
    const cleanURL = new URL(first.headers.get('location'), url);
    assert.equal(cleanURL.search, '', 'redirect must remove token');
    const page = await fetch(cleanURL, { headers: { cookie: cookies }, signal: AbortSignal.timeout(10000) });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<html/i);
    Object.assign(result, { passed: true, origin: cleanURL.origin, tokenExchangeStatus: first.status,
      authenticatedPageStatus: page.status, htmlBytes: Buffer.byteLength(html), modelTested: false, edaTested: false });
  } catch (error) {
    Object.assign(result, { passed: false, error: String(error) });
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (!exited) {
      // This child remains owned and live; /T covers only its descendants.
      const stop = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
      result.cleanupExitCode = stop.status;
      if (stop.status !== 0) process.exitCode = 1;
    }
    const redacted = output.replace(/([?&]token=)[^\s\x1b"'<>]+/g, '$1[REDACTED]');
    fs.writeFileSync(path.join(root, 'evidence/dsh-smoke.log'), redacted);
    fs.writeFileSync(path.join(root, 'evidence/dsh-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
})();
