# Drama Mill 代码安全审查报告（只读审查）

> 审查日期：2026-11-19　|　性质：只读审查，仅记录问题、不做任何修复

## 1. 概述

### 1.1 审查范围

任务书第三阶段的"审查范围 / 排除范围"与第四阶段的"报告输出路径"均为未填写的模板占位符，本次按 `docs/repo-wiki.md` 附录 A 的口径执行，如与预期不符请指出后重审：

| 项 | 取值 |
|---|---|
| 审查范围 | `backend/{src,scripts,tests,workspace}`、`frontend/{app,tests,public}`、`deployment/`、`nginx/`、`docker/`、仓库根级文件、`backend/` 与 `frontend/` 目录下的散件（含未入库的本地文件，按磁盘实际文件计数） |
| 排除范围 | `node_modules/`、`.nuxt/`、`.output/`、`dist/`、`data/`、`drama/`、`logs/`、`.git/`、`.qoder/`、`*.min.js` |
| 报告路径 | `docs/安全审查报告-drama-mill-2026-11-19.md`（未覆盖已存在的 `docs/安全审查报告-drama-mill-2026-11-18.md`，本次为独立审查） |
| 代码基线 | commit `27ab615` + 当前工作区未提交改动（10 个已修改文件、2 个未跟踪文件，见 4.3），行号以当前工作区内容为准 |

### 1.2 基本信息

| 项 | 内容 |
|---|---|
| 使用模型 | Qoder IDE 内置 AI 编码助手（不披露具体模型标识） |
| 审查时间 | 2026-11-19 |
| 审查方式 | 关键词/正则全局搜索 + 语义级代码阅读；纯静态，未启动服务、未调用任何接口、未安装依赖 |
| 阶段一说明 | `docs/repo-wiki.md` 已存在，直接复用作为审查地图，未重新生成。审查中发现 wiki 一处与代码不符：`/api/v1/prompts` 实际已挂 `adminGuard`（`backend/src/routes/prompts.ts:32`），wiki 记为"仅 JWT" |
| 铁律遵守情况 | 除本报告文件外，未创建、修改、删除任何文件；未执行任何有副作用的命令 |

### 1.3 覆盖率统计

| 指标 | 数值 |
|---|---|
| 范围内文件总数 | 517 |
| 已审查文件数（至少经过全局正则扫描） | 510 |
| 其中：语义级阅读（全文或全部安全相关段） | 约 130 |
| 其中：全局正则扫描 + 命中段阅读 | 约 380 |
| 未审查 | 7（4 个 PNG 图片、3 个 `.DS_Store`，均为二进制） |

分档明细与盲区见第 4 节。

### 1.4 结论摘要

共记录 39 个问题（113 个子项）：高危 9、中危 12、低危 18。最需要优先处理的三组：

1. **身份可被整体伪造**：JWT 签名密钥存在已入库的默认值且 PM2 部署路径下会实际生效（S-001），叠加公开的默认账号口令（S-002）。
2. **多租户隔离存在多处缺口**：Agent 对话、生成任务、批量保存接口均可跨租户读/写/删他人数据，并可盗用他人 AI 配置额度（S-003 ~ S-006、S-009）。
3. **服务端请求与文件面**：带回显的 SSRF（S-007）、图片上传无类型校验且同源直出（S-008）。

## 2. 问题汇总表

严重程度定义：高危 = 可直接导致数据泄露/系统被控/越权；中危 = 需一定条件才可利用或影响有限；低危 = 规范类、纵深防御类。
路径均为仓库相对路径。标"疑似"的条目在风险说明中写明缺少的证据与需人工确认的内容。

### 2.1 高危

