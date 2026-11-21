import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, writeConfig, hasBinding } from '../scripts/settings.mjs';
import { loginOutput } from '../scripts/login-output.mjs';

test('partial QR output, QR rotation and PIN prompts', () => {
  const events = [];
  const parse = loginOutput((...event) => events.push(event));
  parse('若二维码未能显示或无法使用，你可以访问以下');
  parse('链接以继续：\nhttps://fixture.invalid/');
  parse('a\n正在验证\n输入手机微信显示的数字，');
  parse('以继续连接：');
  parse('❌ 你输入的数字不匹配，请重新输入：');
  parse('\n若二维码未能显示或无法使用，你可以访问以下链接以继续：\nhttps://fixture.invalid/b\n');
  assert.deepEqual(events,[['qr','https://fixture.invalid/a'],['scanned'],['pin'],['pin'],['qr','https://fixture.invalid/b']]);
});

test('redeploy preserves the gateway token and updates model settings without writing API credentials', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junshi-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { MODEL_ID:'first', MODEL_API_KEY:'synthetic-key-value',
    ADMIN_PASSWORD:'synthetic-admin-password', CLAWBOT_DATA_DIR:dir };
  const s = readSettings(env, dir);
  writeConfig(s);
  const original = JSON.parse(fs.readFileSync(s.config));
  const modified = { ...original, plugins:{ entries:{fixture:{enabled:true}} } };
  fs.writeFileSync(s.config, JSON.stringify(modified));
  writeConfig(readSettings({ ...env, MODEL_ID:'second' }, dir));
  const raw = fs.readFileSync(s.config, 'utf8');
  assert.ok(!raw.includes(env.MODEL_API_KEY) && !raw.includes(env.ADMIN_PASSWORD));
  const next = JSON.parse(raw);
  assert.equal(next.gateway.auth.token, original.gateway.auth.token);
  assert.equal(next.agents.defaults.model.primary, 'junshi/second');
  assert.deepEqual(next.plugins, modified.plugins);
  assert.equal(hasBinding(s.state), false);
  assert.throws(() => readSettings({ ...env, MODEL_BASE_URL:'http://remote.invalid' }, dir));
  assert.throws(() => readSettings({ ...env, ADMIN_PASSWORD:'short' }, dir));
});
