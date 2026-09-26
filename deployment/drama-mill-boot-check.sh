#!/usr/bin/env bash
# ============================================================================
# Drama Mill 开机自愈脚本（crontab @reboot 注册, 延迟 30s 等待 systemd 拉起服务）
#
# 双保险: pm2-root 服务负责开机 resurrect drama-mill, 本脚本兜底检查
# mysqld / nginx / 应用健康, 任一项异常则调用 drama-mill-services.sh start 补拉。
# 日志: /root/drama-mill-boot-check.log
# ============================================================================
set -u

APP_DIR="/opt/drama-mill"
SERVICES="/root/drama-mill-services.sh"
LOG="/root/drama-mill-boot-check.log"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

sleep 30
log "开机自检开始"

need_fix=0

systemctl is-active --quiet mysqld || { log "mysqld 未运行"; need_fix=1; }
systemctl is-active --quiet nginx  || { log "nginx 未运行"; need_fix=1; }
pm2 describe drama-mill >/dev/null 2>&1 || { log "pm2 无 drama-mill 进程"; need_fix=1; }

# 最终以下游健康检查兜底（进程存在但卡死/未就绪同样会触发补拉）

if ! curl -sf -m 10 "http://127.0.0.1:5679/api/v1/health" 2>/dev/null | grep -q ok; then
  log "健康检查未通过"
  need_fix=1
fi

if [ "$need_fix" = "1" ]; then
  log "检测到异常, 调用 $SERVICES start 补拉"
  bash "$SERVICES" start >> "$LOG" 2>&1
else
  log "全部服务正常, 无需干预"
fi
