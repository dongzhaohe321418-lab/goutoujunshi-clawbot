import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function readSettings(env, root) {
  for (const key of ['MODEL_API_KEY', 'MODEL_ID', 'ADMIN_PASSWORD']) {
    if (!env[key]?.trim()) throw new Error('缺少环境变量 ' + key);
  }
  if (env.ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD 至少需要 16 个字符');
  const baseUrl = new URL(env.MODEL_BASE_URL || 'https://api.openai.com/v1');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
  if (!(baseUrl.protocol === 'https:' || (local && baseUrl.protocol === 'http:')) ||
      baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('MODEL_BASE_URL 应为 HTTPS API 地址，本机测试可使用 HTTP');
  }
  const data = path.resolve(env.CLAWBOT_DATA_DIR || path.join(root, '.data'));
  const state = path.join(data, 'state');
  return { state, config: path.join(state, 'openclaw.json'), root, baseUrl: baseUrl.href,
    model: env.MODEL_ID.trim(), vision: env.MODEL_VISION !== 'false', port: Number(env.PORT || 10000) };
}

export function writeConfig(s) {
  fs.mkdirSync(s.state, { recursive: true, mode: 0o700 });
  const cfg = fs.existsSync(s.config) ? JSON.parse(fs.readFileSync(s.config, 'utf8')) : {};
  const token = cfg.gateway?.auth?.token || randomBytes(32).toString('hex');
  cfg.gateway = { mode: 'local', bind: 'loopback', port: 19637,
    controlUi: { enabled: false }, auth: { mode: 'token', token } };
  cfg.agents = { defaults: { workspace: path.join(s.root, 'agent'), skipBootstrap: true,
    model: { primary: 'junshi/' + s.model } } };
  cfg.models = { providers: { junshi: { api: 'openai-completions', baseUrl: s.baseUrl,
    apiKey: { source: 'env', provider: 'default', id: 'MODEL_API_KEY' },
    models: [{ id: s.model, name: s.model, input: s.vision ? ['text', 'image'] : ['text'] }] } } };
  cfg.session = { dmScope: 'per-account-channel-peer' };
  cfg.tools = { allow: ['read'], fs: { workspaceOnly: true } };
  const temp = s.config + '.tmp-' + randomBytes(6).toString('hex');
  fs.writeFileSync(temp, JSON.stringify(cfg, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, s.config);
}

export function hasBinding(state) {
  const dir = path.join(state, 'openclaw-weixin');
  const index = path.join(dir, 'accounts.json');
  if (!fs.existsSync(index)) return false;
  const ids = JSON.parse(fs.readFileSync(index, 'utf8'));
  if (!Array.isArray(ids) || !ids.length) return false;
  return ids.every(id => {
    if (typeof id !== 'string' || !/^[a-z\d@._-]+$/i.test(id)) return false;
    const f = path.join(dir, 'accounts', id + '.json');
    if (!fs.existsSync(f)) return false;
    const account = JSON.parse(fs.readFileSync(f, 'utf8'));
    return typeof account.token === 'string' && account.token.trim() &&
      typeof account.userId === 'string' && Boolean(account.userId.trim());
  });
}
