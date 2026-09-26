#!/usr/bin/env bash
# ============================================================================
# Drama Mill 云端服务管控脚本（root 手工激活: bash /root/drama-mill-services.sh <cmd>）
#
# 命令:
#   start    按依赖顺序启动全部服务 (mysqld -> nginx -> drama-mill)
#   stop     按反序停止全部服务
#   restart  重启全部服务（先 stop 再 start, 最后健康检查）
#   status   查看各服务状态与最近错误日志
#
# 依赖: systemd(mysqld/nginx) + pm2(drama-mill, 开机由 pm2-root 服务自动拉起)
# ============================================================================
set -u

APP_DIR="/opt/drama-mill"
APP_NAME="drama-mill"
PORT=5679

log() { printf '\033[1;34m[hb-services]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[hb-services][ERROR]\033[0m %s\n' "$*" >&2; }

healthy() {
  curl -sf -m 5 "http://127.0.0.1:${PORT}/api/v1/health" 2>/dev/null | grep -q ok
}

mysql_ready() {
  mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1
}

wait_mysql() {
  for _ in $(seq 1 30); do mysql_ready && return 0; sleep 1; done
  return 1
}

wait_healthy() {
  for _ in $(seq 1 20); do healthy && return 0; sleep 2; done
  return 1
}

start_all() {
  log "启动 mysqld ..."
  systemctl start mysqld || err "mysqld 启动失败"
  wait_mysql && log "mysqld 就绪 (3306)" || err "mysqld 30s 内未就绪"

  log "启动 nginx ..."
  systemctl start nginx || err "nginx 启动失败"

  log "启动应用 ${APP_NAME} ..."
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 start "$APP_NAME" >/dev/null 2>&1 || pm2 restart "$APP_NAME" >/dev/null 2>&1
  else
    ( cd "$APP_DIR" && pm2 start ecosystem.config.cjs ) || err "pm2 启动失败"
  fi

  if wait_healthy; then
    log "✅ 全部服务已启动, 健康检查通过"
  else
    err "应用健康检查未通过, 请执行 status 查看"
    return 1
  fi
}

stop_all() {
  log "停止应用 ${APP_NAME} ..."
  pm2 stop "$APP_NAME" >/dev/null 2>&1 || pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  log "停止 nginx ..."
  systemctl stop nginx || true
  log "停止 mysqld ..."
  systemctl stop mysqld || true
  log "全部服务已停止"
}

restart_all() {
  log "重启全部服务 ..."
  stop_all
  sleep 2
  start_all
}

show_status() {
  echo "── systemd ──────────────────────────────"
  for s in mysqld nginx; do
    printf '%-10s enabled=%-8s active=%s\n' "$s" \
      "$(systemctl is-enabled $s 2>/dev/null)" "$(systemctl is-active $s 2>/dev/null)"
  done
  echo "── pm2 ──────────────────────────────────"
  pm2 ls
  echo "── 健康检查 ─────────────────────────────"
  if healthy; then
    log "✅ /api/v1/health OK"
  else
    err "❌ /api/v1/health 无响应"
  fi
  echo "── 最近错误日志 ─────────────────────────"
  tail -n 20 "$APP_DIR/logs/app-error.log" 2>/dev/null || echo "(无 app-error.log)"
}

case "${1:-}" in
  start)   start_all ;;
  stop)    stop_all ;;
  restart) restart_all ;;
  status)  show_status ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
