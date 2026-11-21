import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { ensureCodexPlugin, hasBinding, readSettings, writeConfig } from './settings.mjs';
import { loginOutput } from './login-output.mjs';

process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const settings = readSettings(process.env, root);
const hash = value => createHash('sha256').update(value).digest();
const loginHash = hash('admin:' + process.env.ADMIN_PASSWORD);
const local = process.env.CLAWBOT_LOCAL === '1';
const localTicket = hash(process.env.ADMIN_PASSWORD);
const localSession = local ? randomBytes(32).toString('hex') : null;
const address = local ? '127.0.0.1' : (process.env.BIND_ADDRESS || '0.0.0.0');
const childEnv = { ...process.env, OPENCLAW_STATE_DIR: settings.state,
  OPENCLAW_CONFIG_PATH: settings.config, OPENCLAW_OAUTH_DIR: path.join(settings.state, 'credentials') };
delete childEnv.ADMIN_PASSWORD;
const cli = path.join(root, 'node_modules/openclaw/openclaw.mjs');
const children = new Set();
let stopping = false;
let phase = 'preparing', qr = null, login = null, gateway = null, retryTimer, readyTimer;
let lastError = '';
const files = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const staticFiles = new Map(Array.from(files, ([url, [name, type]]) =>
  [url, [fs.readFileSync(path.join(root, 'public', name)), type]]));

function child(args, stdio) {
  const p = spawn(process.execPath, [cli, ...args], { env: childEnv, stdio });
  children.add(p);
  p.once('close', () => children.delete(p));
  return p;
}

function run(args, capture = false) {
  return new Promise((resolve, reject) => {
    const p = child(args, capture ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'inherit', 'inherit']);
    let output = '';
    p.stdout?.setEncoding('utf8').on('data', part => { output += part; });
    p.once('error', reject);
    p.once('close', code => code === 0 ? resolve(output) : reject(new Error('OpenClaw 命令未完成：' + args.slice(0, 2).join(' '))));
  });
}

function startGateway() {
  if (stopping || gateway) return;
  phase = 'connecting';
  const p = gateway = child(['gateway', 'run'], ['ignore', 'inherit', 'inherit']);
  const probe = async () => {
    if (gateway !== p || stopping) return;
    try {
      const reply = await fetch('http://127.0.0.1:' + settings.gatewayPort + '/readyz', { signal: AbortSignal.timeout(1200) });
      if (reply.ok && gateway === p && !stopping) { phase = 'online'; return; }
    } catch {}
    if (gateway === p && !stopping) readyTimer = setTimeout(probe, 1500);
  };
  void probe();
  p.once('close', () => {
    if (gateway !== p) return;
    gateway = null;
    clearTimeout(readyTimer);
    if (!stopping) {
      phase = 'connecting';
      retryTimer = setTimeout(startGateway, 8000);
    }
  });
}

function beginLogin(rebind) {
  const allowed = rebind ? ['online', 'connecting'] : ['idle', 'retry'];
  if (stopping || login || !allowed.includes(phase)) return;
  // Pause the previous gateway before relinking. Never poll Weixin with two gateways.
  clearTimeout(retryTimer);
  clearTimeout(readyTimer);
  const oldGateway = gateway;
  gateway = null;
  qr = null;
  lastError = '';
  phase = 'requesting';
  if (oldGateway) {
    oldGateway.once('close', launchLogin);
    oldGateway.kill('SIGTERM');
  } else launchLogin();
}

function launchLogin() {
  if (stopping || login) return;
  const p = login = child(['channels', 'login', '--channel', 'openclaw-weixin'], ['pipe', 'pipe', 'pipe']);
  // The CLI owns QR renewal and PIN verification. Its raw output stays off the web and service console.
  let revision = 0, confirmed = false, exitTimer;
  const handle = loginOutput((event, value) => {
    if (login !== p || stopping) return;
    const current = ++revision;
    qr = null;
    if (event === 'qr') {
      phase = 'requesting';
      QRCode.toDataURL(value, { width: 300, margin: 4, errorCorrectionLevel: 'M' }).then(image => {
        if (current === revision && login === p) { qr = image; phase = 'scan'; }
      }).catch(() => p.kill());
    } else if (event === 'confirmed' && hasBinding(settings.state)) {
      confirmed = true;
      phase = 'connecting';
      p.stdin.end();
      // Some CLI versions keep an input stream alive after the plugin has saved the binding.
      exitTimer = setTimeout(() => p.kill('SIGTERM'), 1500);
    } else phase = event;
  });
  p.stdout.setEncoding('utf8').on('data', handle);
  p.stderr.resume();
  p.stdin.on('error', () => {});
  const deadline = setTimeout(() => p.kill(), 10 * 60_000);
  p.once('close', code => {
    clearTimeout(deadline);
    clearTimeout(exitTimer);
    login = null;
    qr = null;
    if (stopping) return;
    if ((code === 0 || confirmed) && hasBinding(settings.state)) startGateway();
    else { phase = 'retry'; lastError = '绑定未完成，可重新获取二维码。'; }
  });
}

