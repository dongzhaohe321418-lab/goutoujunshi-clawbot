import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, writeConfig, ensureCodexPlugin } from '../scripts/settings.mjs';

test('only the loopback launcher can reuse native Codex sign-in', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'junshi-local-model-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { CLAWBOT_LOCAL:'1', CLAWBOT_MODEL_MODE:'local-codex', BIND_ADDRESS:'127.0.0.1',
    ADMIN_PASSWORD:'synthetic-admin-password', CLAWBOT_DATA_DIR:root };
  const s = readSettings(env, root);
  writeConfig(s);
  const cfg = JSON.parse(fs.readFileSync(s.config, 'utf8'));
  const app = cfg.plugins.entries.codex.config;
  assert.equal(app.appServer.homeScope, 'user');
  assert.equal(app.appServer.sandbox, 'read-only');
  assert.equal(app.sessionCatalog.enabled, false);
  assert.deepEqual(cfg.tools.allow, ['read']);
  assert.equal(cfg.session.dmScope, 'per-account-channel-peer');
  assert.equal(cfg.agents.defaults.models[cfg.agents.defaults.model.primary].agentRuntime.id, 'codex');
  assert.equal(cfg.models, undefined);
  assert.throws(() => readSettings({ ...env, BIND_ADDRESS:'0.0.0.0' }, root));
  assert.throws(() => readSettings({ ...env, CLAWBOT_LOCAL:'0' }, root));
  assert.throws(() => readSettings({ ...env, CLAWBOT_MODEL_MODE:'' }, root));
});

test('install the pinned Codex plugin once for a new local profile', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[1] === 'inspect') throw new Error('new profile');
  };
  await ensureCodexPlugin(run);
  assert.deepEqual(calls[1], ['plugins','install','npm:@openclaw/codex@2026.11.6']);
  await ensureCodexPlugin(async args => {
    assert.equal(args[1], 'inspect');
    return JSON.stringify({ plugin:{version:'2026.11.6'}, install:{source:'npm'} });
  });
});
