#!/usr/bin/env bash
# ============================================================================
# 磁盘监测脚本（云端 cron 定期执行, 超阈值告警）
#
# 安装 (在云端服务器执行):
#   cp deployment/disk-monitor.sh /opt/drama-mill/deployment/
#   crontab -e 添加:
#     */30 * * * * /opt/drama-mill/deployment/disk-monitor.sh >> /var/log/disk-monitor.log 2>&1
#
# 环境变量 (可在 cron 行内或 /etc/disk-monitor.env 中设置):
#   DISK_THRESHOLD  使用率告警阈值百分比 (默认 85)
#   INODE_THRESHOLD inode 使用率告警阈值百分比 (默认 85)
#   MOUNT_POINT     监测的挂载点 (默认 /)
#   WEBHOOK_URL     可选: 钉钉/飞书机器人 webhook, 设置后告警会推送
#   ALERT_INTERVAL  重复告警最小间隔秒数 (默认 3600, 避免告警风暴)
# ============================================================================
set -uo pipefail

[ -f /etc/disk-monitor.env ] && . /etc/disk-monitor.env

DISK_THRESHOLD=${DISK_THRESHOLD:-85}
INODE_THRESHOLD=${INODE_THRESHOLD:-85}
MOUNT_POINT=${MOUNT_POINT:-/}
ALERT_INTERVAL=${ALERT_INTERVAL:-3600}
STATE_FILE=/var/run/disk-monitor.last-alert
STATUS_JSON=/opt/drama-mill/data/disk_status.json
HOSTNAME_STR=$(hostname)
NOW=$(date '+%F %T')

ALERTS=""

# ── 磁盘空间 ───────────────────────────────────────────────
USAGE=$(df -P "$MOUNT_POINT" | awk 'NR==2 {gsub("%","",$5); print $5}')
AVAIL=$(df -hP "$MOUNT_POINT" | awk 'NR==2 {print $4}')
if [ "${USAGE:-0}" -ge "$DISK_THRESHOLD" ]; then
  ALERTS="${ALERTS}磁盘空间使用率 ${USAGE}% ≥ ${DISK_THRESHOLD}% (剩余 ${AVAIL}); "
fi

# ── inode ─────────────────────────────────────────────────
IUSAGE=$(df -Pi "$MOUNT_POINT" | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "${IUSAGE:-0}" -ge "$INODE_THRESHOLD" ]; then
  ALERTS="${ALERTS}inode 使用率 ${IUSAGE}% ≥ ${INODE_THRESHOLD}%; "
fi

# ── 应用目录占用 Top3 (辅助定位) ──────────────────────────
TOP_DIRS=""
if [ -n "$ALERTS" ] && [ -d /opt/drama-mill ]; then
  TOP_DIRS=$(du -sh /opt/drama-mill/data /opt/drama-mill/logs /opt/drama-mill/backend/node_modules /opt/drama-mill/frontend/node_modules 2>/dev/null | sort -rh | head -4 | awk '{printf "%s(%s) ", $2, $1}')
fi

echo "[$NOW] check mount=$MOUNT_POINT disk=${USAGE}% inode=${IUSAGE}% threshold=${DISK_THRESHOLD}% alert=$([ -n "$ALERTS" ] && echo YES || echo NO)"

# 状态 JSON 落盘（供 nginx /disk_status 端点读取，每轮必写）
TOTAL_KB=$(df -Pk "$MOUNT_POINT" | awk 'NR==2 {print $2}')
USED_KB=$(df -Pk "$MOUNT_POINT" | awk 'NR==2 {print $3}')
AVAIL_KB=$(df -Pk "$MOUNT_POINT" | awk 'NR==2 {print $4}')
cat > "$STATUS_JSON" 2>/dev/null <<EOF
{
  "timestamp": "$NOW",
  "hostname": "$HOSTNAME_STR",
  "mount": "$MOUNT_POINT",
  "disk_used_percent": ${USAGE:-0},
  "inode_used_percent": ${IUSAGE:-0},
  "total_bytes": $((TOTAL_KB * 1024)),
  "used_bytes": $((USED_KB * 1024)),
  "free_bytes": $((AVAIL_KB * 1024)),
  "threshold_percent": $DISK_THRESHOLD,
  "alert": $([ -n "$ALERTS" ] && echo true || echo false),
  "alert_message": "${ALERTS:-}"
}
EOF

# ── 无告警直接退出 ────────────────────────────────────────
[ -z "$ALERTS" ] && exit 0

# ── 告警节流 ──────────────────────────────────────────────
if [ -f "$STATE_FILE" ]; then
  LAST=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - LAST )) -lt "$ALERT_INTERVAL" ]; then
    echo "[$NOW] alert suppressed (interval < ${ALERT_INTERVAL}s)"
    exit 0
  fi
fi
date +%s > "$STATE_FILE"

MSG="⚠️ [$HOSTNAME_STR] 磁盘告警 $NOW: ${ALERTS}${TOP_DIRS:+占用: $TOP_DIRS}"
echo "[$NOW] ALERT: $MSG"

# ── webhook 推送 (钉钉/飞书兼容的 markdown 格式) ─────────
if [ -n "${WEBHOOK_URL:-}" ]; then
  curl -s -m 10 -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"$MSG\"}}" \
    "$WEBHOOK_URL" >/dev/null || echo "[$NOW] webhook 推送失败"
fi
