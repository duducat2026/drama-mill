#!/usr/bin/env bash
# ============================================================================
# Drama Mill 一键部署脚本（免 Docker，本地与云端通用）
#
# 用法:
#   bash deployment/deploy.sh                 # 完整部署: 前后端依赖 + 构建 + 启动/重启
#   bash deployment/deploy.sh --backend-only  # 仅更新后端(依赖 + 重启), 不动前端
#   bash deployment/deploy.sh --frontend-only # 仅更新前端(依赖 + 构建 + 重启), 不动后端依赖
#   bash deployment/deploy.sh --build-only    # 仅构建前端产物, 不启动服务
#   bash deployment/deploy.sh --restart       # 仅重启服务(依赖与产物已就绪时)
#
# 前置条件:
#   - Node.js 22+ / npm 9+
#   - MySQL 8.0+ 已启动, 且 backend/.env 连接配置正确(建表由应用启动时自动完成)
#   - pm2 已安装: npm i -g pm2
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCOPE=all            # all | backend | frontend
BUILD_ONLY=false
RESTART_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --backend-only)  SCOPE=backend ;;
    --frontend-only) SCOPE=frontend ;;
    --build-only)    BUILD_ONLY=true ;;
    --restart)       RESTART_ONLY=true ;;
    -h|--help)       grep '^#' "$0" | head -16; exit 0 ;;
    *) echo "未知参数: $arg (可用: --backend-only --frontend-only --build-only --restart)"; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

# npm ci 会删掉 node_modules 全量重装：ffmpeg-static 80MB 二进制重新下载的几分钟窗口内
# 二进制缺失，恰好完成的视频会海报提取失败（瞬态 ENOENT）。lock 未变化时直接跳过安装；
# lock 变化才 npm ci，跨平台失败时回退 npm install 重新解析；保留 package-lock 不删除。
npm_install() {
  local lock_hash_file="node_modules/.deploy-lock-hash" cur prev
  cur=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')
  cur=${cur:-none}
  prev=$(cat "$lock_hash_file" 2>/dev/null || echo none)
  if [ "$cur" = "$prev" ] && [ -d node_modules ]; then
    log "依赖未变化 (lock 哈希一致), 跳过 npm ci"
    return 0
  fi
  if ! npm ci; then
    log "npm ci 失败(可能平台不匹配), 回退为 npm install ..."
    rm -rf node_modules
    npm install
  fi
  mkdir -p node_modules
  echo "$cur" > "$lock_hash_file"
}

# ── 0. 环境检查 ─────────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail "未找到 node, 请先安装 Node.js 22+"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 版本过低: $(node -v), 需要 22+ (@mastra/core 要求 ≥22.13)"
log "Node $(node -v) / npm $(npm -v) | scope=$SCOPE"

if ! $BUILD_ONLY; then
  command -v pm2 >/dev/null 2>&1 || fail "未找到 pm2, 请先执行: npm i -g pm2"
  [ -f backend/.env ] || fail "缺少 backend/.env, 请参照 backend/.env.example 创建"
fi

if ! $RESTART_ONLY; then
  # ── 1. 后端依赖 ───────────────────────────────────────────
  if [ "$SCOPE" = all ] || [ "$SCOPE" = backend ]; then
    log "安装后端依赖 (backend/) ..."
    # ffmpeg-static 二进制默认从 GitHub 下载, 国内网络改走 npmmirror 镜像
    export FFMPEG_BINARIES_URL=${FFMPEG_BINARIES_URL:-https://registry.npmmirror.com/-/binary/ffmpeg-static}
    (cd backend && npm_install)
  fi

  # ── 2. 前端构建 ───────────────────────────────────────────
  if [ "$SCOPE" = all ] || [ "$SCOPE" = frontend ]; then
    log "安装前端依赖并构建 (frontend/) ..."
    # 关闭 Nuxt 遥测, 避免非 TTY 环境下 postinstall 交互卡住; CI=1 同时抑制其他交互提示
    export NUXT_TELEMETRY_DISABLED=1 CI=1
    (cd frontend && npx nuxt telemetry disable >/dev/null 2>&1 || true)
    (cd frontend && npm_install && npm run generate)

    # nuxt generate 产物在 .output/public, 后端从 frontend/dist 提供静态文件
    log "同步前端产物: frontend/.output/public -> frontend/dist"
    rm -rf frontend/dist
    mkdir -p frontend/dist
    cp -R frontend/.output/public/. frontend/dist/
    [ -f frontend/dist/index.html ] || fail "前端构建产物异常: 缺少 frontend/dist/index.html"
  fi
fi

# ── 3. 运行目录 ─────────────────────────────────────────────
mkdir -p logs data/static backend/workspace
$BUILD_ONLY && { log "构建完成 (--build-only), 跳过启动"; exit 0; }

# ── 4. MySQL 连通性检查 ────────────────────────────────────
log "检查 MySQL 连通性 ..."
if ! (cd backend && node -e "
  require('dotenv/config');
  const mysql = require('mysql2/promise');
  (async () => {
    const c = await mysql.createConnection({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectTimeout: 5000
    });
    await c.end();
  })().catch(e => { console.error(e.message); process.exit(1); });
"); then
  fail "MySQL 连接失败, 请确认数据库已启动且 backend/.env 配置正确"
fi
log "MySQL 连接正常"

# ── 4.5 时区对齐北京时间 ──────────────────────────────
# 云主机默认多为 UTC，日志/任务时间戳不直观；优先用 timedatectl 切换，
# 无权限时不阻断部署（PM2 进程已内置 TZ=Asia/Shanghai 兜底）
CURRENT_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo unknown)
if [ "$CURRENT_TZ" = "Asia/Shanghai" ]; then
  log "时区已是 Asia/Shanghai"
else
  log "当前时区 $CURRENT_TZ, 尝试切换到 Asia/Shanghai ..."
  if timedatectl set-timezone Asia/Shanghai 2>/dev/null || sudo -n timedatectl set-timezone Asia/Shanghai 2>/dev/null; then
    log "✅ 系统时区已切换为 Asia/Shanghai"
  else
    log "⚠️ 无权限切换系统时区, 由 PM2 进程环境变量 TZ=Asia/Shanghai 兜底"
  fi
fi

# ── 5. 启动 / 重启 (PM2) ──────────────────────────────────
if pm2 describe drama-mill >/dev/null 2>&1; then
  log "重启已有进程 ..."
  pm2 restart ecosystem.config.cjs --update-env
else
  log "启动进程 ..."
  pm2 start ecosystem.config.cjs
fi

# ── 6. 健康检查 ─────────────────────────────────────────────
PORT=$(grep -E '^PORT=' backend/.env | cut -d= -f2 || true)
PORT=${PORT:-5679}
log "等待服务就绪 (http://localhost:$PORT) ..."
for i in $(seq 1 30); do
  if curl -sf -m 3 "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1; then
    log "✅ 部署成功! 访问地址: http://localhost:$PORT"
    pm2 save >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done

fail "服务 30s 内未就绪, 请查看日志: pm2 logs drama-mill 或 logs/app-error.log"
