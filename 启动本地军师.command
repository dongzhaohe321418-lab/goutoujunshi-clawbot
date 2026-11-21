#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export CLAWBOT_LOCAL=1 CLAWBOT_MODEL_MODE=local-codex BIND_ADDRESS=127.0.0.1
export CLAWBOT_DATA_DIR="${CLAWBOT_DATA_DIR:-$HOME/Library/Application Support/Goutoujunshi-ClawBot/local}"
export PORT="${PORT:-17643}"
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( PORT <= 65535 )) || { echo 'PORT 必须是 1 到 65535 之间的整数。'; exit 1; }
mkdir -p "$CLAWBOT_DATA_DIR"
lock="$CLAWBOT_DATA_DIR/launcher.pid"
ticket="$CLAWBOT_DATA_DIR/local-access"
url="http://127.0.0.1:$PORT/"

open_when_ready() {
  local pid="$1" attempt token
  [[ "${JUNSHI_NO_OPEN:-0}" != 1 ]] || return 0
  for ((attempt=0; attempt<120; attempt++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    # Check the listener's PID before handing the browser a private login link.
    if [[ -s "$ticket" ]] && /usr/sbin/lsof -nP -a -p "$pid" -iTCP@127.0.0.1:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      token="$(cat "$ticket")"
      [[ "$token" =~ ^[0-9a-f]{64}$ ]] || return 1
      printf 'open location "%s#local=%s"\n' "$url" "$token" | /usr/bin/osascript >/dev/null
      return 0
    fi
    sleep 1
  done
  echo '绑定页尚在启动。稍后再双击启动器即可打开。'
}

if ! /usr/bin/shlock -p "$$" -f "$lock"; then
  pid="$(tr -d '[:space:]' < "$lock")"
  [[ "$pid" =~ ^[0-9]+$ ]] || { echo '无法读取已运行的军师进程。'; exit 1; }
  echo "本地军师正在运行，绑定页位于 $url"
  open_when_ready "$pid"
  exit 0
fi
if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "端口 $PORT 正被其他服务使用。请改用空闲的 PORT 再启动。"
  exit 1
fi
if [[ ! -s "$ticket" ]]; then
  /usr/bin/openssl rand -hex 32 > "$ticket"
fi
chmod 600 "$ticket"
ADMIN_PASSWORD="$(cat "$ticket")"
[[ "$ADMIN_PASSWORD" =~ ^[0-9a-f]{64}$ ]] || { echo '本地登录票据格式错误，请检查个人数据目录。'; exit 1; }
export ADMIN_PASSWORD

version="$(cat .node-version)"
if [[ "$(node --version 2>/dev/null || true)" != "v$version" ]] || ! command -v npm >/dev/null; then
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) echo '此启动器支持 Apple 芯片和 Intel Mac。'; exit 1 ;;
  esac
  name="node-v$version-darwin-$arch"
  runtime="$CLAWBOT_DATA_DIR/runtime"
  if [[ ! -x "$runtime/$name/bin/node" ]]; then
    echo "正在下载 Node.js $version 到本地军师目录…"
    mkdir -p "$runtime"
    stage="$(mktemp -d "$runtime/.download.XXXXXX")"
    trap 'rm -rf "$stage"' EXIT
    source_url="https://nodejs.org/dist/v$version"
    curl -fsSL --retry 2 "$source_url/$name.tar.gz" -o "$stage/$name.tar.gz"
    curl -fsSL --retry 2 "$source_url/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
    (cd "$stage" && awk -v file="$name.tar.gz" '$2 == file { print; found=1 } END { if (!found) exit 1 }' SHASUMS256.txt | /usr/bin/shasum -a 256 -c -)
    tar -xzf "$stage/$name.tar.gz" -C "$stage"
    mv "$stage/$name" "$runtime/$name"
    rm -rf "$stage"
    trap - EXIT
  fi
  export PATH="$runtime/$name/bin:$PATH"
fi

if ! command -v codex >/dev/null; then
  export PATH="$CLAWBOT_DATA_DIR/codex/node_modules/.bin:$PATH:/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin"
fi
if ! command -v codex >/dev/null; then
  echo '正在安装本地测试所需的 Codex CLI…'
  npm install --prefix "$CLAWBOT_DATA_DIR/codex" --no-audit --no-fund @openai/codex@0.151.0
fi
if ! codex login status >/dev/null 2>&1; then
  echo '请在浏览器完成 Codex 登录，然后回到此窗口。'
  codex login
fi

fingerprint="$(/usr/bin/shasum -a 256 package-lock.json | awk '{print $1}')-$(uname -m)-$version"
stamp=node_modules/.junshi-local-lock
if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$fingerprint" || ! -f node_modules/openclaw/openclaw.mjs || ! -f node_modules/qrcode/package.json ]]; then
  echo '正在按锁文件准备 OpenClaw 和二维码组件…'
  npm ci --omit=dev --no-audit --no-fund
  printf '%s\n' "$fingerprint" > "$stamp"
fi
echo "正在启动本地军师。保留此窗口可持续收消息，按 Control-C 停止。"
echo "绑定页位于 $url"
open_when_ready "$$" &
exec node scripts/worker.mjs