| 问题索引 | 严重程度 | 检查项编号 | 文件路径:行号 | 问题描述 | 风险说明 | 修复建议（仅建议，不执行） |
|---------|---------|-----------|--------------|---------|---------|--------------------------|
| S-001-a | 高危 | C01/C16 | backend/src/services/auth.ts:27 | JWT 签名密钥回退到硬编码默认值 `drama-mill-jwt-secret-change-me` | 未配置 `JWT_SECRET` 时任何人可用公开默认值签出任意用户 id 的 token；角色取自库中该 id 的行，伪造管理员 id 即获得管理员权限 | 启动时若未配置或等于默认值则拒绝启动；生成高熵密钥并轮换 |
| S-001-b | 高危 | C01/C16 | docker-compose.yml:14 | compose 文件中把同一默认密钥写死为运行值 | Docker 部署默认即使用公开密钥 | 改为 `${JWT_SECRET:?}` 强制外部注入 |
| S-001-c | 高危 | C01/C16 | .env.example:17 | 根级示例文件给出同一默认密钥 | 照抄示例即带入生产 | 示例留空并注明生成方式 |
| S-001-d | 高危 | C01/C16 | deployment/deploy.sh:68 | 部署脚本指引按 `backend/.env.example` 创建 `.env`，而该示例文件（全文 69 行）没有 `JWT_SECRET` 条目 | PM2 部署路径下按文档操作必然落到 S-001-a 的默认值 | 在 `backend/.env.example` 增加必填项，部署脚本增加校验 |
| S-002-a | 高危 | C02 | backend/src/db/migrations-seed.ts:12-15 | 首次启动自动播种管理员 `drama-mill` 与普通用户 `test`，口令同为 `drama-mill`（播种逻辑见 :46-58） | 默认口令公开，未改密的实例可被直接登录；管理员账号口令在 README 公开 | 首次启动生成随机口令或强制首登改密；不再播种固定口令 |
| S-002-b | 高危 | C02 | frontend/app/pages/login.vue:62 | 登录页（:59-64）直接展示 `test / drama-mill` | 公网任何访客可登录普通用户，进而利用 S-003 ~ S-009 | 移除登录页的账号提示 |
| S-002-c | 高危 | C02 | README.md:227-228；README.en.md:227-228 | 文档公开两个默认账号及口令 | 同上 | 文档改为说明如何初始化管理员 |
| S-003-a | 高危 | C15 | backend/src/routes/agent.ts:63-67 | `POST /agent/:type/chat` 只校验 `drama_id` 归属，`episode_id` 未校验即放入 Agent 上下文（:77-83），工具结果原样回给客户端（:110-115） | 用自己的 `drama_id` 搭配他人的 `episode_id`，即可通过 Agent 工具读取、改写、删除他人剧集数据 | 增加 `getEpisodeOwned` 校验并确认 episode 属于该 drama |
| S-003-b | 高危 | C15 | backend/src/routes/agent-async.ts:50-52 | 异步 Agent 入口同样只校验 `drama_id` | 同 S-003-a | 同 S-003-a |
| S-003-c | 高危 | C15 | backend/src/routes/agent-async.ts:115-117 | 同上（第二处入口） | 同 S-003-a | 同 S-003-a |
| S-003-d | 高危 | C15 | backend/src/routes/agent-async.ts:177-179 | 同上（第三处入口） | 同 S-003-a | 同 S-003-a |
| S-003-e | 高危 | C15 | backend/src/routes/agent-async.ts:239-241 | 同上（第四处入口） | 同 S-003-a | 同 S-003-a |
| S-003-f | 高危 | C15 | backend/src/agents/tools/script-tools.ts:40-47, 65-76, 86-93 | 工具仅按上下文中的 `episodeId` 读取剧本（:40-47、:65-76）和覆盖剧本（:86-93），自身不做归属校验 | 越权读取与覆盖他人剧本的实际落点 | 工具内按 `dramaId` 约束 episode，作为纵深防御 |
| S-003-g | 高危 | C15 | backend/src/agents/tools/storyboard-tools-write.ts:83-93, 183-188, 241 | `replace_existing` 时删除该 episode 全部分镜及关联（:83-93）；`update_storyboard` 按任意 `storyboard_id` 更新（:183-188、:241） | 越权删除、篡改他人分镜 | 更新/删除条件加上 episode 与 drama 约束 |
| S-003-h | 高危 | C15 | backend/src/agents/tools/storyboard-tools-read.ts:36-48, 61；backend/src/agents/tools/extract-tools.ts:42-48；backend/src/agents/tools/extract-tools-shared.ts:28-54 | 读分镜、读剧本、写资产关联同样只凭未校验的 `episodeId` | 越权读取，并向他人剧集写入关联 | 同 S-003-f |
| S-004-a | 高危 | C15 | backend/src/routes/tasks.ts:77-78 | `POST /tasks`：传了 `drama_id` 就不再校验 `storyboard_id`；`scene_id`、`character_id` 从不校验；两者都不传则完全不校验 | 可为他人的分镜/角色/场景发起生成任务 | 对请求中出现的每个资源 id 逐一做归属校验，并校验其同属一个 drama |
| S-004-b | 高危 | C15 | backend/src/routes/tasks.ts:95-108, 109-125 | 未校验的 id 直接传入 `generateImage` / `generateVideo` 并落到任务记录 | 同上 | 同上 |
| S-004-c | 高危 | C15 | backend/src/services/generation-poll.ts:189-207, 223-225 | 任务完成后仅按任务记录中的 id 回写分镜/角色/场景/道具的图片与视频，无归属校验 | 攻击者生成的内容会覆盖他人资产的图片/视频字段（跨租户写） | 回写前校验资产归属与任务 `userId`/`dramaId` 一致 |
| S-004-d | 高危 | C15 | backend/src/routes/tasks.ts:56-67 | `resolveEpisodeOverrides` 按任意 `storyboard_id` 取其所属剧集锁定的模型配置 | 配合 S-005 使用他人剧集锁定的配置 | 在归属校验之后再解析 |
| S-005-a | 高危 | C15 | backend/src/services/ai.ts:214-243 | `getConfigById` 按 id 取 AI 配置，只判断是否启用和厂商白名单，不比对调用者 | 任意登录用户传入他人的 `config_id` 即可用他人的 API Key 发起文本/图片/视频调用，盗用额度 | 增加 `userId` 参数并强制匹配（管理链路显式豁免） |
| S-005-b | 高危 | C15 | backend/src/services/ai.ts:123-133 | `resolveTextConfigMeta` 按 `configId` 取行不校验归属 | 成本记录归到他人配置 | 同 S-005-a |
| S-005-c | 高危 | C15 | backend/src/routes/tasks.ts:88-89 | `body.config_id` 未校验直接使用 | S-005-a 的入口 | 入口处校验归属 |
| S-005-d | 高危 | C15 | backend/src/routes/agent.ts:82；backend/src/routes/agent-async.ts:69 | Agent 入口透传 `config_id` | 同上 | 同上 |
| S-005-e | 高危 | C15 | backend/src/agents/model-factory.ts:160-163 | `getModel` 以 `textConfigId` 直接调用 `getConfigById` | 同上 | 同上 |
| S-005-f | 高危 | C15 | backend/src/services/generation-generate.ts:69-71, 108-110 | 图片/视频生成以 `params.configId` 直接取配置 | 同上 | 同上 |
| S-005-g | 高危 | C15 | backend/src/routes/characters.ts:106-110；backend/src/routes/scenes.ts:102-106；backend/src/routes/props.ts:134-138 | 资产生成接口的 `config_id` / `text_config_id` 未校验 | 同上 | 同上 |
| S-005-h | 高危 | C15 | backend/src/routes/episodes.ts:91-92；backend/src/services/asset-images.ts:114, 142, 162 | 剧集可锁定任意 `image_config_id` / `video_config_id`，后续生成沿用 | 把他人配置持久绑定到自己的剧集 | 写入时校验配置归属 |
| S-006-a | 高危 | C15 | backend/src/routes/dramas-assets.ts:57-63 | `PUT /dramas/:id/characters` 只校验路径中的 drama，随后按请求体里的任意 `char.id` 更新，并把请求体整体展开写库 | 可改写他人角色，且可写入任意列（含 `dramaId`），属于越权加批量赋值 | 更新条件加 `dramaId` 约束；改为字段白名单 |
| S-006-b | 高危 | C15 | backend/src/routes/dramas-assets.ts:76-88 | `PUT /dramas/:id/episodes` 同样按任意 `ep.id` 整体展开更新 | 可改写他人剧集的剧本、归属、锁定配置等 | 同 S-006-a |
| S-007-a | 高危 | C10 | backend/src/routes/aiConfigs.ts:110-164 | `POST /ai-configs/test` 用用户提交的 `base_url` 发起服务端请求（:128-132），无主机白名单、无内网拦截、无超时，并回显状态码与响应前 240 字符（:137-146）及错误信息（:160） | 任意登录用户可探测内网与云元数据服务并读到响应内容 | 解析后拦截私网/环回/链路本地地址，限制协议与端口，禁止重定向，加超时与大小上限，不回显响应体 |
| S-007-b | 高危 | C10 | backend/src/utils/storage-write.ts:21-37；backend/src/services/generation-poll.ts:158, 210 | `downloadFile` 对上游返回的结果 URL 直接 `fetch`（:29）并原样落盘到 `/static/`；上游地址即用户可配的 `base_url` | 用户自建"上游"返回任意内网 URL，服务端下载后以静态文件形式可被取回，构成完整回显的 SSRF；且无超时与大小上限 | 同 S-007-a；另校验内容类型为图片/视频 |
| S-007-c | 高危 | C10 | backend/src/utils/storage-image.ts:72-102；backend/src/services/generation-refs.ts:42-58, 64 | 请求中的 `reference_images` 等 http(s) 地址由服务端下载（storage-image.ts:85），无白名单 | 半盲 SSRF：结果需能被图片库解码才回流，但可用于内网探测 | 同 S-007-a |
| S-007-d | 高危 | C10 | backend/src/routes/aiConfigs.ts:87, 223-229 | `base_url` 新建与更新时入库无任何校验，后续所有适配器请求都发往该地址 | S-007-a/b 的根因 | 入库前做同样的地址校验，或改为按厂商固定域名 |
| S-008-a | 高危 | C12 | backend/src/routes/upload.ts:37-50 | `POST /upload/image` 不校验扩展名、MIME、内容和大小，直接保存 | 可上传 `.html`、`.svg` 等可被浏览器执行的文件 | 扩展名与文件头双重白名单，限制大小，统一重命名扩展名 |
| S-008-b | 高危 | C12 | backend/src/utils/storage-write.ts:42-52 | `saveUploadedFile` 保留用户原始扩展名（:46） | 同上 | 按检测出的真实类型决定扩展名 |
| S-008-c | 高危 | C12 | backend/src/utils/storage-core.ts:71-78；backend/src/utils/storage-write.ts:25 | 下载落盘时沿用 URL 路径中的扩展名（不超过 5 字符即采用） | 结合 S-007-b 也可落盘 `.html`/`.svg` | 扩展名白名单 |
| S-008-d | 高危 | C12/C13 | nginx/drama-mill.common.conf:27-33 | `/static/` 由 nginx 直连磁盘、与站点同源、无鉴权，未设置 `X-Content-Type-Options` 与 `Content-Disposition` | 上传的 HTML/SVG 以同源页面执行，可读取 `localStorage` 中的登录 token，形成存储型 XSS；利用需诱导受害者（含管理员）打开链接。仅 nginx 部署形态受影响，Node 直出时未知扩展名按 `application/octet-stream` 返回 | 静态资源改用独立域名，或强制下载并加 `nosniff`，只放行图片/视频类型 |
| S-009-a | 高危（疑似） | C15 | backend/src/agents/skills.ts:77-84 | Agent 的 Workspace 以 `LocalFilesystem({ basePath: backend/workspace })` 创建，未设 `readOnly`，未限制工具 | 已核对依赖 `@mastra/core` 1.17.0 的类型声明：文件系统工具（读/写/改/删等）默认启用、无需审批、自动注入 Agent，`readOnly` 默认 false。普通用户可通过对话诱导 Agent 改写平台级提示词与技能文件（HTTP 侧这些路径仅管理员可改），影响所有租户。**缺少的证据**：未做运行时验证，不确定模型实际能否被诱导调用这些工具；写入范围限于 workspace 目录内，无命令执行。需人工在测试环境确认 | Workspace 设为只读，或显式关闭写入类工具 |
| S-009-b | 高危（疑似） | C15 | backend/src/agents/index.ts:91-101 | 四类 Agent 均挂载上述 Workspace；:83-88 的注释表明作者知晓工具会被自动注入，但只对 `novel_splitter` 做了豁免 | 同上 | 同上 |
| S-009-c | 高危（疑似） | C15 | backend/src/routes/agent.ts:88-91 | 用户 `message` 原样作为 Agent 输入，最多 20 步工具调用 | S-009 的入口 | 同上 |

