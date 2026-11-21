const el = id => document.getElementById(id);
const labels = {
  preparing: '后台正在初始化，页面会自动更新。',
  idle: '正在准备微信二维码…', requesting: '正在向微信申请二维码…',
  scan: '打开手机微信的「扫一扫」，扫描下方二维码。',
  scanned: '请在手机微信上确认，正在等待验证。',
  pin: '请输入微信显示的数字。如果数字不匹配，请重新核对。',
  retry: '绑定未完成。', connecting: '正在启动军师，连接微信…',
  online: '军师后台已就绪。打开微信 ClawBot，发一段聊天或一张截图即可开始。',
  failed: '后台初始化失败，请查看部署平台日志。'
};
let phase;
async function post(route, body = {}) {
  const res = await fetch(route, { method: 'POST',
    headers: { 'X-ClawBot-Action': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('操作未完成，请稍后重试。');
}
async function refresh() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.status === 401 && ['localhost', '127.0.0.1'].includes(location.hostname)) {
      el('status').textContent = '请双击「启动本地军师.command」打开已授权的扫码页。';
      return;
    }
    if (!res.ok) throw new Error('连接中断，请刷新页面重新登录。');
    const data = await res.json();
    phase = data.phase;
    el('status').textContent = labels[phase] || '正在检查状态…';
    el('title').textContent = phase === 'online' ? '已连接微信' : '连接微信';
    el('error').textContent = data.error || '';
    el('qr').hidden = !data.qr;
    if (data.qr && el('qr').getAttribute('src') !== data.qr) el('qr').src = data.qr;
    if (!data.qr) el('qr').removeAttribute('src');
    el('verify').hidden = phase !== 'pin';
    el('action').hidden = !['retry', 'online'].includes(phase);
    el('action').textContent = phase === 'online' ? '重新绑定微信' : '重新获取二维码';
    if (phase === 'idle') await post('/api/bind');
  } catch (err) { el('error').textContent = err.message; }
  finally { setTimeout(refresh, 1500); }
}
el('verify').addEventListener('submit', async event => {
  event.preventDefault();
  const pin = el('pin').value;
  el('pin').value = '';
  try { await post('/api/pin', { pin }); } catch (err) { el('error').textContent = err.message; }
});
el('action').addEventListener('click', async () => {
  if (phase === 'online' && !confirm('重新扫码时，军师会暂时离线。继续吗？')) return;
  el('action').disabled = true;
  try { await post(phase === 'online' ? '/api/rebind' : '/api/bind'); }
  catch (err) { el('error').textContent = err.message; }
  finally { el('action').disabled = false; }
});
async function openBindingPage() {
  const ticket = new URLSearchParams(location.hash.slice(1)).get('local');
  if (ticket && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    history.replaceState(null, '', location.pathname);
    const res = await fetch('/api/local-session', { method: 'POST', headers: { 'X-ClawBot-Ticket': ticket } });
    if (!res.ok) {
      el('status').textContent = '本地登录链接已失效，请重新打开启动器。';
      return;
    }
  }
  await refresh();
}
openBindingPage().catch(() => { el('status').textContent = '连接失败，请重新打开绑定页。'; });
