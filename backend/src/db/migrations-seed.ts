/**
 * Drama Mill — AI 短剧生成平台
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
/*
 * Drama Mill — 增量迁移：种子账号 / 归属回填 / 刊例价种子 / 历史用量重算
 */
import type { Pool } from 'mysql2/promise'
import bcrypt from 'bcryptjs'

/** 种子账号（幂等）：用户名不存在才创建，已存在不覆盖密码 */
export const SEED_USERS = [
  { username: 'drama-mill', password: 'drama-mill', role: 'admin', nickname: '平台管理员' },
  { username: 'test', password: 'drama-mill', role: 'user', nickname: '测试用户' },
]

/** 历史管理员账号名兼容：旧种子用的 adimin 重命名为 admin（保留原用户与其密码） */
async function renameLegacyAdmin(pool: Pool) {
  const [adminRows] = await pool.query("SELECT id FROM users WHERE username = 'admin'")
  if ((adminRows as unknown[]).length > 0) return
  const [legacyRows] = await pool.query("SELECT id FROM users WHERE username = 'adimin'")
  if ((legacyRows as unknown[]).length === 0) return
  await pool.query("UPDATE users SET username = 'admin' WHERE username = 'adimin'")
  console.log('👤 已将历史管理员账号 adimin 重命名为 admin')
}

/** 历史普通账号兼容：旧种子用个人账号名 kongqz 重命名为 test（主键 id 不变，存量归属数据不受影响） */
async function renameLegacyUser(pool: Pool) {
  const [taken] = await pool.query("SELECT id FROM users WHERE username = 'test'")
  if ((taken as unknown[]).length > 0) return
  const [legacy] = await pool.query("SELECT id FROM users WHERE username = 'kongqz'")
  if ((legacy as unknown[]).length === 0) return
  await pool.query(
    "UPDATE users SET username = 'test', nickname = CASE WHEN nickname = 'kongqz' THEN '测试用户' ELSE nickname END WHERE username = 'kongqz'",
  )
  console.log('👤 已将历史普通账号 kongqz 重命名为 test')
}

/** 管理员种子护栏：库内已有任意管理员就不再新建。存量部署的管理员名多为 admin 且已改过密码，
 *  若按新账号名直接播种会给线上库塞入一个默认口令的管理员账号 */
async function hasAnyAdmin(pool: Pool) {
  const [rows] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
  return (rows as { id: number }[]).length > 0
}

async function seedUsers(pool: Pool) {
  for (const u of SEED_USERS) {
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [u.username])
    if ((rows as unknown[]).length > 0) continue
    if (u.role === 'admin' && await hasAnyAdmin(pool)) continue
    const hash = bcrypt.hashSync(u.password, 10)
    const ts = new Date().toISOString()
    await pool.query(
      'INSERT INTO users (username, password_hash, role, status, nickname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [u.username, hash, u.role, 'active', u.nickname, ts, ts],
    )
    console.log(`👤 已创建种子账号 ${u.username} (${u.role})`)
  }
}

/** 存量数据归属回填：
 * 1) 有 drama_id 的行按剧集所有者回填（否则会把 A 用户的任务/资产划给种子账号，跨租户错归）
 * 2) 无剧集关联的历史数据归入普通种子账号 test（历史库为 kongqz，已在播种前幂等重命名）
 */
async function backfillOwnership(pool: Pool) {
  const [rows] = await pool.query("SELECT id FROM users WHERE username = 'test'")
  const owner = (rows as { id: number }[])[0]
  if (!owner) return
  for (const table of ['sys_task', 'video_merges', 'assets']) {
    await pool.query(`UPDATE \`${table}\` t JOIN dramas d ON t.drama_id = d.id
      SET t.user_id = d.user_id
      WHERE t.user_id IS NULL AND d.user_id IS NOT NULL`)
  }
  for (const table of ['dramas', 'ai_service_configs', 'sys_task', 'video_merges', 'assets']) {
    await pool.query(`UPDATE \`${table}\` SET user_id = ? WHERE user_id IS NULL`, [owner.id])
  }
}