### 2.2 中危

| 问题索引 | 严重程度 | 检查项编号 | 文件路径:行号 | 问题描述 | 风险说明 | 修复建议（仅建议，不执行） |
|---------|---------|-----------|--------------|---------|---------|--------------------------|
| S-010-a | 中危 | C19 | backend/src/services/generation.ts:209 | 把上游请求的完整 `headers` 写入任务日志 | 见 S-010-b | 日志中不记录请求头，或改为白名单字段 |
| S-010-b | 中危 | C19 | backend/src/utils/task-logger.ts:84-85 | 脱敏规则只匹配 `authorization`、`token`、`apikey`、`api_key`，不匹配带连字符的 `x-goog-api-key` | Gemini 的 API Key 明文写入 `logs/app-out.log`，能读日志者即可获得 | 规则增加 `api-key`、`x-goog-api-key` 等写法，或按"包含 key/secret"匹配 |
| S-010-c | 中危 | C19 | backend/src/services/adapters/gemini-image.ts:60, 84, 138 | 三处请求头使用 `x-goog-api-key` | 上述未脱敏字段的来源 | 同上 |
| S-011-a | 中危 | C11 | backend/src/routes/storyboards.ts:139-147 | 分镜更新接口允许用户直接写 `video_url`（:146） | 见 S-011-b | 该字段只允许系统回写，或校验为本租户 `static/` 下的路径 |
| S-011-b | 中危（疑似） | C11 | backend/src/services/ffmpeg-merge.ts:56-58, 70, 152-154, 179 | 合成时把 `videoUrl` 转成绝对路径写入 concat 清单（未转义），并以 `-safe 0` 交给 ffmpeg | 用户可让 ffmpeg 读取服务器任意路径；报错信息还可用于探测文件是否存在。**需人工确认**：ffmpeg 实际能从非视频文件中带出多少内容 | 路径规范化后限制在存储根目录内；清单内容转义 |
| S-011-c | 中危 | C11 | backend/src/utils/storage-core.ts:84-94 | `getAbsolutePath` 对绝对路径原样返回（:85），相对路径直接拼接、不拦截 `..`（:93） | S-011、S-012 的共同根因 | 统一做 `resolve` 后的前缀校验 |
| S-012-a | 中危 | C11 | backend/src/services/generation-refs.ts:31-39, 62 | 参考图值只要以 `static/` 开头就去掉前缀后读本地文件，可用 `static/../..` 穿越 | 可读取存储根目录之外的文件并作为参考图发往上游（上游地址用户可控）。影响限于能被图片库解码的文件，包括其他租户的图片 | 同 S-011-c |
| S-012-b | 中危 | C11 | backend/src/utils/storage-image.ts:40-65 | 读取并压缩本地图片时未约束目录 | 同上 | 同上 |
| S-012-c | 中危 | C11 | backend/src/routes/characters.ts:36；backend/src/routes/scenes.ts:79-85；backend/src/routes/props.ts:85-88；backend/src/routes/tasks.ts:95-108 | 资产的 `image_url` / `local_path` 用户可写；任务接口的 `reference_images` 用户直传 | 上述穿越的两条输入路径 | 这些字段只允许系统回写或做路径校验 |
| S-013-a | 中危 | C15 | backend/src/routes/characters.ts:58-62 | 新建角色时 `episode_id` 未校验即写入关联表 | 可向他人剧集挂接自己的资产，污染他人数据 | 校验 episode 归属且属于同一 drama |
| S-013-b | 中危 | C15 | backend/src/routes/scenes.ts:47, 54-58 | 场景同上 | 同上 | 同上 |
| S-013-c | 中危 | C15 | backend/src/routes/props.ts:63-67 | 道具同上 | 同上 | 同上 |
| S-013-d | 中危 | C15 | backend/src/routes/characters.ts:121-132；backend/src/routes/scenes.ts:138-149；backend/src/routes/props.ts:105-116 | 生成提示词接口只校验资产归属，`episode_id` 可指向任意剧集（分别在 :128、:145、:112 取用） | 他人剧集的剧本内容会进入提示词生成的上下文 | 同上 |
| S-013-e | 中危 | C15 | backend/src/services/asset-images.ts:99-102, 119-122, 147-150 | 服务层不校验 episode 与资产同属一个 drama | 上述问题的服务层落点 | 服务层补充一致性校验 |
| S-014-a | 中危 | C15 | backend/src/agents/tools/image-prompt-tools.ts:42-49 | `persistFinalPrompt` 只按资产 id 更新，不约束 `dramaId` | Agent 工具参数来自模型输出，用户可通过对话诱导其指向他人的资产 id，覆盖他人的最终提示词 | 更新条件加 `dramaId` |
| S-014-b | 中危 | C15 | backend/src/agents/tools/image-prompt-tools.ts:82-90 | 角色保存工具按任意 `character_id` 取行并写入 | 同上 | 同上 |
| S-014-c | 中危 | C15 | backend/src/agents/tools/image-prompt-tools.ts:128, 131 | 场景保存工具同上 | 同上 | 同上 |
| S-014-d | 中危 | C15 | backend/src/agents/tools/image-prompt-tools.ts:169, 172 | 道具保存工具同上 | 同上 | 同上 |
| S-015-a | 中危 | C15 | backend/src/services/final-prompt.ts:46-54 | 构造 Agent 上下文时没有传 `userId` | 见 S-015-b | 传入当前用户 id |
| S-015-b | 中危 | C15 | backend/src/services/ai.ts:136-147 | `selectActiveConfig` 在 `userId` 为空时退回到全部用户的配置中选优先级最高者 | 该链路会使用其他用户的文本模型配置与 Key | 用户侧调用禁止 `userId` 为空 |
| S-015-c | 中危 | C15 | backend/src/services/asset-images.ts:112, 132, 160 | 调用最终提示词生成时未传 `userId` | 上述问题的调用点 | 同上 |
| S-016 | 中危 | C22 | backend/src/routes/auth.ts:38-45 | 登录接口无限流、无失败锁定、无验证码；nginx 也未配置限速 | 结合 6 位最小口令与公开的默认账号名，可被在线爆破 | 按 IP 与账号限速，失败多次后锁定 |
| S-017-a | 中危 | C16 | backend/src/routes/auth.ts:128-129 | 注销接口为空操作 | 注销后 token 仍然有效 | 引入 token 版本号或黑名单 |
| S-017-b | 中危 | C16 | backend/src/routes/auth.ts:68-82 | 修改密码后旧 token 不失效 | 账号被盗后改密无法踢出攻击者 | 改密时递增 token 版本 |
| S-017-c | 中危 | C16 | backend/src/routes/admin/users.ts:115 | 管理员重置密码后旧 token 不失效 | 同上 | 同上 |
| S-017-d | 中危 | C16 | backend/src/services/auth.ts:28 | token 默认有效期 7 天，无刷新机制 | 泄露后的可用窗口长 | 缩短有效期并加刷新 |
| S-018-a | 中危 | C19 | backend/src/middleware/logger.ts:95-96 | 全局错误处理把 `err.message` 原样返回客户端 | 数据库报错、内部路径、上游响应等可能外泄【勘误 7.2.5：经比对裁决调为低危——多数是受控的业务文案，上游响应体进错误信息那一处另随 S-018-d 处理，理由见安全修复确认清单 2.4】 | 5xx 统一返回通用文案，细节只进日志 |
| S-018-b | 中危 | C19 | backend/src/routes/agent.ts:118-120 | Agent 异常信息直接返回 | 同上 | 同上 |
| S-018-c | 中危 | C19 | backend/src/routes/tasks.ts:132-133, 274 | 任务创建与重试的异常信息直接返回 | 同上 | 同上 |
| S-018-d | 中危 | C19 | backend/src/services/generation.ts:145 | 上游响应体拼进错误信息，随后落库并可被前端读到 | 配合 S-007 相当于又一条回显通道 | 截断并过滤后再保存 |
| S-018-e | 中危 | C19 | backend/src/routes/aiConfigs.ts:160 | 连接测试的底层错误信息直接返回 | 同上 | 同上 |
| S-019-a | 中危 | C01 | docker-compose.yml:13, 43, 46, 57 | 数据库业务账号口令与 root 口令写死在 compose 文件中（:57 的健康检查命令也带 root 口令） | 默认口令公开，照此部署即为弱口令数据库【勘误 7.2.5：经比对裁决整体（S-019-a/b 合并后含 3307 端口默认发布）调为高危，理由见安全修复确认清单 2.4】 | 改为环境变量或 secrets 注入 |
| S-019-b | 中危 | C22 | docker-compose.yml:41 | MySQL 端口映射到宿主机 `3307`，未限定监听地址 | 与 S-019-a 叠加，数据库可能被公网直连 | 去掉映射或绑定 `127.0.0.1` |
| S-019-c | 中危 | C01 | backend/src/db/index.ts:41-42 | 数据库用户名与口令有硬编码回退值 | 未配置时使用公开口令 | 缺失时拒绝启动 |
| S-019-d | 中危 | C01 | .env.example:8；backend/.env.example:9-10；README.md:155, 213 | 示例与文档中给出同一默认数据库口令 | 易被照抄 | 示例留空 |
| S-020-a | 中危 | C14 | backend/src/index.ts:120-154 | `/static/*` 不挂鉴权（:118 注释自述） | 所有租户生成的图片、视频、上传的文档原文仅靠 UUID 文件名保护，链接泄露即可被任何人访问 | 改为签名 URL 或鉴权后下发 |
| S-020-b | 中危 | C14 | nginx/drama-mill.common.conf:27-33 | nginx 侧同样无鉴权直出，并设置一年公开缓存 | 同上 | 同上 |
| S-021 | 中危 | C14/C21 | nginx/drama-mill.common.conf:36-40 | `/disk_status` 无鉴权对外暴露（内容由 `deployment/disk-monitor.sh:57-71` 写入，含主机名与磁盘容量） | 泄露主机信息【勘误 7.2.5：经比对裁决调为低危——仅主机名与磁盘容量，理由见安全修复确认清单 2.4】 | 限制来源 IP 或挂到管理端鉴权之后 |

