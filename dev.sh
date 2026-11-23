#!/usr/bin/env bash
# Local Linux development: ./dev.sh [dev|install|start|stop|restart|status|logs]
set -eo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
STATE="$ROOT/.dev"
PID_FILE="$STATE/server.pid"
LOG_FILE="$STATE/server.log"
ACTION="${1:-dev}"
export PORT="${PORT:-3000}"
export DEV_HOST="${DEV_HOST:-127.0.0.1}"

die() { echo "错误：$*" >&2; exit 1; }

load_runtime() {
  # nvm is normally only loaded in interactive terminals.
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh" --no-use
    nvm use --silent || die "请先运行 nvm install（版本见 .nvmrc）。"
  fi
  command -v node >/dev/null || die "请安装 Node.js 22。"
  node -e 'if (Number(process.versions.node.split(".")[0]) !== 22) process.exit(1)' \
    || die "请使用 Node.js 22，避免 SQLite 原生模块 ABI 不一致。"
  # Shell-only local settings must be loaded before Node starts (Next .env loading is too late).
  if [[ -f "$ROOT/.env.dev-shell" ]]; then
    source "$ROOT/.env.dev-shell"
  fi
  # Disable Next.js usage telemetry for this project's development commands.
  export NEXT_TELEMETRY_DISABLED=1
  if [[ "${DEV_NO_PROXY:-0}" == 1 ]]; then
    unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
    unset npm_config_proxy npm_config_https_proxy NPM_CONFIG_PROXY NPM_CONFIG_HTTPS_PROXY
    export NODE_USE_ENV_PROXY=0
  else
    if [[ -n "${DEV_PROXY_URL:-}" ]]; then
      export HTTP_PROXY="$DEV_PROXY_URL" HTTPS_PROXY="$DEV_PROXY_URL" ALL_PROXY="$DEV_PROXY_URL"
      export http_proxy="$DEV_PROXY_URL" https_proxy="$DEV_PROXY_URL" all_proxy="$DEV_PROXY_URL"
    fi
    # Node 22.21+ fetch needs this flag; setting HTTPS_PROXY alone is insufficient.
    if [[ -n "${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}" ]]; then
      export NODE_USE_ENV_PROXY=1
    fi
    local bypass="${NO_PROXY:-${no_proxy:-}}"
    export NO_PROXY="${bypass:+$bypass,}localhost,127.0.0.1,::1"
    export no_proxy="$NO_PROXY"
  fi
}

running() {
  [[ -f "$PID_FILE" ]] || return 1
  read -r SERVER_PID SERVER_BIRTH < "$PID_FILE" || return 1
  [[ "$SERVER_PID" =~ ^[0-9]+$ && "$SERVER_BIRTH" =~ ^[0-9]+$ ]] || return 1
  [[ -r "/proc/$SERVER_PID/stat" ]] || return 1
  # Match process creation time as well as PID so stale files cannot target a reused PID.
  [[ "$(awk '{print $22}' "/proc/$SERVER_PID/stat")" == "$SERVER_BIRTH" ]] || return 1
  [[ "$(awk '{print $3}' "/proc/$SERVER_PID/stat")" != Z ]] || return 1
  kill -0 "$SERVER_PID" 2>/dev/null
}

stop_server() {
  if ! running; then
    rm -f "$PID_FILE"
    echo "后台开发服务未运行。"
    return
  fi
  # start uses setsid, so the process group includes Next.js and its workers.
  kill -TERM -- "-$SERVER_PID"
  for ((i=0; i<40; i++)); do
    if ! running; then
      rm -f "$PID_FILE"
      echo "后台开发服务已停止。"
      return
    fi
    sleep 0.25
  done
  die "服务仍在退出，请检查日志后重试。"
}