/** 存量小说归属回填：novels 早期无 user_id 列，经所属项目回填（无项目的历史行归入普通种子账号 test） */
async function backfillNovelOwnership(pool: Pool) {
  await pool.query(`UPDATE novels n JOIN dramas d ON n.drama_id = d.id
    SET n.user_id = d.user_id
    WHERE n.user_id IS NULL AND d.user_id IS NOT NULL`)
  const [rows] = await pool.query("SELECT id FROM users WHERE username = 'test'")
  const owner = (rows as { id: number }[])[0]
  if (owner) {
    await pool.query('UPDATE novels SET user_id = ? WHERE user_id IS NULL', [owner.id])
  }
}

/**
 * 阿里云百炼（Model Studio）官网刊例报价种子
 * 来源：https://help.aliyun.com/zh/model-studio/billing-for-model-studio（2026-08-27 抓取）
 * - token 类：input/output 单位为 元/百万Token（阶梯计费取最低档）
 * - image 类：unit_price 单位为 元/张
 * - video_second 类：unit_price 单位为 元/秒（wan3.0 按 720P 档位取价）
 */
export const MODEL_PRICE_SEEDS = [
  // ── 文本生成（元/百万Token）──
  { provider: 'dashscope', model: 'qwen3.8-max', billing_type: 'token', input_price: 12, output_price: 36 },
  { provider: 'dashscope', model: 'qwen3.8-max-prime', billing_type: 'token', input_price: 24, output_price: 72 },
  { provider: 'dashscope', model: 'qwen3.7-max', billing_type: 'token', input_price: 12, output_price: 36 },
  { provider: 'dashscope', model: 'qwen3.6-max-preview', billing_type: 'token', input_price: 9, output_price: 54 },
  { provider: 'dashscope', model: 'qwen3-max', billing_type: 'token', input_price: 2.5, output_price: 10 },
  { provider: 'dashscope', model: 'qwen-flash', billing_type: 'token', input_price: 0.15, output_price: 1.5 },
  { provider: 'dashscope', model: 'qwen-turbo', billing_type: 'token', input_price: 0.3, output_price: 0.6 },
  // ── 图片生成（元/张）──
  { provider: 'dashscope', model: 'wan2.7-image-pro', billing_type: 'image', unit_price: 0.5 },
  { provider: 'dashscope', model: 'wan2.7-image', billing_type: 'image', unit_price: 0.2 },
  { provider: 'dashscope', model: 'wan2.6-image', billing_type: 'image', unit_price: 0.2 },
  { provider: 'dashscope', model: 'wan2.6-t2i', billing_type: 'image', unit_price: 0.2 },
  { provider: 'dashscope', model: 'wan2.2-t2i-plus', billing_type: 'image', unit_price: 0.2 },
  { provider: 'dashscope', model: 'wan2.2-t2i-flash', billing_type: 'image', unit_price: 0.14 },
  { provider: 'dashscope', model: 'qwen-image', billing_type: 'image', unit_price: 0.25 },
  { provider: 'dashscope', model: 'qwen-image-plus', billing_type: 'image', unit_price: 0.2 },
  // ── 视频生成（元/秒）──
  { provider: 'dashscope', model: 'wan3.0-video', billing_type: 'video_second', unit_price: 0.6 },
  { provider: 'dashscope', model: 'wan3.0-video-prime', billing_type: 'video_second', unit_price: 0.9 },
  // happyhorse-1.1 系列（取 720P 档；480P 0.45 / 1080P 1.2）
  { provider: 'dashscope', model: 'happyhorse-1.1-t2v', billing_type: 'video_second', unit_price: 0.9 },
  { provider: 'dashscope', model: 'happyhorse-1.1-i2v', billing_type: 'video_second', unit_price: 0.9 },
  { provider: 'dashscope', model: 'happyhorse-1.1-r2v', billing_type: 'video_second', unit_price: 0.9 },
  { provider: 'dashscope', model: 'wan2.7-t2v', billing_type: 'video_second', unit_price: 0.6 },
  { provider: 'dashscope', model: 'wan2.7-i2v', billing_type: 'video_second', unit_price: 0.6 },
  { provider: 'dashscope', model: 'wan2.6-t2v', billing_type: 'video_second', unit_price: 0.6 },
  { provider: 'dashscope', model: 'wan2.6-i2v-flash', billing_type: 'video_second', unit_price: 0.3 },
  { provider: 'dashscope', model: 'wan2.5-t2v-preview', billing_type: 'video_second', unit_price: 0.3 },
  { provider: 'dashscope', model: 'wan2.2-t2v-plus', billing_type: 'video_second', unit_price: 0.14 },
]

