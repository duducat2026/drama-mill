/*
 * Drama Mill — 失败诊断：分类规则表 + 服务商专属补充提示 + 对外结构类型
 */

export type FailureKind =
  | 'auth'            // 401 / 403：Key 无效或未开通该模型
  | 'not_found'       // 404：端点前缀或模型名不对
  | 'invalid_request' // 400 / 422：参数被上游拒绝
  | 'balance'         // 额度/余额不足
  | 'rate_limit'      // 429 限流
  | 'moderation'      // 内容安全审核拦截
  | 'network'         // DNS / 连接被拒 / TLS
  | 'timeout'         // 超时或连接中断
  | 'upstream'        // 5xx 上游内部错误
  | 'empty'           // 上游没给出任何可用信息
  | 'unknown'

export interface FailureDetail {
  kind: FailureKind
  /** 一句结论（可直接作为标题行） */
  summary: string
  /** 该改什么：面向用户的下一步动作 */
  hint: string
  upstream_status: number | null
  /** 上游错误码（如 invalid_api_key / BadRequest.EmptyModel） */
  upstream_code: string
  /** 上游请求 ID，提工单用 */
  request_id: string
  /** 原始错误文本（已去密 + 截断） */
  raw: string
}

interface Rule {
  kind: FailureKind
  summary: string
  hint: string
  /** 命中条件：状态码或原文正则 */
  status?: (s: number) => boolean
  test?: RegExp
}

/** 绿网单独走 isModerationError 判定（与自动修正链路共用同一套关键词），不进规则表 */
export const MODERATION_RULE = {
  kind: 'moderation' as FailureKind,
  summary: '内容安全审核未通过，上游拒绝了本次提示词',
  hint: '这是服务商侧的审核拦截，与 Key 和端点无关。测试提示词是固定文案，若仍被拦说明该模型审核策略偏严，可换一个模型验证。',
}