case "$ACTION" in
  install)
    load_runtime
    if command -v corepack >/dev/null; then
      exec corepack pnpm install --frozen-lockfile
    fi
    command -v pnpm >/dev/null || die "请安装 Corepack 或 pnpm 10.33.0。"
    [[ "$(pnpm --version)" == 10.33.0 ]] || die "项目需要 pnpm 10.33.0。"
    exec pnpm install --frozen-lockfile
    ;;
  dev)
    load_runtime
    [[ -f node_modules/next/dist/bin/next ]] || die "请先运行 ./dev.sh install。"
    export FFMPEG_PATH="${FFMPEG_PATH:-$(command -v ffmpeg || true)}"
    export FFPROBE_PATH="${FFPROBE_PATH:-$(command -v ffprobe || true)}"
    [[ -x "$FFMPEG_PATH" && -x "$FFPROBE_PATH" ]] || die "请安装 ffmpeg 和 ffprobe。"
    export NODE_ENV=development
    export npm_package_version="$(node -p 'require("./package.json").version')"
    echo "ClipForge 开发服务：http://$DEV_HOST:$PORT（支持热更新）"
    exec node "$ROOT/node_modules/next/dist/bin/next" dev --hostname "$DEV_HOST" --port "$PORT"
    ;;
  start|restart)
    load_runtime
    command -v setsid >/dev/null || die "后台启动需要 Linux setsid。"
    command -v curl >/dev/null || die "启动检测需要 curl。"
    mkdir -p "$STATE"
    # Serialize background lifecycle commands; do not inherit this lock into the server.
    exec 9>"$STATE/control.lock"
    flock -n 9 || die "另一个启动/停止命令正在执行。"
    if [[ "$ACTION" == restart ]]; then stop_server; fi
    if running; then
      echo "后台开发服务已运行（PID $SERVER_PID）。日志：$LOG_FILE"
      exit 0
    fi
    nohup setsid "$ROOT/dev.sh" dev > "$LOG_FILE" 2>&1 < /dev/null 9>&- &
    SERVER_PID=$!
    SERVER_BIRTH="$(awk '{print $22}' "/proc/$SERVER_PID/stat")"
    printf '%s %s\n' "$SERVER_PID" "$SERVER_BIRTH" > "$PID_FILE"
    CHECK_HOST="$DEV_HOST"
    [[ "$CHECK_HOST" != 0.0.0.0 ]] || CHECK_HOST=127.0.0.1
    for ((i=0; i<90; i++)); do
      if ! running; then
        tail -n 40 "$LOG_FILE"
        rm -f "$PID_FILE"
        die "启动失败。"
      fi
      # The log proves this process bound the port, rather than an unrelated server.
      if rg -q 'Ready in' "$LOG_FILE" && curl --noproxy '*' -fsS --max-time 3 \
        "http://$CHECK_HOST:$PORT/api/health" > "$STATE/health.json"; then
        if node -e 'const h=require(process.argv[1]); if(h.db.status!=="ok") process.exit(1)' "$STATE/health.json"; then
          echo "已启动：http://$DEV_HOST:$PORT（PID $SERVER_PID）"
          echo "日志：$LOG_FILE；停止：./dev.sh stop"
          exit 0
        fi
        die "服务已启动，但数据库健康检查未通过，见 $STATE/health.json。"
      fi
      sleep 1
    done
    die "启动检查超时；服务保留运行，请执行 ./dev.sh logs 检查。"
    ;;
  stop)
    mkdir -p "$STATE"
    exec 9>"$STATE/control.lock"
    flock -n 9 || die "另一个启动/停止命令正在执行。"
    stop_server
    ;;
  status)
    if running; then
      echo "后台开发服务运行中（PID $SERVER_PID）。日志：$LOG_FILE"
    else
      echo "后台开发服务未运行。"
      exit 1
    fi
    ;;
  logs)
    [[ -f "$LOG_FILE" ]] || die "尚无后台日志，请先 ./dev.sh start。"
    exec tail -n 80 -f "$LOG_FILE"
    ;;
  *)
    echo "用法：./dev.sh [dev|install|start|stop|restart|status|logs]"
    exit 1
    ;;
esac