const PRICE_SOURCE = 'https://help.aliyun.com/zh/model-studio/billing-for-model-studio'

async function seedModelPrices(pool: Pool) {
  const ts = new Date().toISOString()
  for (const p of MODEL_PRICE_SEEDS) {
    // 只补缺失模型，不覆盖管理员手工修正过的价格
    await pool.query(
      `INSERT INTO model_prices (provider, model, billing_type, input_price, output_price, unit_price, currency, source, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'CNY', ?, ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM model_prices WHERE provider = ? AND model = ?)`,
      [p.provider, p.model, p.billing_type, p.input_price || 0, p.output_price || 0, p.unit_price || 0, PRICE_SOURCE, ts, p.provider, p.model],
    )
  }
}

/**
 * 历史用量重算：早于刊例价种子落库的用量记录标记了 price_missing，
 * 按当前价目表（优先 provider|model，其次按模型名，兼容 OpenAI 兼容网关）幂等重算
 */
async function backfillUsageCosts(pool: Pool) {
  const byModelPrice = `(
    SELECT mp1.model, mp1.billing_type, mp1.input_price, mp1.output_price, mp1.unit_price
    FROM model_prices mp1
    JOIN (SELECT model, MIN(id) AS min_id FROM model_prices GROUP BY model) pick ON pick.min_id = mp1.id
  )`
  // 文本：元/百万Token
  await pool.query(`
    UPDATE usage_records ur JOIN ${byModelPrice} mp ON mp.model = ur.model
    SET ur.cost = (COALESCE(ur.input_tokens,0) * mp.input_price + COALESCE(ur.output_tokens,0) * mp.output_price) / 1000000,
        ur.price_missing = 0
    WHERE ur.price_missing = 1 AND ur.service_type = 'text' AND mp.billing_type = 'token'
  `)
  // 图片：元/张 × 张数
  await pool.query(`
    UPDATE usage_records ur JOIN ${byModelPrice} mp ON mp.model = ur.model
    SET ur.cost = mp.unit_price * COALESCE(ur.image_count, 1),
        ur.price_missing = 0
    WHERE ur.price_missing = 1 AND ur.service_type = 'image' AND mp.billing_type = 'image'
  `)
  // 视频：元/秒 × 秒数
  await pool.query(`
    UPDATE usage_records ur JOIN ${byModelPrice} mp ON mp.model = ur.model
    SET ur.cost = mp.unit_price * COALESCE(ur.video_seconds, 0),
        ur.price_missing = 0
    WHERE ur.price_missing = 1 AND ur.service_type = 'video' AND mp.billing_type = 'video_second'
  `)
}

/** 种子与回填阶段：账号（先于回填）→ 归属回填 → 刊例价种子 + 历史用量重算 */
export async function runSeedStage(pool: Pool) {
  // 2) 种子账号（先于归属回填；旧账号名先幂等重命名，避免重命名后又插一个新的空账号）
  await renameLegacyAdmin(pool)
  await renameLegacyUser(pool)
  await seedUsers(pool)

  // 3) 存量数据归属回填（含小说表）
  await backfillOwnership(pool)
  await backfillNovelOwnership(pool)

  // 4) 刊例价种子 + 历史用量重算（新价目表落地后补算早前的 price_missing 记录）
  await seedModelPrices(pool)
  await backfillUsageCosts(pool)
}