function send(res, code, value, mime = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': mime });
  res.end(Buffer.isBuffer(value) ? value : JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  if (local) {
    const hosts = ['127.0.0.1:' + settings.port, 'localhost:' + settings.port];
    if (!hosts.includes(req.headers.host)) return send(res, 403, {});
    if (req.url.startsWith('/api/') && (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host))) return send(res, 403, {});
  }
  if (req.url === '/healthz' && req.method === 'GET') {
    return send(res, phase === 'failed' || phase === 'preparing' ? 503 : 200,
      { status: phase === 'failed' || phase === 'preparing' ? 'unavailable' : 'ok' });
  }
  const auth = req.headers.authorization || '';
  const value = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64') : Buffer.alloc(0);
  if (local && req.method === 'POST' && req.url === '/api/local-session') {
    const ticket = req.headers['x-clawbot-ticket'];
    if (typeof ticket !== 'string' || !timingSafeEqual(hash(ticket), localTicket)) return send(res, 403, {});
    res.setHeader('Set-Cookie', 'junshi=' + localSession + '; HttpOnly; SameSite=Strict; Path=/');
    return send(res, 200, {});
  }
  const publicLocalAsset = local && req.method === 'GET' && staticFiles.has(req.url);
  const localCookie = local && (req.headers.cookie || '').split(/;\s*/).some(item =>
    timingSafeEqual(hash(item), hash('junshi=' + localSession)));
  if (!publicLocalAsset && !localCookie && !timingSafeEqual(hash(value), loginHash)) {
    if (local) return send(res, 401, { error: '请通过本地启动器打开绑定页' });
    res.setHeader('WWW-Authenticate', 'Basic realm="ClawBot", charset="UTF-8"');
    return send(res, 401, { error: '请输入管理员账号和密码' });
  }
  if (req.method === 'GET') {
    const file = staticFiles.get(req.url);
    if (file) return send(res, 200, file[0], file[1]);
    if (req.url === '/api/status') return send(res, 200, { phase, qr, error: lastError });
  }
  if (req.method === 'POST' && ['/api/bind', '/api/rebind', '/api/pin'].includes(req.url)) {
    // Browsers cannot submit this custom header cross-origin without a successful CORS preflight.
    if (req.headers['x-clawbot-action'] !== '1') return send(res, 403, {});
    if (req.url !== '/api/pin') { beginLogin(req.url === '/api/rebind'); return send(res, 202, {}); }
    if (phase !== 'pin' || !login) return send(res, 409, {});
    try {
      let body = '';
      for await (const part of req) {
        body += part;
        if (body.length > 128) return send(res, 413, {});
      }
      const { pin } = JSON.parse(body);
      if (typeof pin !== 'string' || !/^\d{1,12}$/.test(pin)) return send(res, 400, {});
      if (phase !== 'pin' || !login?.stdin.writable) return send(res, 409, {});
      phase = 'scanned';
      login.stdin.write(pin + '\n');
      return send(res, 202, {});
    } catch { return send(res, 400, {}); }
  }
  send(res, 404, {});
});
server.headersTimeout = 15000;
server.requestTimeout = 15000;

async function prepare() {
  fs.mkdirSync(settings.state, { recursive: true, mode: 0o700 });
  if (settings.localCodex) await ensureCodexPlugin(run);
  if (stopping) return;
  writeConfig(settings);
  let installed;
  try { installed = JSON.parse(await run(['plugins', 'inspect', 'openclaw-weixin', '--json'], true)); } catch {}
  if (stopping) return;
  if (installed?.plugin?.version !== '2.4.10' || !installed.plugin.enabled || !installed.install) {
    await run(['plugins', 'install', 'npm:@tencent-weixin/openclaw-weixin@2.4.10']);
  }
  if (stopping) return;
  await run(['config', 'validate']);
  if (stopping) return;
  if (hasBinding(settings.state)) startGateway();
  else phase = 'idle';
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(retryTimer);
  clearTimeout(readyTimer);
  server.close();
  for (const p of children) p.kill('SIGTERM');
  setTimeout(() => { for (const p of children) p.kill('SIGKILL'); }, 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(settings.port, address, () => {
  console.log('微信军师绑定页已启动，端口 ' + settings.port);
  prepare().catch(err => {
    console.error(err.message);
    phase = 'failed'; lastError = '后台初始化失败，请查看部署平台日志。';
    process.exitCode = 1;
    shutdown();
  });
});