### 2.3 低危

| 问题索引 | 严重程度 | 检查项编号 | 文件路径:行号 | 问题描述 | 风险说明 | 修复建议（仅建议，不执行） |
|---------|---------|-----------|--------------|---------|---------|--------------------------|
| S-022 | 低危 | C15 | backend/src/routes/tasks.ts:154-183；backend/src/routes/tasks-shared.ts:43-56 | 失败详情接口按任务参数里的 `configId` 读取配置摘要（:159-160），不校验配置归属 | 配合 S-005 可看到他人配置的厂商、地址与掩码后的 Key | 校验配置归属 |
| S-023-a | 低危 | C16 | backend/src/routes/auth.ts:35, 76 | 用户改密的最小长度为 6，无复杂度要求 | 弱口令 | 提高长度并加强度校验 |
| S-023-b | 低危 | C16 | backend/src/routes/admin/users.ts:71 | 管理员建用户的口令最小长度为 4 | 同上 | 同上 |
| S-023-c | 低危 | C16 | backend/src/routes/admin/users.ts:115 | 管理员重置口令的最小长度为 4 | 同上 | 同上 |
| S-024 | 低危 | C16 | backend/src/services/auth.ts:61 | `jwt.verify` 未显式指定 `algorithms` | 当前 jsonwebtoken 9.x 默认拒绝 `none`，属纵深防御 | 显式限定为 `HS256` |
| S-025-a | 低危 | C16 | frontend/app/api/core.ts:21, 25 | 登录 token 存放在 `localStorage` | 一旦出现 XSS（见 S-008）即可被窃取 | 评估改用 HttpOnly Cookie 并配套 CSRF 防护 |
| S-025-b | 低危 | C19 | frontend/app/api/core.ts:50 | 把每个请求的请求体打印到浏览器控制台 | 登录口令、API Key 会出现在控制台 | 生产构建去掉该日志或脱敏 |
| S-026-a | 低危 | C19 | docker/init.sql:214 | AI 配置的 `api_key` 以明文列存储 | 数据库泄露即密钥泄露 | 应用层加密存储 |
| S-026-b | 低危 | C19 | backend/src/routes/aiConfigs.ts:46-53 | 配置列表把明文 `api_key` 返回给属主前端 | 密钥在浏览器侧长期可见 | 仅返回掩码，编辑时留空表示不变 |
| S-026-c | 低危 | C19 | backend/src/routes/ai-config-probe.ts:65-66；backend/src/services/adapters/gemini-image.ts:80, 137 | Gemini 的 Key 同时放在 URL 查询参数中 | 可能被中间代理或上游访问日志记录（本服务日志已对 URL 脱敏） | 只用请求头传递 |
| S-027-a | 低危 | C19 | backend/src/middleware/audit.ts:28, 35 | 审计日志的脱敏只处理请求体顶层键 | 嵌套字段中的密钥会原样入审计表 | 递归脱敏 |
| S-027-b | 低危 | C19 | backend/src/middleware/audit.ts:75 | 审计 IP 取自 `x-forwarded-for` | 直连后端端口时可伪造来源 IP | 只信任来自反向代理的头 |
| S-028-a | 低危 | C19 | backend/src/routes/agent.ts:60-61, 108 | 日志记录完整的对话消息、请求体与工具结果 | 用户创作内容全量进入日志文件 | 截断或只记录元数据 |
| S-028-b | 低危 | C19 | backend/src/routes/tasks.ts:93 | 日志记录完整任务请求体 | 同上 | 同上 |
| S-028-c | 低危 | C19 | backend/src/routes/storyboards.ts:105, 137 | 日志记录完整分镜请求体 | 同上 | 同上 |
| S-029-a | 低危 | C22 | backend/src/index.ts:188 | 服务未配置请求体大小上限、限流与安全响应头 | 明确的资源耗尽面【勘误 7.2.5：经比对裁决调为中危——请求日志中间件挂在鉴权之前（`backend/src/index.ts:75` 早于 `:86`），未登录即可让服务端把 100MB 请求体整个读进内存，理由见安全修复确认清单 2.4】 | 加 `bodyLimit`、限流与安全头中间件 |
| S-029-b | 低危 | C22 | backend/src/middleware/logger.ts:63-66 | 请求日志中间件为记录日志而完整读取请求体 | 大请求体占用内存 | 限制读取长度 |
| S-029-c | 低危 | C22 | backend/src/routes/upload.ts:115-116, 130-131 | 先把上传文件全部读入内存，再判断大小 | 大小限制起不到保护内存的作用 | 读取前按 `Content-Length` 或流式判断 |
| S-029-d | 低危 | C22 | backend/src/routes/novels.ts:81-82；backend/src/routes/production-batch.ts:101-102 | 同上 | 同上 | 同上 |
| S-029-e | 低危 | C22 | nginx/drama-mill.common.conf:4, 58-59 | 请求体上限 100MB、代理超时 300 秒，无 `limit_req` | 单请求资源占用上限偏高 | 按接口细分上限并加限速 |
| S-030-a | 低危 | C22 | nginx/drama-mill.conf:35-36 | `ssl_ciphers HIGH:!aNULL:!MD5` 较宽泛 | 可能协商到较弱套件 | 采用现行推荐套件列表 |
| S-030-b | 低危 | C22 | nginx/drama-mill.common.conf（全文 61 行） | 未设置 HSTS、CSP、`X-Frame-Options`、`X-Content-Type-Options` 等安全头 | 纵深防御缺失 | 补充安全头 |
| S-031-a | 低危 | C22 | Dockerfile:63 | 镜像全文（64 行）没有 `USER` 指令，:63 的启动命令以 root 运行 | 应用被攻破后直接获得容器 root | 使用非特权用户 |
| S-031-b | 低危 | C20 | Dockerfile:48 | `npm i -g tsx` 未锁定版本 | 构建不可复现，存在供应链风险 | 锁定版本 |
| S-031-c | 低危 | C22 | deployment/drama-mill-services.sh:11 | 脚本注释说明应用由 `pm2-root` 服务拉起，即生产以 root 的 PM2 运行 | 同 S-031-a | 使用专用低权限账号 |
| S-032 | 低危 | C11 | backend/src/routes/skills.ts:56, 64, 102 | 技能文件的读、写、删三个通配路由未像新建接口（:74-79）那样校验路径段 | 仅管理员可达，且文件系统默认限制在 workspace 目录内，无法逃逸；属纵深防御 | 统一做路径段校验 |
| S-033-a | 低危 | C01 | deployment/fix-tenant-attribution.sh:32 | 数据库口令作为命令行参数传给 mysql | 同机其他用户可通过进程列表看到口令 | 改用配置文件或环境变量 |
| S-033-b | 低危 | C07 | deployment/fix-tenant-attribution.sh:40 | 脚本参数在数字校验之前被拼进 SQL | 运维脚本，需本机执行权限才可触发 | 先校验再使用 |
| S-034 | 低危 | C15 | backend/src/routes/tasks.ts:138 | `/tasks/queue` 向任何登录用户返回全局队列统计 | 泄露平台整体负载 | 按用户过滤或仅管理员可见 |
| S-035 | 低危 | C13 | frontend/app/components/MentionTextarea.vue:27；frontend/app/composables/useMentionTextarea.js:20-22, 35-45 | 前端唯一一处 `v-html`；内容已先转义 `& < >`，class 值为固定常量 | 当前未见可利用路径；转义函数未处理引号，将来若把用户内容放进属性会出问题 | 转义函数补充引号 |
| S-036 | 低危 | C09 | backend/tests/merge-cleanup.test.mjs:16；frontend/tests/official-provider-settings.test.mjs:4, 205 | 测试用 `vm.runInNewContext` 执行仓库内源码片段 | 输入不来自外部，仅作信息记录 | 无需处理 |
| S-037 | 低危 | C04 | 见 2.4 清单 | 范围内的 `http://` 明文地址，全部为 localhost、127.0.0.1 或文档示例 | 低危例外，按要求列出 | 无需处理；生产对外地址保持 HTTPS |
| S-038 | 低危（疑似） | C20 | backend/package.json；frontend/package.json；两个 package-lock.json | 按 lock 文件中的实际版本核对。**原结论「未发现能确定命中的已知高危组件版本」有误**：sharp 锁定 0.34.5 落在 GHSA-f88m-g3jw-g9cj（<0.35.0）与 CVE-2026-96889（<0.35.5）区间；hono 4.12.9、@hono/node-server 1.19.11、drizzle-orm 0.45.1、mammoth 1.12.1、nuxt 3.21.2、vite 7.3.1 等多个依赖的锁定版本同样落在已公开的漏洞区间内（报告 A 的 S-010、S-025~S-028 已逐条记录）。`fluent-ffmpeg` 2.1.3 上游已停止维护；依赖声明多为 `^` 浮动范围【勘误 7.2.2：本项结论已修正，对照 `安全修复确认清单-drama-mill-2026-11-19.md` 2.2 与 6.1】 | **缺少的证据**：未联网比对漏洞库，仅凭版本号判断。需人工运行 `npm audit` 确认【勘误 7.2.2：事后已补查 8 条公开公告并确认多项命中（见确认清单 6.1），权威修复版本仍以 `npm audit` 为准】 | 人工执行 `npm audit`；评估替换停更组件 |
| S-039-a | 低危 | C06 | backend/src/index.ts:71-74 | CORS 白名单只有两个 localhost 源并开启 `credentials` | 非通配，不构成过宽；鉴权走 `Authorization` 头而非 Cookie，CSRF 不适用。仅记录：`credentials: true` 无实际用途 | 去掉多余的 `credentials` |
| S-039-b | 低危 | C22 | backend/src/index.ts:188；docker-compose.yml:9 | 后端监听全部网卡，compose 把 5679 直接映射到宿主机 | 可绕过 nginx 直连后端，使 S-027-b 的 IP 伪造成立 | 绑定 `127.0.0.1` 或用防火墙限制 |

