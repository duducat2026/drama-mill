#!/usr/bin/env bash
# ============================================================================
# Drama Mill 云端自动化部署（本地执行, 一条命令发布到云端服务器）
#
# 用法:
#   bash deployment/deploy-remote.sh                  # 全量: 同步代码 + 前后端更新 + 重启 + 验证
#   bash deployment/deploy-remote.sh --backend-only   # 仅后端更新发布
#   bash deployment/deploy-remote.sh --frontend-only  # 仅前端更新发布
#   bash deployment/deploy-remote.sh --restart        # 仅重启云端服务
#
# 环境变量:
#   REMOTE_HOST   ssh 目标 (默认 aliyun-drama, 即 ~/.ssh/config 中的别名)
#   REMOTE_DIR    云端应用目录 (默认 /opt/drama-mill)
#   PUBLIC_URL    部署后公网验证地址 (默认从 REMOTE_HOST 推导, 可显式指定域名)
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

REMOTE_HOST=${REMOTE_HOST:-aliyun-drama}
REMOTE_DIR=${REMOTE_DIR:-/opt/drama-mill}
SCOPE_ARGS=("$@")

log()  { printf '\033[1;34m[remote-deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[remote-deploy][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. 连通性检查 ──────────────────────────────────────────
ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" 'echo ok' >/dev/null 2>&1 \
  || fail "无法免密连接 $REMOTE_HOST, 请先配置 ~/.ssh/config 与公钥"
log "目标: $REMOTE_HOST:$REMOTE_DIR"

# ── 2. 同步代码 (排除依赖/产物/本地数据/环境配置) ──────────
# 注意: .env 必须排除(云端有独立数据库密码与 JWT_SECRET)
# 'drama/' 用 /drama/ 锚定, 避免误伤 frontend/app/views/drama/
log "同步代码 ..."
rsync -az -e "ssh -o ConnectTimeout=15" \
  --exclude 'node_modules/' --exclude '.nuxt/' --exclude '.output/' \
  --exclude 'frontend/dist/' --exclude 'backend/dist/' \
  --exclude '.env' --exclude '.env.local' --exclude '*.log' \
  --exclude 'data/static/' --exclude 'data/storage/' --exclude 'data/*.db*' \
  --exclude '/drama/' --exclude 'logs/' --exclude '.git/' \
  --exclude '.DS_Store' --exclude 'docker/' \
  --exclude 'Dockerfile' --exclude 'docker-compose.yml' --exclude '.dockerignore' \
  --exclude '/donate.png' --exclude '/drama.png' \
  "$ROOT/" "$REMOTE_HOST:$REMOTE_DIR/"

# ── 3. 云端执行部署脚本 (复用远端已同步的同一份) ───────────
log "云端执行部署 (参数: ${SCOPE_ARGS[*]:-全量}) ..."
ssh -o BatchMode=yes -o ServerAliveInterval=30 "$REMOTE_HOST" \
  "cd $REMOTE_DIR && bash deployment/deploy.sh ${SCOPE_ARGS[*]:-}"

# ── 4. 公网验证 (可选) ─────────────────────────────────────
if [ -n "${PUBLIC_URL:-}" ]; then
  log "公网验证: $PUBLIC_URL/api/v1/health"
  if curl -sf -m 10 "$PUBLIC_URL/api/v1/health" | grep -q ok; then
    log "✅ 公网验证通过"
  else
    fail "公网验证失败, 请检查安全组/域名解析/证书"
  fi
else
  log "未设置 PUBLIC_URL, 跳过公网验证 (仅云端内网健康检查)"
fi

log "🎉 发布完成"
