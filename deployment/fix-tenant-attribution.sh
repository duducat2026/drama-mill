#!/usr/bin/env bash
# ============================================================================
# 多租户归属修复（在云端应用根目录执行，幂等可重跑）
#
# 背景：历史上编排/批量生成任务提交时缺 userId ——
#   1) 落盘退回兜底目录 {分类}/0/{drama}/
#   2) 启动回填曾把 NULL 一律划给种子账号，完成较晚的文件落到 {分类}/{种子}/{drama}/
#   结果：用户空间（管理页/配额统计按 {分类}/{user_id}/ 聚合）看不到自己的文件。
#
# 修复：以剧集所有者为准 ——
#   1) 文件归位：{分类}/{错误用户}/{drama}/ → {分类}/{所有者}/{drama}/
#   2) DB 历史路径同步订正（sys_task/characters/scenes/props/storyboards）
#   3) user_id 归属订正（sys_task/usage_records/video_merges/assets）
#
# 前置：无在途生成任务（脚本内置守卫）；建议先部署任务提交补 userId 的修复版本
#
# 用法：
#   bash deployment/fix-tenant-attribution.sh        # 修复全部剧集（要求全局无在途任务）
#   bash deployment/fix-tenant-attribution.sh 26     # 只修复指定剧集（守卫收窄到该剧集，
#                                                    # 其他剧集在途生成不受影响）
# ============================================================================
set -euo pipefail

DRAMA_FILTER="${1:-}"

# 脚本在 deployment/ 下，向上一级即应用根目录（本地仓与云端 /opt/drama-mill 布局一致）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=$(grep '^MYSQL_PASSWORD=' backend/.env | cut -d= -f2)
DB_USER=$(grep '^MYSQL_USER=' backend/.env | cut -d= -f2)
MYSQL="mysql -h127.0.0.1 -u${DB_USER:-dramamill} -p$PASS drama_mill -N -B"
STATIC=data/static
CATEGORIES=(images videos merged uploads)

log() { printf '\033[1;34m[fix-tenant]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fix-tenant][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 守卫：有在途任务时中止，避免迁移与落盘竞态 ─────────────────
ACTIVE=$($MYSQL -e "SELECT COUNT(*) FROM sys_task WHERE status IN ('processing','pending')${DRAMA_FILTER:+ AND drama_id = $DRAMA_FILTER}")
[ "$ACTIVE" = "0" ] || fail "存在 $ACTIVE 个在途任务${DRAMA_FILTER:+（剧集 $DRAMA_FILTER）}，等待全部终态后再执行"
if [ -n "$DRAMA_FILTER" ]; then
  case "$DRAMA_FILTER" in (*[!0-9]*|'') fail "剧集 ID 必须为数字: $DRAMA_FILTER" ;; esac
  DRAMA_SQL="SELECT id, user_id FROM dramas WHERE user_id IS NOT NULL AND id = $DRAMA_FILTER"
  log "模式：仅修复剧集 $DRAMA_FILTER"
else
  DRAMA_SQL="SELECT id, user_id FROM dramas WHERE user_id IS NOT NULL"
fi

# ── 1) 文件归位 + 2) 路径订正（按剧集所有者）─────────────────────
TOTAL_MOVES=0
TOTAL_SQL=0
while read -r drama_id owner; do
  for cat in "${CATEGORIES[@]}"; do
    for src_dir in "$STATIC/$cat"/*/; do
      [ -d "$src_dir" ] || continue
      src_uid=$(basename "$src_dir")
      case "$src_uid" in (*[!0-9]*|'') continue ;; esac
      [ "$src_uid" != "$owner" ] || continue
      [ -d "$src_dir$drama_id" ] || continue

      dest="$STATIC/$cat/$owner/$drama_id"
      mkdir -p "$dest"
      mv -n "$src_dir$drama_id"/* "$dest/" 2>/dev/null || true
      rmdir "$src_dir$drama_id" 2>/dev/null || true
      TOTAL_MOVES=$((TOTAL_MOVES + 1))
      log "文件归位: $cat/$src_uid/$drama_id → $cat/$owner/$drama_id"

      # 历史路径订正（相对路径段 /{src_uid}/{drama}/ → /{owner}/{drama}/）
      $MYSQL <<SQL
UPDATE sys_task SET local_path = REPLACE(local_path, '/$src_uid/$drama_id/', '/$owner/$drama_id/')
  WHERE drama_id = $drama_id AND local_path LIKE '%/$src_uid/$drama_id/%';
UPDATE characters SET image_url = REPLACE(image_url, '/$src_uid/$drama_id/', '/$owner/$drama_id/')
  WHERE drama_id = $drama_id AND image_url LIKE '%/$src_uid/$drama_id/%';
UPDATE scenes SET image_url = REPLACE(image_url, '/$src_uid/$drama_id/', '/$owner/$drama_id/')
  WHERE drama_id = $drama_id AND image_url LIKE '%/$src_uid/$drama_id/%';
UPDATE props SET image_url = REPLACE(image_url, '/$src_uid/$drama_id/', '/$owner/$drama_id/')
  WHERE drama_id = $drama_id AND image_url LIKE '%/$src_uid/$drama_id/%';
UPDATE storyboards SET video_url = REPLACE(video_url, '/$src_uid/$drama_id/', '/$owner/$drama_id/')
  WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = $drama_id)
    AND video_url LIKE '%/$src_uid/$drama_id/%';
SQL
      TOTAL_SQL=$((TOTAL_SQL + 1))
    done
  done

  # ── 3) user_id 归属订正（剧集维度全量对齐所有者）──────────────
  $MYSQL <<SQL
UPDATE sys_task SET user_id = $owner WHERE drama_id = $drama_id AND (user_id IS NULL OR user_id <> $owner);
UPDATE usage_records SET user_id = $owner WHERE drama_id = $drama_id AND (user_id IS NULL OR user_id <> $owner);
UPDATE video_merges SET user_id = $owner WHERE drama_id = $drama_id AND (user_id IS NULL OR user_id <> $owner);
UPDATE assets SET user_id = $owner WHERE drama_id = $drama_id AND (user_id IS NULL OR user_id <> $owner);
SQL
done < <($MYSQL -e "$DRAMA_SQL")

log "✅ 完成：目录迁移 $TOTAL_MOVES 处，路径订正 $TOTAL_SQL 组，归属对齐全部剧集"