### 2.4 S-037 明文地址清单（C04，均为低危例外）

| 文件路径:行号 | 内容性质 |
|---|---|
| backend/src/index.ts:72（两处）, 171 | CORS 本机源、启动日志 |
| backend/src/services/generation-refs.ts:64, 135 | 协议前缀判断字符串，非地址；说明参考图接受 http 明文 URL |
| backend/scripts/regen-missing-assets.ts:31 | 本机 API 地址 |
| deployment/deploy.sh:149, 151, 152 | 本机健康检查与提示 |
| deployment/drama-mill-boot-check.sh:28 | 本机健康检查 |
| deployment/drama-mill-services.sh:23 | 本机健康检查 |
| docker-compose.yml:29 | 本机健康检查 |
| frontend/nuxt.config.ts:68, 69 | 开发代理到本机后端 |
| nginx/drama-mill.common.conf:43 | 反向代理到本机后端 |
| README.md:192, 193, 206, 314, 372, 376；README.en.md:192, 193, 206, 314, 372, 376 | 文档中的本机地址；:376 为 `host.docker.internal` 的 Ollama 示例 |

`backend/tests`、`frontend/tests`、`backend/workspace`、`frontend/app`、`docker/model-catalog-data.sql` 中未发现 `http://`。

### 2.5 范围外发现（单独标注）

