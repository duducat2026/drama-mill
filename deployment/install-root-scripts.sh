#!/usr/bin/env bash
# ============================================================================
# 安装/更新云主机 root 运维脚本（本地执行）
#
#   bash deployment/install-root-scripts.sh
#
# 动作:
#   1. 上传 drama-mill-services.sh / drama-mill-boot-check.sh 到云主机 /root/ 并赋可执行权限
#   2. 幂等注册 crontab @reboot 开机自愈（保留已有其他任务）
#   3. pm2 save 固化进程列表（保证开机 resurrect 有内容）
#
# 与云效仓库联动: 脚本源头在 deployment/ 目录, 云主机重装后重跑本脚本即可恢复
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_HOST=${REMOTE_HOST:-aliyun-drama}

log() { printf '\033[1;34m[install-root-scripts]\033[0m %s\n' "$*"; }

ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_HOST" 'echo ok' >/dev/null 2>&1 \
  || { printf '\033[1;31m无法免密连接 %s\033[0m\n' "$REMOTE_HOST" >&2; exit 1; }

log "上传脚本到 $REMOTE_HOST:/root/ ..."
scp -q "$HERE/drama-mill-services.sh" "$HERE/drama-mill-boot-check.sh" "$REMOTE_HOST:/root/"
ssh -o BatchMode=yes "$REMOTE_HOST" 'chmod +x /root/drama-mill-services.sh /root/drama-mill-boot-check.sh'

log "幂等注册 @reboot 开机自检 ..."
ssh -o BatchMode=yes "$REMOTE_HOST" \
  '(crontab -l 2>/dev/null | grep -v "drama-mill-boot-check"; echo "@reboot /bin/bash /root/drama-mill-boot-check.sh >> /root/drama-mill-boot-check.log 2>&1") | crontab -'

log "pm2 save 固化进程列表 ..."
ssh -o BatchMode=yes "$REMOTE_HOST" 'pm2 save >/dev/null 2>&1 || true'

log "验证远端脚本 ..."
ssh -o BatchMode=yes "$REMOTE_HOST" 'bash /root/drama-mill-services.sh status >/dev/null && echo "status 自检通过"'

log "🎉 安装完成"