/** 顺序即优先级：更具体的先判（额度类文案常伴随 429/400，必须先于状态码规则） */
export const RULES: Rule[] = [
  {
    kind: 'balance',
    summary: '账号额度或余额不足，上游拒绝了调用',
    hint: '到服务商控制台确认该 Key 的剩余额度/是否欠费，充值后重新发起一次测试。',
    test: /insufficient[_\s-]?quota|insufficient[_\s-]?balance|quota.{0,20}(exceed|not.?enough|exhaust)|balance.{0,20}(insufficient|short|not.?enough)|Arrearage|欠费|余额不足|额度不足|超出配额/i,
  },
  {
    kind: 'auth',
    summary: '鉴权失败：API Key 无效、已过期，或与 Base URL 不属于同一个服务',
    hint: '点开 API Key 输入框右侧的眼睛图标核对已保存的值（注意首尾空格与换行），并确认 Base URL 指向签发该 Key 的站点。',
    // 403 交给下面「无权限」规则：403 绝大多数是 Key 有效但没开通该模型，结论不同
    status: s => s === 401,
    test: /invalid[_\s-]?api[_\s-]?key|incorrect api key|authentication|unauthorized|no api key provided|key.*(invalid|expired|not.*found)|鉴权失败|无效的?密钥|signature.*(expired|invalid)/i,
  },
  {
    kind: 'auth',
    summary: '该 Key 无此模型的调用权限（上游返回 403 权限错误）',
    hint: '在服务商侧为该 Key 开通目标模型的权限，或把「模型」列表首个模型换成已开通的名称后重试。',
    status: s => s === 403,
    test: /permission|forbidden|access.{0,20}denied|not\shave|无权限|未开通|未授权/i,
  },
  {
    kind: 'not_found',
    summary: '上游找不到该端点或模型',
    hint: 'Base URL 只填站点根路径即可，程序会按服务商自动补 /v1、/api/v3 等前缀；同时确认「模型」列表第一个名字与上游完全一致（区分大小写）。',
    status: s => s === 404,
    // \b 边界很关键：Node 的 ENOTFOUND（域名解析失败）里也含 "notfound"，不加边界会被误判成 404
    test: /\bnot[\s_-]?found\b|unknown url|does not exist|invalid model|no such model|端点不存在|模型不存在/i,
  },
  {
    kind: 'rate_limit',
    summary: '触发上游限流',
    hint: '稍后重新发起一次测试即可；若稳定复现，到管理后台调低该配置的网关 QPM 或降低并发。',
    status: s => s === 429,
    test: /rate.?limit|too many requests|qps|throttl|requests? per minute|限流/i,
  },
  {
    kind: 'invalid_request',
    summary: '上游拒绝了本次请求的参数',
    hint: '核对模型名是否接受该能力（文本/图片/视频）、尺寸与时长是否在允许列表内；把下方原始返回复制给服务商更快定位。',
    // 4xx 兜底规则：401/403/404/429 已被更具体的规则截走，408 属超时不放这里
    status: s => s >= 400 && s < 500 && s !== 408,
    test: /invalid[_\s-]?(argument|parameter|request|body)|bad request|missing (parameter|from request)|unsupported|not support|参数.*(错误|缺失|非法)|required parameter/i,
  },
  {
    kind: 'upstream',
    summary: '上游服务内部错误',
    hint: '这不是本地配置问题，稍后重试或更换模型/服务商；持续 5xx 请带上下方 request_id 找服务商。',
    // 5xx 先于超时/网络判定：504 这类「网关超时」的措辞会被下面两条规则误读成本机网络问题
    status: s => s >= 500,
    test: /internal server error|bad gateway|service unavailable|gateway time-?out|server error|upstream .*(error|unavailable)|服务器内部错误/i,
  },
  {
    kind: 'timeout',
    summary: '等待上游响应超时或连接被中断',
    hint: '上游可能在排队或该模型首字很慢。视频类任务耗时长属正常，可稍后到任务列表看该任务是否已完成。',
    test: /HeadersTimeout|SocketError|connect ETIMEDOUT|\bETIMEDOUT\b|timed? out|\btimeout\b|AbortError|deadline exceeded|ECONNRESET|socket hang up|connection (?:was )?(?:closed|reset)|读取超时|响应超时/i,
  },
  {
    kind: 'network',
    summary: '无法连接到上游服务（网络或地址问题）',
    hint: '检查 Base URL 拼写、域名是否需要内网/代理才能访问，以及服务器出网是否被安全组限制。',
    test: /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|no such host|certificate|self[-\s]signed|unable to verify.*ssl|\bfetch failed\b|NetworkError|网络不可达|连接被拒绝|域名.*(解析|无法)/i,
  },
]

/** 服务商相关的补充提示：只针对本项目实际会打的路径，避免泛泛而谈 */
export function providerHint(serviceType?: string | null, provider?: string | null): string {
  const p = (provider || '').toLowerCase()
  if (p === 'openai') {
    if (serviceType === 'image') return ' 图片测试会 POST {Base URL}/v1/images/generations。'
    if (serviceType === 'text') return ' 文本测试会 POST {Base URL}/v1/chat/completions。'
    return ' 服务商为 openai 时，网关必须实现对应的 OpenAI 官方端点。'
  }
  if (p === 'dashscope' && serviceType === 'text') return ' 百炼文本走 OpenAI 兼容模式，Base URL 需以 /compatible-mode/v1 结尾。'
  if (p === 'model-router') {
    // 该网关按能力分协议，且模型标识必须带 symbol/ 前缀，这两点最容易踩
    const endpoint = serviceType === 'text'
      ? '文本走 OpenAI Chat 兼容端点 /v1/chat/completions'
      : serviceType === 'image'
        ? '图片走 DashScope 兼容端点 /v1/images/generations（同步）'
        : '视频走 DashScope 兼容端点 /v1/videos/generations + 请求头 X-MR-Async，轮询 /v1/tasks/{task_id}'
    return ` Model Router：Base URL 只填站点根（https://model-router.edu-aliyun.com），${endpoint}；模型标识需带 symbol/ 前缀（如 qwen/wan3.0-video），403 多为该 Key 未在此模型广场/授权管理中开通。`
  }
  if (p === 'volcengine') return ' 火山方舟会按类型补 /api/v3 前缀（chat/completions、images/generations、contents/generations/tasks）。'
  if (p === 'gemini') return ' Gemini 走原生 generateContent 端点，Base URL 填 API 根（形如 https://generativelanguage.googleapis.com）。'
  return ''
}