以下文件未入库（被 `.gitignore` 忽略或未跟踪），不在仓库内容范围内，仅因存在于本地工作区而提示。真实值未写入本报告。

| 编号 | 文件 | 说明 | 建议 |
|---|---|---|---|
| X-01 | backend/.env | 含真实数据库口令（:6）；全文 13 行没有 `JWT_SECRET`，本地运行即落入 S-001-a 的默认密钥 | 确认生产环境的 `.env` 是否同样缺失该项 |
| X-02 | .dbpass.tmp | 根目录下的临时口令文件（24 字符） | 用完即删，确认未被备份或同步 |
| X-03 | .rescue-historical.sh:14, 19, 23 | 运维救援脚本，其中用默认 JWT 密钥自签管理员 token 调用本机接口 | 侧面印证 S-001 在实际环境中可用；修复 S-001 后一并清理 |
| X-04 | backend/node_modules/@mastra/core（1.17.0） | 仅为核实 S-009 读取了其类型声明：workspace 文件系统工具默认启用且无需审批，`contained` 默认 true，`readOnly` 默认 false | 无 |

另：`backend/scripts/regen-missing-assets.ts:52-53` 会为所有用户自签 token 调用本机接口，属正常运维用途，但说明持有 JWT 密钥即等同持有全部账号。

