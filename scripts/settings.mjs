import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export function readSettings(env, root) {
  const localCodex = env.CLAWBOT_MODEL_MODE === 'local-codex';
  if (localCodex && (env.CLAWBOT_LOCAL !== '1' || env.BIND_ADDRESS !== '127.0.0.1')) {
    throw new Error('复用 Codex 登录需要本机模式并绑定 127.0.0.1');
  }
  const required = localCodex ? ['ADMIN_PASSWORD'] : ['ADMIN_PASSWORD', 'MODEL_API_KEY', 'MODEL_ID'];
  for (const key of required) {
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
  const gatewayPort = Number(env.CLAWBOT_GATEWAY_PORT || (env.CLAWBOT_LOCAL === '1' ? 17644 : 19637));
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535 ||
      gatewayPort === Number(env.PORT || 10000)) throw new Error('网关需要独立的有效端口');
  const model = localCodex ? (env.CLAWBOT_CODEX_MODEL?.trim() || 'gpt-5.6-sol') : env.MODEL_ID.trim();
  return { state, config: path.join(state, 'openclaw.json'), root, baseUrl: baseUrl.href,
    localCodex, gatewayPort, model, nativeHome: env.CODEX_HOME || path.join(os.homedir(), '.codex'), vision: env.MODEL_VISION !== 'false', port: Number(env.PORT || 10000) };
}

export function writeConfig(s) {
  fs.mkdirSync(s.state, { recursive: true, mode: 0o700 });
  const cfg = fs.existsSync(s.config) ? JSON.parse(fs.readFileSync(s.config, 'utf8')) : {};
  const token = cfg.gateway?.auth?.token || randomBytes(32).toString('hex');
  cfg.gateway = { mode: 'local', bind: 'loopback', port: s.gatewayPort,
    controlUi: { enabled: false }, auth: { mode: 'token', token } };
  const modelRef = (s.localCodex ? 'openai/' : 'junshi/') + s.model;
  cfg.agents = { defaults: { workspace: path.join(s.root, 'agent'), skipBootstrap: true,
    model: { primary: modelRef } } };
  if (s.localCodex) {
    delete cfg.models;
    cfg.agents.defaults.models = { [modelRef]: { agentRuntime: { id: 'codex' } } };
    cfg.plugins ??= {};
    cfg.plugins.entries ??= {};
    const appServer = { homeScope: 'user', sandbox: 'read-only', approvalPolicy: 'never' };
    if (process.platform === 'darwin') {
      // Native sign-in stays available while personal skills are hidden from this assistant.
      appServer.command = '/usr/bin/sandbox-exec';
      appServer.args = ['-D', 'AGENT_SKILLS=' + path.join(os.homedir(), '.agents', 'skills'),
        '-D', 'CODEX_SKILLS=' + path.join(s.nativeHome, 'skills'),
        '-f', path.join(s.root, 'scripts', 'local-skills.sb'),
        '/usr/bin/env', 'codex', 'app-server', '--listen', 'stdio://'];
    }
    cfg.plugins.entries.codex = { enabled: true, config: {
      appServer,
      sessionCatalog: { enabled: false }
    } };
  } else {
    if (cfg.plugins?.entries?.codex?.config?.appServer?.homeScope === 'user') {
      cfg.plugins.entries.codex = { enabled: false };
    }
    cfg.models = { providers: { junshi: { api: 'openai-completions', baseUrl: s.baseUrl,
      apiKey: { source: 'env', provider: 'default', id: 'MODEL_API_KEY' },
      models: [{ id: s.model, name: s.model, input: s.vision ? ['text', 'image'] : ['text'] }] } } };
  }
  cfg.session = { dmScope: 'per-account-channel-peer' };
  cfg.tools = { allow: ['read'], fs: { workspaceOnly: true } };
  const temp = s.config + '.tmp-' + randomBytes(6).toString('hex');
  fs.writeFileSync(temp, JSON.stringify(cfg, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, s.config);
}

export async function ensureCodexPlugin(run) {
  const version = '2026.11.6';
  let installed;
  try {
    installed = JSON.parse(await run(['plugins', 'inspect', 'codex', '--json'], true));
  } catch {}
  if (installed?.plugin?.version !== version || !installed.install) {
    await run(['plugins', 'install', 'npm:@openclaw/codex@' + version]);
  }
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
