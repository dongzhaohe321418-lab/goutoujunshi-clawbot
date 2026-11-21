// The pinned Tencent CLI prints the scannable URL on its own line; PIN prompts have no newline.
export function loginOutput(onEvent) {
  let buffer = '';
  let expectUrl = false;
  const pin = /输入手机微信显示的数字，以继续连接：|你输入的数字不匹配，请重新输入：/;
  return chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.includes('你可以访问以下链接以继续')) expectUrl = true;
      else if (expectUrl && /^(https?:\/\/|weixin:\/\/)\S+$/.test(line)) {
        expectUrl = false;
        onEvent('qr', line);
      } else if (line.includes('正在验证')) onEvent('scanned');
      else if (line.includes('已将此 OpenClaw 连接到微信') || line.includes('已连接过此 OpenClaw')) onEvent('confirmed');
      if (pin.test(line)) onEvent('pin');
    }
    if (pin.test(buffer)) { buffer = ''; onEvent('pin'); }
    if (buffer.length > 32768) buffer = buffer.slice(-16384);
  };
}