## 3. 统计

### 3.1 按严重程度

| 严重程度 | 问题数（按主索引） | 子项数 |
|---|---|---|
| 高危 | 9（S-001 ~ S-009，其中 S-009 为疑似） | 40 |
| 中危 | 12（S-010 ~ S-021，其中 S-011-b 为疑似） | 38 |
| 低危 | 18（S-022 ~ S-039，其中 S-038 为疑似） | 35 |
| 合计 | 39 | 113 |

### 3.2 按检查项分布（每个主索引按其首个子项的首个检查项编号归类，只计一次）

| 检查项 | 问题数 | 问题索引 | 结论 |
|---|---|---|---|
| C01 明文密钥 | 3 | S-001、S-019、S-033 | 有问题 |
| C02 硬编码账号 | 1 | S-002 | 有问题 |
| C03 私钥/证书入库 | 0 | — | 未发现；证书路径指向服务器本地，未入库 |
| C04 明文 http 地址 | 1 | S-037 | 仅低危例外 |
| C05 禁用证书校验 | 0 | — | 未发现 |
| C06 CORS/CSRF | 1 | S-039 | 非通配；token 走请求头，CSRF 不适用 |
| C07 SQL 注入 | 0 | — | 路由与服务层全部参数化；仅运维脚本一处低危子项 S-033-b（主索引计入 C01） |
| C08 命令注入 | 0 | — | 未发现；ffmpeg 调用均为数组参数 |
| C09 代码注入/反序列化 | 1 | S-036 | 业务代码未发现；仅测试代码信息项 |
| C10 SSRF | 1 | S-007 | 有问题 |
| C11 路径遍历 | 3 | S-011、S-012、S-032 | 有问题 |
| C12 文件上传 | 1 | S-008 | 有问题 |
| C13 XSS | 1 | S-035 | 前端模板未见可利用点；实际风险面在 S-008 |
| C14 未鉴权接口 | 2 | S-020、S-021 | 有问题；`/api/v1` 白名单仅健康检查与登录 |
| C15 越权 | 10 | S-003、S-004、S-005、S-006、S-009、S-013、S-014、S-015、S-022、S-034 | 问题最集中 |
| C16 JWT/Session | 4 | S-017、S-023、S-024、S-025 | 有问题（弱密钥计入 S-001） |
| C17 弱加密 | 0 | — | 未发现；口令使用 bcrypt（cost 10） |
| C18 不安全随机数 | 0 | — | 未发现用于令牌或密钥 |
| C19 日志与响应泄露 | 5 | S-010、S-018、S-026、S-027、S-028 | 有问题（另有子项 S-025-b） |
| C20 依赖漏洞 | 1 | S-038 | 结论有误（勘误 7.2.2）：sharp 0.34.5（GHSA-f88m-g3jw-g9cj、CVE-2026-96889）、hono 4.12.9、@hono/node-server 1.19.11、drizzle-orm 0.45.1、mammoth 1.12.1、nuxt 3.21.2、vite 7.3.1 等多个锁定版本落在已公开漏洞区间内，需升级（修复指引见确认清单 F-10、F-22）；权威修复版本仍以 `npm audit` 为准【勘误 7.2.2：见 `安全修复确认清单-drama-mill-2026-11-19.md` 2.2、6.1】 |
| C21 调试/文档接口 | 1（补记，未分配主索引） | 补记 `GET /agent/:type/debug` | 原写「未发现调试开关与文档控制台」不完整：漏报 `GET /agent/:type/debug`（`backend/src/routes/agent.ts:125-129`，即报告 A 的 S-047），该端点位于鉴权之后、仅返回 `{agent_type, valid:true}` 无敏感数据，属调试端点遗留；文档控制台仍未发现；`/disk_status` 计入 S-021【勘误 7.2.3：见 `安全修复确认清单-drama-mill-2026-11-19.md` 7.2】 |
| C22 危险配置/DoS | 4 | S-016、S-029、S-030、S-031 | 有问题 |
| 合计 | 39 | | |

## 4. 覆盖率与盲区说明

### 4.1 范围内文件数

| 目录 | 文件数 | 审查方式 |
|---|---|---|
| backend/src | 163 | 约 100 个语义级阅读；约 63 个为全局正则扫描 + 命中段阅读 |
| backend/scripts | 13 | 1 个全文阅读（`regen-missing-assets.ts`）；其余为正则扫描 + 子代理抽样 |
| backend/tests | 75 | 正则扫描 + 子代理抽样 |
| backend/workspace | 9 | 正则扫描 + 子代理抽样（提示词与技能 Markdown） |
| frontend/app | 169 | 4 个关键文件亲读（登录页、请求封装、`v-html` 相关两个文件）；其余为全量正则扫描 + 子代理抽样；2 个 PNG 未审 |
| frontend/tests | 46 | 正则扫描 |
| deployment | 7 | 全部全文阅读 |
| nginx | 2 | 全部全文阅读 |
| docker | 2 | `init.sql` 为正则扫描；`model-catalog-data.sql`（约 5MB）仅模式扫描 |
| 根级文件 | 15 | `docker-compose.yml`、`Dockerfile`、`.env.example`、`package.json`、`.rescue-historical.sh` 全文阅读；README、`CLAUDE.md`、`.gitignore`、`.dockerignore`、`ecosystem.config.cjs`、`LICENSE` 为正则扫描；`.dbpass.tmp` 只看了长度；1 个 PNG、1 个 `.DS_Store` 未审 |
| backend 目录散件 | 8 | `package.json`、`.env.example`、`.gen-smoke.mts` 全文阅读；`.env` 只看键名；lock 文件按版本检索；`tsconfig.json`、`.gitignore` 为正则扫描；1 个 `.DS_Store` 未审 |
| frontend 目录散件 | 7 | `package.json`、`nuxt.config.ts` 全文阅读；lock 文件按版本检索；`tsconfig.json`、`.gitignore`、`.nuxtrc` 为正则扫描；1 个 `.DS_Store` 未审 |
| frontend/public | 1 | 1 个 PNG 未审 |
| 合计 | 517 | |

**已审查文件数 / 范围内文件总数 = 510 / 517。**

说明：审查过程中曾按 510 统计范围内文件，成稿前按磁盘实际文件复核为 517（此前漏计了 `backend/`、`frontend/` 目录下的 `.DS_Store`、`.env`、`tsconfig.json` 等散件和 `frontend/public`），以本表为准。

### 4.2 未覆盖文件及原因

| 文件 | 原因 |
|---|---|
| `donate.png`、`frontend/public/favicon.png`、`frontend/app/assets/drama-mill-logo.png`、`frontend/app/assets/drama-mill-logo-128.png` | 二进制图片 |
| `.DS_Store`、`backend/.DS_Store`、`frontend/.DS_Store` | 系统二进制元数据（未入库） |

`docker/model-catalog-data.sql` 计入已审查，但因体积过大只做了密钥模式与 `http://` 的正则扫描，未逐行阅读。

### 4.3 盲区（请人工留意）

1. **全覆盖要求未完全达到语义级。** `backend/src` 中约 63 个文件只做了全局正则扫描和命中段阅读，未逐行读完，主要是：各厂商适配器（dashscope、volcengine、minimax、openai-image 等）、看门狗与自愈类服务、批量生产类服务、成本与模型目录类服务、数据库 schema 与迁移的后半部分、部分 admin 子路由。这些文件里如果存在不带明显关键词的逻辑缺陷，本次可能漏掉。
2. **前端与测试目录以扫描为主。** `frontend/app` 的 169 个文件中只有 4 个亲读；部分子代理转述的结论未经我核实，未写入问题表，包括：`frontend/app/components/settings/SettingsCfgEditor.vue` 中 API Key 明文显示、`backend/scripts/export-catalog-sql.ts` 与 `migrate-model-catalog.ts` 中的 SQL 拼接、`audit-storage-orphans.ts` 的文件操作。建议人工补看。
3. **未做任何动态验证。** 所有结论来自静态阅读。S-009（Agent 可写 workspace）、S-011-b（ffmpeg 可读文件范围）两项特别需要在测试环境实测。
4. **未联网比对漏洞库。** C20 只按版本号人工判断，结论为"未发现明确命中"，不等于没有。
5. **工作区含未提交改动。** 以下文件与 `27ab615` 不同，行号以当前工作区为准，提交后可能偏移：`backend/src/routes/ai-config-probe.ts`、`backend/src/services/adapters/registry.ts`、`backend/src/services/ai.ts`、`backend/src/services/failure-detail-rules.ts`、`backend/src/services/generation-router.ts`、`backend/src/services/adapters/token-plan.ts`（未跟踪）、`frontend/app/composables/settings/useAiConfigs.js`，以及 5 个测试文件。
6. **服务器实际配置不可见。** 生产环境的 `.env`、nginx 实际生效配置、防火墙规则、证书文件均不在仓库内，S-001、S-019、S-039-b 的实际暴露程度需对照线上确认。
7. **严重程度为静态判断。** S-008 需诱导受害者访问，S-005 需知道或枚举他人的配置 id（自增整数），定级时已从严；人工复核时可按实际部署形态调整。

---

本报告仅为问题索引，未修改任何代码。请人工审查后，将确认需修复的问题索引/文件/行号回传，再执行修复。
