# 安全审查报告 drama-mill（2026-11-18）

## 1. 概述

### 1.1 审查范围

以 `docs/repo-wiki.md`（含附录 A/B）为地图，范围内文件总数 **508**：

- **目录**：`backend/src`（162）、`backend/scripts`（13）、`backend/tests`（74）、`backend/workspace`（9）、`frontend/app`（169）、`frontend/tests`（46）、`deployment/`（7）、`nginx/`（2）、`docker/`（2）
- **根级文件**（15）：.dbpass.tmp、.dockerignore、.DS_Store、.env.example、.gitignore、.rescue-historical.sh、CLAUDE.md、docker-compose.yml、Dockerfile、donate.png、ecosystem.config.cjs、LICENSE、package.json、README.en.md、README.md
- **指定散件**：backend 5（package.json、tsconfig.json、.env、.env.example、.gen-smoke.mts）；frontend 4（package.json、nuxt.config.ts、tsconfig.json、.nuxtrc）
- **排除项**：`node_modules/`、`.nuxt/`、`.output/`、`dist/`、`data/`、`drama/`、`logs/`、`.git/`、`.qoder/`、`*.min.js`；二进制（3 个 PNG + .DS_Store）计入总数但单列；两份 `package-lock.json` 不计入 508，仅用于依赖版本核对
- **范围外只读引用**（仅作证据，不计覆盖）：`backend/node_modules/@mastra/core/dist/chunk-ABA3KD3X.js`（LocalFilesystem containment 与 workspace 工具注入段）、`frontend/dist` 与 `.output/public` 的 .map 只读计数

### 1.2 审查方式

Qoder 多智能体只读审查：Repo Wiki 制图 + 4 路并行检查项审查（正则全局扫描 + 语义阅读）+ 汇总核验。

- 四路分工：C01-C06/C17-C19（密钥/传输/加密/日志）、C07-C13（注入/文件/XSS）、C14-C16（认证/授权/JWT）、C20-C22（依赖/暴露面/危险配置）
- 汇总阶段对**每个问题的每一处 文件:行号 逐一实际读取核验**：全部匹配，**0 处行号修正、0 处子项删除**；唯一修正是描述级的——C16-6 称 `.dbpass.tmp` 为"0 字节空文件"与实测不符（实为 25 字节），已按 C01-09 裁决修正（见 4.3）
- 全程只读：未启动服务、未连库、未运行安装/迁移命令；`npm audit` 因需联网拉取元数据且写入 ~/.npm 缓存（违反零写入铁律）被跳过，C20 改用"锁定版本 × 公开公告区间"人工比对，凡仅凭版本区间判定一律标**疑似**
- 本报告是唯一写入的文件；所有问题只记录不修复；一切密钥/口令值已打码

### 1.3 审查时间

2026-11-18

### 1.4 覆盖率统计

**已审查 504 / 范围内 508（99.2%）**，覆盖方式分层：

| 层 | 覆盖情况 |
|---|---|
| 语义精读（全文或关键段） | 安全关键文件去重后逾百个：backend 入口/中间件/认证/归属/DB 种子与连接、routes 顶层 29 文件逐一核对 + admin 19 文件、agents/tools 全部工具、存储/上传/ffmpeg/生成轮询/参考图/日志脱敏链路、deployment 全部 7 脚本、nginx 2 conf、Dockerfile/compose/PM2、两级 .env 与 .env.example、backend/.env、.dbpass.tmp、.rescue-historical.sh、.gitignore/.dockerignore、前端 token 链路 3 文件 + login.vue + MentionTextarea.vue + nuxt.config.ts、README 凭证相关段落等 |
| 全局正则扫描 + 命中上下文阅读 | 其余全部文本文件（含 backend/tests 74、frontend/tests 46、frontend/app 其余组件与 31 个 CSS、backend/workspace 9、scripts、docs 等）：各检查项关键词/正则横扫（凭证模式、注入面、fetch/文件读写、XSS 向量、鉴权/归属关键词、debug/sourcemap/限流/bodyLimit、Math.random、弱加密等），命中处逐一读上下文；被 gitignore 的文件用只读 bash grep/直接读取补齐 |
| 正则全扫 + 抽样（未逐行） | `docker/model-catalog-data.sql`（5.0MB 纯数据 INSERT）：凭证模式全文件 grep + 头部抽样 + 语句类型普查（仅 SET/CREATE/INSERT，无存储过程/危险语句/用户口令种子） |
| 未覆盖 | 3 个 PNG（frontend/app/assets/drama-mill-logo.png、drama-mill-logo-128.png、根 donate.png）+ 根 .DS_Store：二进制，无法语义阅读（与 wiki 附录 A 一致） |

---

## 2. 问题汇总表

排序：高危 → 中危 → 低危；**疑似项按定级倾向插入对应区块**，严重程度列标"疑似·X"。同一根因跨检查项重复报告已合并为一个索引，多处出现以 S-xxx-a/b/c 子行列出（各保留原检查项编号与文件:行号）。原始记录 81 条，去重合并后 **61 个问题索引**。路径均为仓库相对路径；行号已全部实读核验。凭证值一律打码（`******`）。

| 问题索引 | 严重程度 | 检查项编号 | 文件路径:行号 | 问题描述 | 风险说明 | 修复建议（仅建议，不执行） |
|---|---|---|---|---|---|---|
| S-001 | 高危 | C01-01 / C16-1 / C22-02(JWT) / C01-07 / C16-6 | 多处，见子项 | JWT 签名密钥硬编码默认回退值 `drama-mill-jwt-******`（打码），且 backend/.env 全文 13 行（wc -l 口径，全文同）**未配置 JWT_SECRET → 公开默认密钥实际生效**；backend/.env.example 全文 68 行甚至无 JWT_SECRET 条目，照示例部署必然踩坑 | 密钥随开源仓库公开，任何人可离线伪造任意用户（含 role:'admin'，种子 admin 通常 id=1 可枚举）的合法 HS256 JWT；middleware 每请求查库仅校验账号 active，无法防御伪造签名 → 全部管理接口与全租户数据被控 | 启动时强制要求 JWT_SECRET（缺失即拒绝启动），删除一切硬编码回退；现网立即轮换密钥（旧 token 全部失效，兼作吊销手段） |
| S-001-a | 高危 | C01-01 / C16-1 / C22-02 | backend/src/services/auth.ts:27 | `const JWT_SECRET = process.env.JWT_SECRET \|\| 'drama-mill-jwt-******'`（打码） | 回退密钥源头 | — |
| S-001-b | 高危 | C16-1 / C22-02 | backend/.env:1-13 | 全文仅 PORT/MYSQL_*/GEN_* 等 9 键，无 JWT_SECRET（未入库本地文件，gitignore 生效） | 默认密钥在本机/未显式配置的部署实际生效 | — |
| S-001-c | 高危 | C16-1 | backend/.env.example:1-68 | 模板全文无 JWT_SECRET 条目 | 照示例部署必然使用回退密钥 | — |
| S-001-d | 高危（原 C01-07/C16-6 低危，根因并入本簇） | C01-07 / C16-6 | .rescue-historical.sh:19（另 :17-20、:23） | 运维脚本用同一回退密钥自签 30 分钟 admin token 调 /admin/videos/rescue-historical；脚本未入库且被 deploy-remote.sh:44 排除同步 | 云端主机留存脚本与默认密钥同源；密钥缺失不中止 | 脚本改从环境变量强制取密钥，缺失即中止，用完删除 |
| S-001-e | 高危（原 C01-05 低危之 JWT 部分） | C16-1 / C01-05 | .env.example:17 | 根模板 JWT_SECRET 示例值与真实回退值完全一致 | 诱导"复制即用" | 模板改明显占位符（另见 S-029） |
| S-002 | 高危 | C01-02 / C14-3 / C21-04 / C22-01 | docker-compose.yml，多处见子项 | 入库编排文件明文写死全套默认凭证（DATABASE_URL/JWT_SECRET/MySQL root 与用户口令/healthcheck 命令行带 root 口令），且 MySQL 以 3307:3306、应用以 5679:5679 发布到宿主所有网卡；文件头注释仅提示"务必改"，无强制机制。定级说明：C14-3 原中危（条件=端口可达），取 C01-02/C21-04/C22-01 高危——compose 默认绑 0.0.0.0，公网主机上凭证公开+端口可达两条件在默认部署态即满足 | 按默认 compose 部署即同时具备：公网可连 MySQL（3307）+公开口令 → 直接拖库（含 bcrypt 哈希、AI apiKey 明文列）、改 role 提权；公开 JWT 密钥 → 伪造管理员（S-001）；5679 直连绕过 nginx TLS 与全部反代策略 | 凭证改 `${VAR:?err}` 强制外部注入、移除默认值；MySQL 端口绑 127.0.0.1 或不发布；应用仅经 nginx 暴露；healthcheck 用 MYSQL_PWD 或免密 socket |
| S-002-a | 高危 | C01-02 / C22-01 | docker-compose.yml:13 | `DATABASE_URL: mysql://dramamill:******@mysql:3306/drama_mill`（口令打码） | 连接串含公开默认口令 | — |
| S-002-b | 高危 | C01-02 / C22-01 / C16-1 | docker-compose.yml:14 | JWT_SECRET 与代码回退值完全一致（交叉引用 S-001） | 伪造 admin JWT 通道 | — |
| S-002-c | 高危 | C01-02 / C14-3 / C22-01 | docker-compose.yml:43 | `MYSQL_ROOT_PASSWORD: ******`（打码） | root 口令公开 | — |
| S-002-d | 高危 | C01-02 / C14-3 / C22-01 | docker-compose.yml:46 | `MYSQL_PASSWORD: ******`（打码，与源码回退值同） | 业务库口令公开 | — |
| S-002-e | 高危 | C01-02 / C14-3 / C22-01 | docker-compose.yml:57 | healthcheck `mysqladmin ping … -p******`（打码）命令行携带 root 口令 | docker inspect/进程列表可见 | — |
| S-002-f | 高危 | C01-02 / C14-3 / C21-04 | docker-compose.yml:40-41 | `"3307:3306"` 默认绑 0.0.0.0 | 云安全组放行 3307 时任何人用公开凭证直连数据库 | — |
| S-002-g | 中危（C21-04 应用端口部分原定级） | C21-04 | docker-compose.yml:8-9 | `"5679:5679"` 应用明文 HTTP 直接对外 | 绕过 nginx TLS/限速/日志（API 鉴权仍生效） | — |
| S-003 | 高危 | C02-01 / C16-3 / C22-02(种子) / C02-02 / C02-03 | 多处，见子项 | 启动自动播种管理员 `drama-mill` 与普通用户 `test`，共用与用户名同形的弱口令 `******`（打码，bcrypt cost10 落库）；护栏仅在"库内已有任意 admin"时跳过 admin 播种——全新部署必然创建默认口令管理员；README 公开口令、登录页常驻提示 test 口令。定级说明：C02-01 高危 vs C16-3 中危，取高危——新部署默认态即满足"公开口令直接登录管理后台"全部前提，证据链完整 | 任何未改密的新部署，攻击者用公开默认口令直接登录管理后台（跨租户读写、AI 配置、审计、改任意用户 role/密码）= 系统被控；test 账号经归属回填可能持有存量数据与 AI 配置 | 首启生成随机口令打印到受控部署日志/强制首登改密（must_change_password）；移除文档与登录页口令明文 |
| S-003-a | 高危 | C02-01 / C16-3 / C22-02 | backend/src/db/migrations-seed.ts:13-14（护栏 :41-44、:50；哈希 :51） | `{ username:'drama-mill', password:'******', role:'admin' }`、`{ username:'test', password:'******', role:'user' }`（打码） | 默认口令管理员必然播种 | — |
| S-003-b | 中危（原 C02-02/C16-3 定级） | C02-02 / C16-3 | README.md:223-230；README.en.md:225-230 | 公开 README 表格公布管理员默认账号与口令，并自述"管理员账号不在登录页提示、只在 README 记录" | "缩小爆破面"设计不成立——口令本身公开 | — |
| S-003-c | 中危（原 C02-03 定级） | C02-03 | frontend/app/pages/login.vue:59-64（核心 :62） | 登录页常驻提示 `test / ******`（打码） | 未改密部署可被直接登录 test | — |
| S-003-d | — | C02-03（放大证据） | backend/src/db/migrations-seed.ts:65-89 | 归属回填把历史无主数据（dramas/ai_service_configs/sys_task/novels 等）划归 test | test 账号可能持有存量资产与 AI 配置 | — |
| S-004 | 高危 | C12（交叉 C13） | backend/src/routes/upload.ts:37-50；backend/src/utils/storage-write.ts:46-47；nginx/drama-mill.common.conf:27-33；backend/src/utils/storage-core.ts:151-171 | POST /upload/image 无任何扩展名/MIME/魔数/大小校验，落盘保留用户原始扩展名（storage-write.ts:46 `path.extname(originalName)`），进入无鉴权 /static/uploads/ 分发面；生产 nginx alias 直连磁盘按默认 mime.types 以 text/html、image/svg+xml 渲染 .html/.svg → 同源存储型 XSS。**条件说明**：利用依赖 nginx 直连部署（wiki 记载的生产拓扑）；纯 Node 直连时 storage-core.ts:170 未知扩展回退 application/octet-stream 触发下载而非执行（缓解）。生产 nginx 主配置（mime.types include）不在仓库，**需人工确认云端未做自定义 types 覆盖** | 任意认证用户上传 payload.html/.svg（内含脚本）→ 响应直接返回可访问 URL（upload.ts:49）→ 受害者（含管理员）访问 → 同源执行脚本 → 窃取 localStorage['drama_mill_token']（7 天不可吊销 JWT，交叉 S-012/S-013）→ 账号接管。与 S-012 根因不同（上传校验缺失 vs 静态分发无鉴权），交叉引用不合并 | image 分支加扩展名白名单（png/jpg/webp/gif）+MIME+魔数（可复用 sharp metadata）+大小上限；落盘统一重命名安全扩展名；nginx 对 uploads 强制 `types {}`+default_type application/octet-stream 或 Content-Disposition: attachment + nosniff；接入存储配额 |
| S-005 | 高危 | C10 | backend/src/utils/storage-write.ts:21-37（危险点 :29）；backend/src/services/generation-poll.ts:107、121、158、210；backend/src/routes/aiConfigs.ts:87 | 全读型 SSRF：用户自配 AI 网关 baseUrl 完全可控（aiConfigs.ts:87 仅 provider 名过白名单，URL 零校验），上游返回的 imageUrl/videoUrl 被后端无条件 `fetch(url)` 下载落盘（无协议/内网地址/重定向校验），产物经无鉴权 /static/ 回读 | 攻击者注册普通账号 → 把自己控制的服务器设为 baseUrl → 提交生成任务 → 假网关轮询响应返回 `imageUrl=http://169.254.169.254/…` 或内网地址 → 后端抓取内网内容存为素材 → 经 /static/images/{uid}/{drama}/{uuid}.ext 无鉴权读取 → 内网数据（含云元数据凭证）外泄 | 下载 URL 协议白名单 + 解析后 IP 黑名单（环回/链路本地/私网/元数据，含 DNS 重绑定防护与重定向逐跳校验）；素材下载域与用户配置域解耦或加出网代理 |
| S-006 | 高危 | C15-1 | backend/src/routes/dramas-assets.ts:57-63、76-78（端点 :49、:68；归属校验 :52、:71） | PUT /dramas/:id/characters 与 PUT /dramas/:id/episodes 仅校验 URL 中 drama 归属，body 数组内每个带 id 的对象按任意 ID 直接 update，且 `{...char}`/`{...ep}` 全字段展开（mass-assignment，可覆盖 dramaId 转移归属） | 普通用户用自己的 drama_id 过归属校验，body 塞入受害者 character/episode 自增 ID（可枚举）→ 跨租户篡改剧本正文/标题/图片 URL，甚至改 dramaId 把受害者资产划入自己项目（窃取+破坏） | update 前逐条 getCharacterOwned/getEpisodeOwned；字段白名单过滤，禁止 dramaId 入 set |
| S-007 | 高危 | C15-2 | backend/src/routes/agent.ts:63-67、102-115；backend/src/routes/agent-async.ts:52-57、117-120、179-184、241-244；backend/src/agents/tools/script-tools.ts:36-49、80-95；backend/src/agents/tools/storyboard-tools-read.ts:29-33；backend/src/agents/tools/storyboard-tools-write.ts:83-93、187-188、241；backend/src/agents/tools/image-prompt-tools.ts:42-49、75-92、117-134、158-175 | Agent 链路只校验 drama_id 归属（agent.ts:67 仅 getDramaOwned），episode_id 既不校验归属也不校验属于该 drama；工具层按 requestContext/LLM 参数中的 ID 直读直写——正则 `getUserId\|userId\|user_id\|Owned` 在 agents/tools/ 全目录 0 命中（工具层零归属校验的直接证据）；agent.ts:110-115 响应回显 toolCalls/toolResults 把读到的他人正文直接返回攻击者；四个异步 run/retry 端点同模式 | POST /agent/script_rewriter/chat，body={自己的 drama_id, 受害者 episode_id} → 读取受害者剧本/小说正文（泄露）、改写或清空受害者剧本与分镜（storyboard-tools-write.ts:92 replace_existing 按 episodeId  delete）、篡改任意资产提示词（破坏+投毒） | 入口处 getEpisodeOwned 并校验 episode.dramaId===drama_id；工具层写操作前按 context userId 复核归属 |
| S-008 | 高危 | C15-3 | backend/src/routes/tasks.ts:77-78、95-125（另 :56-67）；backend/src/services/generation-poll.ts:191-206、223-228 | POST /tasks 归属校验两缺口：① 仅带 character_id/scene_id（不带 drama_id/storyboard_id）时零校验（:77-78 if/else-if 无 else）；② 带自己的 drama_id+受害者 storyboard_id 时只校验 drama，storyboard 不交叉校验；任务完成按 record 内 ID 直写（poll :199/:202/:205 覆盖 imageUrl，:196/:225-227 覆盖合成图/视频） | 攻击者提交 prompt+受害者资产 ID → 生成完成后受害者角色/场景/道具立绘、分镜首尾帧/视频被替换为攻击者内容（跨租户写+内容投毒）；并可借 resolveEpisodeOverrides 锁定受害者配置 | 所有资产 ID 逐一 Owned 校验；storyboard_id 必须属于已校验的 drama |
| S-009 | 高危 | C15-4 | backend/src/routes/characters.ts:142-157；backend/src/routes/scenes.ts:119-135；backend/src/routes/props.ts:149-159；backend/src/services/asset-images.ts:98-102、118-122、146-150、168-183（另 :114、:141-142） | 三个 batch-generate-images 端点只校验 episode 所属 drama（characters.ts:149、scenes.ts:127、props.ts:157），ids 数组未过滤归属；服务层逐 ID 直查直生成（:176-178），仅判存在（:99-102），生成任务 userId=受害者（dramaOwnerId），并把受害者资产置 processing（:141）；配置来源取决于攻击者自己的剧集：攻击者剧集**已锁定**配置时用的是攻击者自己的配置（`asset-images.ts:114/:142` 读的是攻击者传入并通过归属校验的 `ep` 的 imageConfigId），**未锁定且未传 `config_id`** 时才由 `generateImage` 按任务的 userId（即受害者）选配置（`generation-generate.ts:69-71`） | 用自己的 episode_id+受害者资产 ids → 覆盖受害者资产 imageUrl 与状态（跨租户写）；资源滥用程度取决于配置来源：攻击者剧集已锁定配置时烧的是该锁定配置所属账号的额度（配合 S-018/S-005-h 也可能指向他人配置），未锁定且未传 config_id 时才按受害者身份的 userId 选配置、消耗受害者 AI 配额/费用【勘误 7.1.1：配置来源与资源滥用描述已按 `安全修复确认清单-drama-mill-2026-11-19.md` 第 7 节修正，结论（跨租户写入加资源滥用）不变】 | ids 与 episode/drama 做归属交集过滤，越权 ID 直接拒绝 |
| S-010 | 疑似·高危 | C20-03 | backend/package-lock.json:4681-4683（声明 backend/package.json:39）；调用链 backend/src/routes/upload.ts:37-50；Dockerfile:8 | sharp 锁定 **0.34.5**：① GHSA-f88m-g3jw-g9cj（<0.35.0，继承 libvips CVE-2026-33327/33328/35590/35591，GIF/TIFF/VIPS 加载器堆溢出，官方 High 7.0，修复 0.35.0）；② CVE-2026-96889（预构建二进制内 librsvg UAF，sharp <0.35.5 受影响，修复 0.35.5/librsvg 2.63.2，glibc Linux 上经 SVG 可致 RCE）。/upload/image 无扩展名/体积限制即落盘并 generateImageThumb 交 sharp 解码；Docker 运行时为 glibc 的 node:20-slim。**疑似原因：版本区间判定，未实际投喂样本验证（禁止写文件/起服务）** | 任意注册用户上传恶意 GIF/TIFF/SVG 即触发原生解析漏洞，潜在 RCE | 升级 sharp ≥0.35.5；过渡期用 sharp.block 禁用 GIF/TIFF/VIPS 加载器并拒收 SVG |
| S-011 | 中危 | C01-03 / C01-04 / C01-06 / C22-02(DB) | 多处，见子项 | DB 默认回退凭证簇：未配置环境变量时主程序与运维脚本回退默认账号/口令（与 compose/README 公开值相同），且本机 backend/.env 的 MYSQL_PASSWORD 恰为该公开默认值——本机数据库实际使用公开口令 | 零配置启动即用公开凭证连库；与 S-002 叠加构成完整默认凭证链；若 3306/3307 对外暴露即可被直接登录。需数据库可达才可利用，故中危（C01-06 子项原低危：脚本已强制回环） | 缺配置时报错退出而非回退默认口令；本机更换强随机口令 |
| S-011-a | 中危 | C01-03 / C22-02 | backend/src/db/index.ts:41-42 | `process.env.MYSQL_USER \|\| 'dramamill'`；`process.env.MYSQL_PASSWORD \|\| '******'`（打码） | 回退源头 | — |
| S-011-b | 中危 | C01-04 / C22-02 | backend/.env:5-6 | `MYSQL_USER=dramamill`、`MYSQL_PASSWORD=******`（打码，公开默认值；未入库本地文件） | 本机库即用公开口令；配置卫生问题而非仓库泄露 | — |
| S-011-c | 低危（原子项定级） | C01-06 | backend/scripts/audit-storage-orphans.ts:54-55（对照 :50 强制回环） | 运维脚本同样回退默认账号/口令 | 仅本地运维场景 | — |
| S-012 | 中危 | C14-1 | backend/src/index.ts:120-154（注释 :118）；nginx/drama-mill.common.conf:27-33 | /static/* 全链路无鉴权（Node 自定义处理器+nginx alias 直出），覆盖 images/videos/merged/uploads 四分类全部租户素材与成片；index.ts:118 注释自认"不挂鉴权，否则 <img>/<video> 标签加载失败"。目录穿越已防护（storage-core.ts:100-111 逐段拒绝 `..`/`.`/空段）。与 S-004 交叉引用不合并（根因不同：分发面无鉴权 vs 上传无校验） | 文件名 uuid 不可枚举（缓解），但 URL 经 S-007/S-008 等跨租户读取端点（toolResults、image_url、video_url 字段）泄露给攻击者后，无需任何凭证直接下载他人素材与成片；nginx 层绕过 Node 一切审计；immutable 长缓存使链接泄露即永久可访问 | 改签名 URL（短时效 HMAC query）或 X-Accel-Redirect 内部重定向鉴权；至少对 uploads/ 分类加鉴权 |
| S-013 | 中危 | C16-2 / C06-02 / C16-5 | 多处，见子项 | 改密/登出后旧 token 在 7 天 TTL 内持续有效：每请求查库仅校验 status==='active'，无密码版本/token 版本/黑名单；logout 为空操作；token 存 localStorage。定级说明：不可吊销为中危主体（C16-2），localStorage 为低危子项（C06-02/C16-5——前端唯一 v-html 点已转义，未发现现行可利用 XSS，但 S-004 上传链成立后该子项风险被放大） | token 泄露（XSS/日志/共享设备）后受害者改密或登出无法止损，攻击者最长继续滥用 7 天；管理员禁用账号是唯一即时吊销手段；任何 XSS 可直接读走 localStorage 中 7 天有效 token | users 表加 token_version（改密/登出递增，middleware 比对）；或缩短 TTL+刷新令牌；前端改 HttpOnly cookie+CSRF 防护或至少配合吊销机制 |
| S-013-a | 中危 | C16-2 | backend/src/routes/auth.ts:66-67、84-86、128-129 | :67 注释自认"已签发 JWT 仍在新有效期内（无状态令牌无黑名单）"；change-password 仅更新 passwordHash；logout 空操作 | 改密/登出无法吊销 | — |
| S-013-b | 中危 | C16-2 | backend/src/middleware/auth.ts:46-49 | 每请求查库仅校验账号 active | 无 token 版本比对 | — |
| S-013-c | 中危 | C16-2 / C06-02 | backend/src/services/auth.ts:28 | `TOKEN_TTL = process.env.JWT_TTL \|\| '7d'` | 泄露窗口 7 天 | — |
| S-013-d | 低危（原子项定级） | C06-02 / C16-5 | frontend/app/composables/useAuth.ts:38、55、79；frontend/app/api/core.ts:21、25-26；frontend/app/plugins/auth.client.ts:28-35 | token 存 localStorage（键 drama_mill_token） | XSS 即可窃取（交叉 S-004） | — |
| S-014 | 中危 | C10 | backend/src/routes/aiConfigs.ts:110-132、145；backend/src/routes/ai-config-probe.ts:55-154（gemini 分支 :64）；backend/src/services/adapters/url.ts:34-49 | /ai-configs/test 连通性探测接受任意 base_url，服务端发起请求并回显响应体前 240 字符（:145 response_preview）与错误详情，构成带部分回显的 SSRF/内网端口扫描。已用无副作用 node 验证：model 参数注入 `../` 点段被 URL pathname 归一化（可穿越目录层级），但尾段固定拼接 `:generateContent`、`?`/`#` 被百分位编码——路径仅部分可控（已验证行为+受限结论） | 认证用户 POST /ai-configs/test，base_url 指向内网主机 → status/response_preview/error.message 回传，可探测内网服务并读取部分响应 | 探测目标加内网地址黑名单与协议校验；response_preview 仅对可信官方域回显；错误信息归一化 |
| S-015 | 中危 | C10 | backend/src/services/generation-refs.ts:64、42-44；backend/src/utils/storage-image.ts:85；backend/src/routes/tasks.ts:115；backend/src/routes/characters.ts:36 | 用户可控参考图 URL 触发服务端下载（storage-image.ts:85 fetch，仅图片内容可解析），结果 base64 随生成请求发往攻击者自配上游网关，形成"内网图片内容读取+回传"闭环；入口：POST /tasks 的 reference_image_urls（tasks.ts:115）、PUT /characters 的 imageUrl（:36 EDITABLE_FIELDS） | 参考图 URL 填内网图片服务地址 → 后端 fetch+sharp 压缩 → dataURL 发给攻击者控制的 baseUrl → 攻击者在自己服务器收到内网图片内容。受 sharp 解码限制仅图像类响应可利用，故中危 | 同 S-005 的出网 URL 校验；参考图下载与上游提交共用同一套地址白名单 |
| S-016 | 中危 | C08（交叉 C11） | backend/src/services/ffmpeg-merge.ts:152-154、179、70；backend/src/routes/storyboards.ts:146、149-152、162；backend/src/utils/storage-core.ts:84-94（:85 绝对路径透传） | 用户可写 storyboard.video_url 为任意路径（PUT 字段映射 :146，:162 直接落库），拼接时未经约束直接作为 ffmpeg 输入（:179 `-f concat -safe 0`），可读取服务器任意已存在文件（含其他租户视频）混入攻击者成片；concat 清单 `file '${toAbsPath(v)}'` 单引号未转义（:152-154）。spawn 为参数数组无 shell（utils/ffmpeg.ts:88/:116），无 shell 注入。**疑似子项**：引号/换行注入 concat 指令需存在含特殊字符的文件名——:70 existsSync 预检要求整串对应真实文件，应用上传均 uuid 命名无法造出，缺"可创建含引号/换行文件名"证据，需人工确认其他落盘链路 | 认证用户 PUT /storyboards/:id 把自己镜头 video_url 改为他人视频路径或任意绝对路径 → POST /merge → ffprobe/ffmpeg 读取该文件 → 成片落到攻击者 merged 目录可下载。跨租户读取需知目标 uuid 路径，条件利用，故中危 | video_url 更新时校验必须为 static/ 前缀且落在本租户目录；concat 清单按 ffmpeg 规范转义 `'` 与换行；getAbsolutePath 增加根目录约束 |
| S-017 | 中危 | C11 | backend/src/utils/storage-core.ts:84-94（:90 path.join 归一化穿越）；backend/src/services/generation-refs.ts:31-39、62；backend/src/routes/tasks.ts:104 | 参考图"本地路径"读取无目录约束、无归属校验：static/ 前缀后可跟 `..` 穿越分类根，也可直接指向其他租户素材路径；对比 resolveStaticFile（:103）有段校验而此读取链路没有；读出的图片 base64 发往用户自配上游（结合 S-015 形成跨租户图片窃取） | POST /tasks reference_images=["static/images/{他人uid}/{drama}/{file}.png"] 或含 `../` 路径 → sharp 读取 → base64 发往攻击者 baseUrl → 跨租户/跨目录图片外泄。受 sharp 解码限制仅图像文件可读（/etc/passwd 等会失败），故中危 | 本地参考图读取复用 resolveStaticFile 段校验并强制约束本租户目录；禁止 `..` 与绝对路径 |
| S-018 | 中危 | C15-5 | backend/src/services/ai.ts:207-236；backend/src/services/generation-generate.ts:69-71、108-110；backend/src/agents/model-factory.ts:163；backend/src/routes/episodes.ts:91-92；backend/src/services/asset-images.ts:114、142 | getConfigById 按任意 ID 取 AI 配置（含 apiKey/baseUrl）无归属校验（ai.ts:208-209 仅按 id 查询）；用户可控入口：body.config_id/text_config_id（生成、agent）、创建集时 image_config_id/video_config_id 可锁定他人配置（episodes.ts:91-92 直接落库）。对照：aiConfigs.ts:170-171 generate-test 有归属校验（该端点无问题） | 枚举 config_id → 用受害者 apiKey 发起生成（配额盗用、费用转嫁）；密钥不回显明文（诊断接口掩码，tasks-shared.ts:52），故中危 | getConfigById 增加 userId 归属参数；集锁定配置时校验配置属于本人 |
| S-019 | 中危 | C15-6 | backend/src/routes/characters.ts:102-106、128-129；backend/src/routes/scenes.ts:145-146；backend/src/routes/props.ts:112-113 | generate-prompt/generate-image 的 body.episode_id 直查 episodes 仅判存在，不校验归属、不校验与资产同剧；characters.ts:128-129 查 ep 后读取该集剧本上下文生成提示词 | 用自己的 character+受害者 episode_id → 受害者剧情上下文被提炼进返回的 final_prompt（间接内容泄露）；generate-image 路径同时触发 S-018 配置盗用 | episode_id 走 getEpisodeOwned 并校验与资产同 drama |
| S-020 | 中危 | C19-01 | backend/src/utils/task-logger.ts:84-85（掩码名单）；backend/src/services/generation.ts:209；backend/src/services/adapters/gemini-image.ts:60、84、138 | Gemini 生图以 `x-goog-api-key` 头携带 API Key；generation.ts:209 logTaskPayload 打印完整请求 headers，而 MASKED_HINTS=['authorization','token','apikey','api_key'] 不匹配带连字符的 x-goog-api-key，Key 短于截断阈值 → **Gemini API Key 明文落入 logs/app-out.log**。链路已核实（registry 注册→buildImageRequest→generation.ts:200-209）；URL 中 `?key=` 会被 redactUrl（:73-81）打码，但头通道绕过；同型头 x-api-key 也不在名单（当前未使用，同根因） | 日志采集/共享/排障截图即泄露用户第三方 Key，可被盗刷额度。需接触日志才可利用，故中危 | 掩码规则改"头名含 api 且含 key（忽略分隔符）即打码"，或 headers 全量默认打码仅放行白名单 |
| S-021 | 中危 | C22-03 | nginx/drama-mill.common.conf（全文 60 行）；nginx/drama-mill.conf（全文 39 行）；backend/src/index.ts:68-114；backend/src/utils/rate-config.ts:19-103 | 全链路无 HTTP 限流：nginx 两文件无 limit_req/limit_conn；Hono 侧 bodyLimit/rateLimit/throttle 0 命中；rate-config.ts 实读确认仅为上游 AI 调用并发槽位/节奏闸门（TPM/QPM 适配），**不是 HTTP 限流**；登录端点免鉴权（middleware/auth.ts:26）且无失败次数限制 | 口令爆破（叠加 S-003 默认口令、S-031 弱密码策略）、接口滥用/DoS 无闸门 | nginx 对 /api/v1/auth/login 加 limit_req；后端加登录失败计数与限速 |
| S-022 | 中危 | C22-04 | backend/src/middleware/logger.ts:63-73；backend/src/index.ts:75（挂载顺序）；nginx/drama-mill.common.conf:4；backend/src/routes/upload.ts:37-50、115-118 | 后端无 body 大小限制；requestLogger 在鉴权之前对每个 POST/PUT/PATCH `c.req.raw.clone()` 后 `await clone.text()` 全量读入内存（再截断 500 字符打印）；nginx 上限 100m；/upload/image 无体积上限，video/audio/doc 也是 arrayBuffer() 全量入内存后才判大小（:115-118） | 未鉴权者向任意路径（如 login）发 100MB body 即被完整缓冲（日志克隆+下游解析双份）→ 内存放大 DoS，PM2 fork 单进程尤其脆弱（叠加 S-049 无内存兜底） | 挂 hono bodyLimit；日志中间件跳过 multipart/大 Content-Length；上传先判 size 再缓冲 |
| S-023 | 中危 | C22-05 | Dockerfile:8、20、45、63（全文无 USER 指令）；backend/package-lock.json:1669-1671；deployment/deploy.sh:63 | 三阶段均 node:20-slim：Node 20 已于 2026-04 EOL，2026-10 Node 官方安全发布（含 CVE-2026-111497 Brotli RCE 等 10 项）仅覆盖 22/24/26 线，容器运行时不再获补丁；@mastra/core engines 声明 node>=22.13.0（lock 实读），deploy.sh:63 脚本部署强制 22+——**Docker 路径与依赖引擎要求直接冲突**；CMD 以 root 运行 tsx | 运行时无安全补丁 + 容器 root 运行放大任何 RCE（如 S-010）后果；镜像构建路径可能运行期失败 | 基础镜像升 node:22-slim（或 24）并加非 root USER |
| S-024 | 疑似·中危（条件性） | C15-7 | backend/src/services/ownership.ts:94-103（:101-102）；backend/src/routes/tasks-shared.ts:19-25（:22-23）；backend/src/routes/tasks.ts:207-213（受影响端点 :144-149、:154-157、:265-268、:279-283）；backend/src/routes/tasks-cloud-queue.ts:37-43 | 双 NULL 历史数据放行：getNovelOwned/getTaskOwned 在 userId 与 dramaId 均空时零校验返回；任务列表 legacyCond 放行 `dramaId IS NULL AND userId IS NULL` 行。**缓解证据**：migrations-seed.ts:65-77、80-89 启动时把存量 NULL 行回填给 test → 迁移正常跑过的库预期无暴露行。**缺证据/需人工查库**（只读铁律禁止连库）：`SELECT COUNT(*) FROM novels WHERE user_id IS NULL AND drama_id IS NULL;` 与 `SELECT COUNT(*) FROM sys_task WHERE user_id IS NULL AND drama_id IS NULL;`（及 video_merges/assets 同查） | 若计数 >0 升级为实际中危：任意用户可读/重试/删除这些任务与小说；若为 0 仅剩代码层隐患（新写入路径是否产生双 NULL 行需结合 S-008 修复复核） | 删除放行分支，双 NULL 一律 404（历史数据已回填，无兼容必要） |
| S-025 | 疑似·中危（实际暴露面低） | C20-01 | backend/package-lock.json:3512-3514（声明 backend/package.json:34）；backend/src/index.ts:166-168 | hono 锁定 **4.12.9**，落在 CVE-2026-111757 / CVE-2026-109955（GHSA-5r4p-p66f-jhc7，受影响 >=4.12.4 <4.13.11，修复 4.13.11）区间；亦低于 CVE-2026-39407 修复版 4.12.12、CVE-2026-54286 修复版 4.12.25（后者仅 Windows）。serveStatic 二次解码可绕过路径前缀中间件读静态根内"受保护"文件；**本应用 serveStatic 只服务公开 SPA 产物（index.ts:166-168），无受保护前缀，公告明确"仅服务公开文件的应用不受影响"**。疑似原因：版本区间判定 | 实际可利用性低（暴露面核实缓解） | 升级 hono ≥4.13.11 |
| S-026 | 疑似·中危（实际暴露面低） | C20-02 | backend/package-lock.json:1127-1129（声明 backend/package.json:26） | @hono/node-server 锁定 **1.19.11**，落在 GHSA-rmxm-3fg6-px4f（>=1.19.10 <2.1.3，**1.x 无修复版**）及 CVE-2026-39406（修复 1.19.13）区间；index.ts:26 实际 import 该适配器的 serveStatic。疑似原因：版本区间判定 | 同 S-025（serveStatic 面），实际暴露面低；仅升 hono 核心不修复此适配器问题 | 升级适配器 ≥2.1.3（要求 Node≥20） |
| S-027 | 疑似·中危 | C20-04 | backend/package-lock.json:2719-2721（声明 backend/package.json:30） | drizzle-orm 锁定 **0.45.1** <0.45.2，落在 CVE-2026-39356（GHSA-gpj5-g38j-94v9，escapeName() 标识符转义不当致 SQL 注入）区间。风险前提：以用户输入动态构造表/列标识符；本应用查询均用固定 schema 列与参数化占位（抽样所见）。**需人工确认是否存在动态标识符拼接**（migrations*.ts 原生 SQL 不在本项逐行核对范围）。疑似原因：版本区间判定+前提未完全排除 | 若存在动态标识符拼接则可 SQL 注入 | 升级 ≥0.45.2 |
| S-028 | 疑似·中危（条件：dev server 暴露不可信网络） | C20-07 | frontend/package-lock.json:9303-9305（vite 为 nuxt 传递依赖，frontend/package.json 未直接声明；package.json:11 为 nuxt dev 脚本行） | vite 锁定 **7.3.1** <7.3.2，落在 CVE-2026-39363（GHSA-p9ff-h696-f583，无 Origin 头连 WebSocket 经 fetchModule 任意文件读，修复 6.4.2/7.3.2/8.0.5）与 CVE-2026-39364（server.fs.deny 绕过，修复 7.3.2/8.0.5）区间；2026-09 有针对该缺陷的在野凭据 harvesting 活动报道。仅影响 `nuxt dev`（端口 3013），生产静态产物不含 vite。疑似原因：版本区间判定 | 开发者 dev server 暴露不可信网络时可被任意文件读/凭据窃取 | 升级 vite ≥7.3.2；dev 不绑 0.0.0.0 |
| S-029 | 低危 | C01-05 | .env.example:8、12；backend/.env.example:9-10（JWT 部分已并入 S-001-e） | 入库模板示例值与代码真实回退值完全一致（连接串、MYSQL_PASSWORD），诱导"复制即用"形成默认凭证部署 | 放大 S-001/S-002/S-011 落地概率 | 模板用明显占位符（如 CHANGE_ME_REQUIRED）并注释"必须修改" |
| S-030 | 低危 | C01-10 | README.md:155、213；README.en.md:155、213 | 公开文档明示默认数据库回退凭证（`dramamill / ******`，打码）及含口令的连接串示例 | 信息公开配合 S-011 降低攻击成本 | 文档只留占位符 |
| S-031 | 低危 | C02-04 | backend/src/routes/admin/users.ts:71、115（对照 backend/src/routes/auth.ts:35） | 管理员建号/重置密码最小长度仅 4 位（用户自助改密为 6 位） | 弱口令策略，配合无登录失败限速（auth.ts:38-58 未见限流，另见 S-021）增大爆破面 | 统一 ≥8 位并加复杂度/限速 |
| S-032 | 低危 | C06-01 | backend/src/index.ts:71-74 | 开发期 CORS 白名单硬编码（仅 http://localhost:3013/5679，非 `*`）且生产同样生效，credentials:true 在无 Cookie 鉴权下无必要 | 本机恶意/被控 localhost 应用可发起带凭证跨域请求（实际无 cookie 可带，危害有限）；配置卫生 | 按 NODE_ENV 区分，生产关闭或收敛 CORS，去掉 credentials |
| S-033 | 低危 | C06-03 / C22-07 | nginx/drama-mill.conf:27-39（TLS :35-36）；nginx/drama-mill.common.conf:57-59 | 未配置 HSTS 及 X-Content-Type-Options 等安全响应头；TLS 仅 `ssl_ciphers HIGH:!aNULL:!MD5`（宽泛套件含 CBC 旧套件）；proxy_send/read_timeout 300s 为长任务业务所需（明确记录非误配），但放大慢速连接占用面且无 limit_conn 对冲 | 首次访问/降级场景可被 SSL-strip；纵深防御缺失（nosniff 缺失同时放大 S-004） | 确认全站 HTTPS 后加 Strict-Transport-Security 与基础安全头；收紧套件 |
| S-034 | 低危 | C06-04 | backend/src/middleware/audit.ts:75；nginx/drama-mill.common.conf:47 | 审计 IP 取 X-Forwarded-For 首段，而 nginx 用 $proxy_add_x_forwarded_for（追加而非覆盖），客户端可自带 XFF 首段伪造来源 IP | 审计日志溯源可被投毒，影响事后追责（非越权） | nginx 覆盖式设置 XFF，或后端取"倒数第 N 段可信代理"策略 |
| S-035 | 低危 | C19-02 | frontend/app/api/core.ts:50 | 生产构建无 dev 守卫，每次 API 请求 console.log 打印完整请求 body，含 /auth/login 的 password、/auth/change-password 三个口令字段、/ai-configs 的 api_key | 浏览器控制台明文凭证，可被恶意扩展/共享屏幕/前端日志采集读取；后端侧 maskSecrets 实现正确（logger.ts:43-50），前端侧缺失 | 生产移除或复用字段脱敏后再打印 |
| S-036 | 低危 | C19-03 / C21-02 | 多处，见子项 | 全局 onError 与各路由 catch 把原始 err.message 直接返回前端；堆栈只进控制台不回传（logger.ts:94-95，正确），但 mysql2 错误 message 可含 SQL 片段/重复键值（Duplicate entry '…' for key '…'），上游错误体可能含内部信息 | 触发数据库异常即可枚举表/键/部分数据值，条件性信息泄露；多数业务错误为受控中文文案，实际暴露面有限 | 对非业务异常（无自定义 status 的 Error）统一回通用文案，细节仅落日志 |
| S-036-a | 低危 | C19-03 / C21-02 | backend/src/middleware/logger.ts:92-96（核心 :96） | `return c.json({ code: status, message: err?.message \|\| 'Internal Server Error' }, status)` | 全局兜底直返 | — |
| S-036-b | 低危 | C19-03 | backend/src/routes/tasks.ts:133、274 | catch 直回 err.message | — | — |
| S-036-c | 低危 | C19-03 | backend/src/routes/characters.ts:116；backend/src/routes/scenes.ts:114；backend/src/routes/props.ts:144 | catch 直回 err.message | — | — |
| S-036-d | 低危 | C19-03 | backend/src/routes/merge.ts:70；backend/src/routes/episodes.ts:96 | catch 直回 err.message | — | — |
| S-036-e | 低危 | C19-03 / C21-02 | backend/src/routes/agent.ts:116-120 | agent chat 捕获异常外返 err.message（脱敏缺失另见 S-037） | — | — |
| S-036-f | 低危 | C19-03 | backend/src/routes/aiConfigs.ts:160 | catch 直回 err.message | — | — |
| S-036-g | 低危 | C19-03 | backend/src/routes/admin/videos.ts:56、95 | catch 直回 err.message（admin-only，暴露面窄） | — | — |
| S-037 | 低危（部分疑似） | C19-04 | backend/src/routes/agent.ts:118-120（对照 backend/src/routes/aiConfigs.ts:180-182；backend/src/services/failure-detail-parse.ts:66-72） | Agent 聊天失败时 logTaskError({error: err.message}) 与 badRequest(c, err.message) 均未过 failure-detail 的 redact（对照 aiConfigs 走 describeFailure 有脱敏，会抹 Bearer/sk-/key= 等）；error 字段不在任何掩码名单。**疑似部分：是否真实泄露取决于上游是否在错误体回显凭证，无法只读复现验证；需人工用测试 Key 触发一次上游 401 观察错误体**。日志侧风险确定存在 | AI SDK 错误消息可能携带上游回显的 Key，落日志并直返前端 | 统一走 describeFailure/redact 后再记录与返回 |
| S-038 | 低危 | C14-2 / C21-03 | nginx/drama-mill.common.conf:36-40；deployment/disk-monitor.sh:57-71 | /disk_status 无鉴权直出 JSON（nginx 注释自认"无需鉴权"），内容含 hostname、挂载点、磁盘总量/已用/剩余、告警消息（disk-monitor.sh 写入） | 主机名与容量信息泄露，辅助攻击者画像与容量耗尽攻击时机选择 | 移入 /api/v1/admin 鉴权路径或加内网 allow/deny |
| S-039 | 低危 | C14-4 | backend/src/index.ts:188；ecosystem.config.cjs:13（compose 5679 映射已并入 S-002-g） | serve({fetch, port}) 未指定 hostname，@hono/node-server 默认绑定全部接口 | 绕过 nginx 直连 Node（API 鉴权仍生效，但 /static 无鉴权面同样暴露，失去 nginx 层限速/日志）；纵深防御 | 生产绑定 127.0.0.1，仅经 nginx 对外 |
| S-040 | 低危 | C01-08 / C14-5 / C22-08 / Jack问题9(C08×C07) | 多处，见子项 | 运维脚本 mysql 口令命令行传入（进程列表可见）+ fix-tenant 位置参数先内插守卫 SQL 后做数字校验（先用后验）；输入来自执行脚本的运维人员本人（持 root DB 口令），非外部攻击面，故低危 | 同机用户可在脚本运行期间从 ps 读到 DB 口令；恶意/失误参数可注入守卫查询 SQL 或 shell 词法 | 改用 MYSQL_PWD 环境变量或 --defaults-extra-file；数字校验前置到拼接之前 |
| S-040-a | 低危 | C01-08 / C14-5 / C22-08 | deployment/fix-tenant-attribution.sh:30-32（核心 :32） | `MYSQL="mysql -h127.0.0.1 -u${DB_USER:-dramamill} -p$PASS drama_mill -N -B"`（口令打码略） | 命令行传口令，入库脚本 | — |
| S-040-b | 低危 | Jack问题9 / C22-08 | deployment/fix-tenant-attribution.sh:40（对照校验 :42-43） | 守卫查询 `${DRAMA_FILTER:+ AND drama_id = $DRAMA_FILTER}` 在数字 case 校验之前内插 | 先用后验，本地注入面 | — |
| S-040-c | 低危 | C01-07 / C22-08 | .rescue-historical.sh:14 | `mysql -p"$PASS"` 命令行传口令（未入库脚本） | 同机 ps 可见 | — |
| S-041 | 低危 | C16-4 | backend/src/services/auth.ts:54-56、61；backend/package.json:35 | sign/verify 均未显式固定 algorithm:'HS256'/algorithms:['HS256']；jsonwebtoken ^9.0.3（lock:3772-3774 实读）在字符串密钥下默认仅接受 HS256/384/512、拒绝 none 与非对称算法，**无实际算法混淆漏洞**，属纵深防御 | 依赖库默认行为兜底，未来换库/配置变更即可能破防 | verify 显式 algorithms:['HS256'] |
| S-042 | 低危 | Jack问题7(C11) | backend/src/routes/skills.ts:38、56-71、102-108（对照 :78-81 仅 POST 有校验、:31 adminGuard）；backend/src/agents/skills.ts:81、90 | GET/PUT/DELETE 通配路由从 URL 截出的技能 id 未做段校验（可含 `../`），越狱与否完全依赖第三方 Mastra LocalFilesystem containment。**依赖证据（范围外只读）**：backend/node_modules/@mastra/core/dist/chunk-ABA3KD3X.js:869 `this._contained = options.contained ?? true`、:899-907 resolvePath 对 basePath 外路径抛 PermissionError，本项目未传 contained:false → 当前越狱被依赖拦截 | 整层 adminGuard 且 jail 有效，现阶段不可越狱；但安全边界寄托于依赖默认值，升级/配置变更即可能破防；jail 内仍可任意写（如覆写 prompts/*.md，交叉 S-055） | 路由层对 id 逐段套用 POST 已有的 SKILL_ID_SEGMENT 正则，纵深防御 |
| S-043 | 低危 | Jack问题8(C07) | backend/scripts/export-init-sql.ts:38-48（核心 :44；对照 backend/scripts/export-catalog-sql.ts:50 已正确用 mysql.escape） | inlineParams 将种子参数内联为 SQL 字面量时仅双写单引号，未转义反斜杠；MySQL 默认模式下以 `\` 结尾的值可逃逸闭合引号。当前种子源经正则核验不含反斜杠，docker/init.sql 实测亦无，现阶段不可利用；数据流为静态种子→导出文件→DBA/容器 initdb 执行，无外部运行时输入 | 潜在缺陷：未来种子含反斜杠即破坏导出 SQL 甚至注入 | 改用 mysql.escape 或同时转义反斜杠 |
| S-044 | 低危 | Jack问题10(C12) | backend/src/routes/upload.ts:37-50（image 无大小/配额）、110-114（核心 :111-112）；nginx/drama-mill.common.conf:4 | image 分支无体积上限（仅 nginx client_max_body_size 100m 兜底）且不查存储配额；video/audio 的 MIME 校验在 type 为空或 application/octet-stream 时被跳过（扩展名白名单仍生效，无魔数校验） | 认证用户可批量上传大文件耗磁盘（配额只在生成链路检查，叠加 S-022）；伪造扩展名+octet-stream 可上传与声明类型不符的媒体内容；纵深防御级 | image 分支补大小上限与配额断言；媒体上传加魔数探测 |
| S-045 | 低危 | C15-8 | backend/src/routes/characters.ts:58-63 | POST /characters 的 body.episode_id 未校验归属，可把自建角色挂到任意他人剧集（episodeCharacters 关联表写入） | 污染受害者剧集角色列表/提取结果，跨租户弱写入 | episode_id 走 getEpisodeOwned |
| S-046 | 低危 | C15-9 | backend/src/routes/agent-async.ts:53-57、118-120、180-184、242-244（对照 :105、:229 status 端点有 getEpisodeOwned，合规） | breakerRuns/rewriterRuns 为全局 Map 按 episodeId 键控，run/retry 只校验 drama 归属（见 S-007），可探测/重置他人运行态（already_running 探测、retry 改写他人失败状态） | 跨租户运行态干扰/探测 | Map 键加 userId 或入口校验 episode 归属（随 S-007 一并修复） |
| S-047 | 低危 | C21-01 | backend/src/routes/agent.ts:125-129 | 生产保留 GET /api/v1/agent/:type/debug，仅校验 type 在册并返回 {agent_type, valid:true}；已核实位于 authMiddleware 之后，无敏感数据返回 | 调试端点遗留，扩展时易演变为信息泄露 | 移除或限 admin |
| S-048 | 低危（信息项） | C21-05 | backend/.gen-smoke.mts:1-4 | 开发冒烟脚本遗留仓库（import generation.js 会连带触发 DB 初始化副作用），非 HTTP 端点、不对外 | 误执行副作用；发布目录卫生 | 移出发布目录或删除 |
| S-049 | 低危 | C22-06 | ecosystem.config.cjs:11-27 | PM2 有 autorestart/max_restarts=10/restart_delay，但无 max_memory_restart；fork 单实例承载内存队列+全量 body 日志（S-022） | 内存泄漏/大包冲击无兜底 | 设置 max_memory_restart（如 1G） |
| S-050 | 低危（流程缺陷确定；是否拉到投毒版本为疑似） | C22-09 / C20-11(残余风险) | 多处，见子项 | npm ci 失败即 `rm -rf node_modules && npm install` 重新解析依赖（保留 lock 但 npm install 可改写解析结果）+ @mastra/core 用 ^1.17.0 宽区间。**供应链背景（C20-11，已核实当前未感染）**：2026-06-17 @mastra 全 scope 被休眠维护者账号投毒重发（注入 easy-day-js@1.11.22 postinstall 投递加密钱包窃取器+RAT，SNYK-JS-EASYDAYJS-17353313，事件版本如 @mastra/core@1.42.1）；核实：两份 lock 均无 easy-day-js（grep 0 命中）、@mastra/core 锁定 1.17.0 为事件前版本、依赖清单无异常注入、schema-compat 1.2.7 低于攻击者抬高的 1.2.12——**当前锁定树干净**；另核实 CVE-2026-120474（undici）不适用（两份 lock 均无 undici） | 若在投毒窗口重解析可能拉到恶意版本；npmmirror 镜像同步链放大窗口不确定性 | ci 失败即中止告警人工介入；钉死 mastra 版本；CI 强制 npm ci；ignore-scripts 默认开启（ffmpeg-static 例外白名单已有 pnpm.onlyBuiltDependencies 先例） |
| S-050-a | 低危 | C22-09 / C20-11 | deployment/deploy.sh:51-55 | npm ci 失败回退 `rm -rf node_modules && npm install` | 重解析窗口 | — |
| S-050-b | 低危 | C20-11 | backend/package.json:27 | `"@mastra/core": "^1.17.0"` 宽区间 | 重解析可越过事件前版本 | — |
| S-050-c | 低危 | C20-11 | Dockerfile:10、47；deployment/deploy.sh:76 | 走 npmmirror 镜像同步链 | 镜像同步滞后/差异不确定性 | — |
| S-050-d | —（核实证据） | C20-11 | backend/package-lock.json:1634-1637、1639-1667、1787-1788 | @mastra/core 1.17.0 锁定+依赖清单干净；@mastra/schema-compat 1.2.7 | 当前未感染结论的实读证据 | — |
| S-051 | 低危（信息项） | C22-10 | deployment/disk-monitor.sh:91-93 | webhook 推送将 $MSG（含 df/du 输出与告警文本）未做 JSON 转义直接拼入 curl -d 的 JSON 串，特殊字符可破坏报文结构；输入源为本机命令输出，注入面极小 | 报文结构破坏/告警丢失 | 用 jq 构造 JSON |
| S-052 | 低危（信息性例外清单） | C04 | backend/src/index.ts:72；backend/src/services/generation-refs.ts:64、135；README.md:294、376；README.en.md:376；其余见描述 | http:// 明文地址全量命中均为低危例外/信息性：CORS 开发白名单（index.ts:72，另见 S-032）；generation-refs.ts:64/135 为协议判断分支，允许用户提供的 http:// 参考素材直通上游（明文传输风险取决于用户输入，提示性）；README.md:294 允许无域名时纯 HTTP 运行（部署选择，提示生产应强制 HTTPS）；README:376 指导以 http://host.docker.internal:11434 连 Ollama（局域网明文）；其余命中为回环健康检查/代理（regen-missing-assets.ts:31、drama-mill-services.sh:23、drama-mill-boot-check.sh:28、deploy.sh:149-152、common.conf:43、compose:29、nuxt.config.ts:68-69、.rescue-historical.sh:23）、文档 localhost 示例（README 两版 :192/:193/:206/:314/:372）、LICENSE 样板 URL（:4/:229/:235）。适配器 baseUrl 无硬编码 http 默认值；backend/src 内 https 硬编码仅 cloud-tasks-fetch.ts:43/147（dashscope 官方，合规）；nginx 80→443 全量跳转已做（drama-mill.conf:22-24） | 回环/文档示例无实际风险；用户自配 http 上游与纯 HTTP 部署选择存在明文传输面 | 生产强制 HTTPS；文档提示 http 上游的明文风险 |
| S-053 | 疑似·低危倾向 | C01-09（C16-6 描述已修正） | .dbpass.tmp:1（未入库，25 字节）；backend/scripts/audit-storage-orphans.ts:159；deployment/deploy-remote.sh:44 | 根目录残留 24 位十六进制字符串+换行（共 25 字节），形态似随机口令（`d994****************cf30`，打码）。全仓搜索无任何运行时代码读取它（仅 audit-storage-orphans.ts:159 列为运维文件、deploy-remote.sh:44 排除同步）。**汇总裁决**：实读确认 25 字节非空——Alex C01-09 正确；Tina C16-6 "0 字节空文件"说法错误，已修正（见 4.3）。**缺证据**：无法从代码确认它是哪个系统的口令、是否仍有效；需人工确认是否为云端 MySQL 真实口令的历史残留 | 若为有效口令，任何拿到工作区副本（备份/误提交/误同步）的人可直接用；当前 gitignore（.gitignore:14/:67）与 rsync 排除均生效，未见入库路径 | 人工确认归属；若为真实口令应轮换并删除该文件 |
| S-054 | 疑似·低危倾向 | C19-05 | backend/src/middleware/audit.ts:30-43（核心 :34-37） | redactDetail 仅遍历 JSON 顶层键做脱敏，嵌套对象内敏感字段不会被打码。**缺证据**：已核对当前接受凭证的路由（aiConfigs POST/PUT 顶层 api_key、admin/users 顶层 password、auth 顶层口令字段）均为扁平结构，未发现现行嵌套凭证实例；属未来接口演进时的防御缺口，需人工确认后续新增接口是否保持扁平 | 未来嵌套凭证接口将明文入审计库 | 改为递归脱敏 |
| S-055 | 疑似·低危 | Jack疑似项(C09) | 依赖证据（范围外只读）：backend/node_modules/@mastra/core/dist/chunk-ABA3KD3X.js:8336-8360、8365-8375；backend/src/agents/skills.ts:81、90 | 带 workspace 的 Agent 被 Mastra 注入文件读写工具（无 sandbox 故无 executeCommand 工具，:8365-8375 已核验），小说原文/用户输入中的间接提示词注入可能诱导 LLM 在 backend/workspace jail 内改写 SKILL.md/prompts 实现持久化行为操纵。**缺证据**：真实模型在注入载荷下的行为复现需运行期测试（超出只读边界）；本质属"Agent 提示词注入"审查项（wiki 附录 B.10），建议移交对应负责人。除此之外全库无 eval/new Function/yaml.load/JSON.parse 后执行（backend/tests/merge-cleanup.test.mjs:16 的 vm.runInNewContext 仅测试 harness 执行仓库自身转译代码，输入非外部可控，不计问题） | jail 内持久化提示词/技能篡改 → 后续所有 Agent 会话行为被操纵（越狱被 containment 拦截，见 S-042）；**威胁模型偏窄（勘误 7.1.3）**：除小说原文中的间接注入外，普通用户可直接控制对话 `message`（`backend/src/routes/agent.ts:88-91` 原样送入 Agent），这条路径更短、无需间接载体，故本项定级偏低（报告 B 记为疑似·高危，先加固再验证，见安全修复确认清单 2.4、F-19）【勘误 7.1.3：补充直接输入攻击路径，见安全修复确认清单第 7 节】 | 对 workspace 写入加人工审核/只读挂载；提示词与用户内容隔离；运行期红队测试验证 |
| S-056 | 疑似·低危（部署形态规避主要前提） | C20-05 | frontend/package-lock.json:6890-6892（声明 frontend/package.json:20） | nuxt 锁定 **3.21.2**，落在：CVE-2026-53721（3.11.0–<3.21.7，routeRules 鉴权绕过）、CVE-2026-56698/GHSA-h345-75vh-jjwf（<3.21.7，navigateTo open 选项 script URL）、GHSA-hxvh-4h3w-prp9（53721 修复回归，修复 3.21.10）及 2026-07 server islands 系列（GHSA-9473-5f9j-94wq 等，修复 3.21.10）区间。**缓解核实**：nuxt.config.ts 无 routeRules/appMiddleware；frontend/app 内 navigateTo 25 处逐一为站内跳转、无 open 外部 URL；生产走 nuxt generate 静态产物（Dockerfile:17、deploy.sh:86），无 Nitro 运行时/islands 端点。疑似原因：版本区间判定 | 版本在区间内但各公告前提基本不成立 | 升级 ≥3.21.10 消除告警面 |
| S-057 | 疑似·低危 | C20-06 | frontend/package-lock.json:1256-1258；frontend/nuxt.config.ts:28 | @nuxt/devtools 锁定 **3.2.4** <3.3.1，落在 GHSA-279x-mwfv-vcqv（Critical，**仅 dev**：Vite HMR socket 未鉴权 RPC 可执行任意命令）区间。缓解证据：nuxt.config.ts:28 `devtools: { enabled: false }`。疑似原因：版本区间判定 | 仅当开发者显式开启 devtools 跑 nuxt dev 时暴露 | 刷新 lock 至 devtools ≥3.3.1 |
| S-058 | 疑似·低危 | C20-08 | backend/package-lock.json:3958-3960（声明 backend/package.json:36）；backend/src/routes/upload.ts:130-135 | mammoth 锁定 **1.12.1**，落在 CVE-2026-105219（1.3.0–<1.12.3，style map tokeniser ReDoS）区间；CVE-2025-11849（docx 任意文件读，修复 1.11.0）已不受影响。调用点：用户上传 .docx 做 extractRawText（需 JWT）。疑似原因：版本区间判定 | 恶意 docx 致 CPU 耗尽（DoS） | 升级 ≥1.12.3 并加转换超时 |
| S-059 | 疑似·低危 | C20-09 | frontend/package-lock.json:6334-6335 | lodash 锁定 **4.17.23**：CVE-2025-13465 已在 4.17.23 修复，但 CVE-2026-2950（数组包裹路径段绕过 13465 修复，≤4.17.23 受影响，修复 4.18.0）仍在区间。属前端构建链传递依赖，非运行时请求路径。疑似原因：版本区间判定 | 原型污染前提依赖构建链调用方式，实际面窄 | 随构建链升级至 ≥4.18.0 |
| S-060 | 疑似·低危 | C20-10 | backend/package-lock.json:3183-3184、4410-4411（引入链 :42-50、:3059-3060） | qs 锁定 **6.14.2**（express 内嵌）与 **6.15.0**，均落在 CVE-2026-8723（GHSA-q8mj-m7cp-5q26，>=6.11.1 <6.15.2，修复 6.15.2）区间。引入链：@a2a-js/sdk 0.2.5 → express ^4.21.2（lock 锁定 express 4.22.1），为 @mastra/core 传递依赖；**应用 HTTP 入口是 Hono，express/qs 不在请求处理路径**。疑似原因：版本区间判定 | 不在请求路径，实际暴露面低 | 随 mastra 升级传递修复，或 overrides qs ≥6.15.2 |
| S-061 | 疑似·待人工确认 | C20-12 | backend/package-lock.json:3260-3262；Dockerfile:34 | ffmpeg-static **5.3.0** 安装期下载的二进制（Dockerfile:34 指向 npmmirror 镜像）版本无法只读核实（二进制排除、禁止安装）。**缺证据**：部署机 `ffmpeg -version` 输出；需人工确认捆绑 FFmpeg 版本后比对相应 CVE。fluent-ffmpeg 2.1.3 本身无已知 CVE（其拼接参数面见 S-016） | 若捆绑 FFmpeg 落在已知 CVE 区间，恶意媒体文件可触发解析漏洞（上传面已见 S-004/S-044） | 人工执行 ffmpeg -version 比对 CVE；必要时升级 ffmpeg-static/固定二进制来源 |

### 2.1 重点问题攻击链详述

**链 1：公开 JWT 密钥 → 系统完全被控（S-001，叠加 S-002-b/S-003）**
仓库公开回退密钥（S-001-a）+ backend/.env 未配置（S-001-b）+ 模板无该键（S-001-c）→ 默认密钥实际生效 → 攻击者离线签发 `{id:1, role:'admin'}` 的 HS256 token（种子 admin 通常 id=1）→ middleware 只验签+查账号 active（S-013-b），伪造 token 指向真实 active 管理员即通行 → /api/v1/admin/* 全部管理接口：改任意用户 role/密码/配额、读全租户数据与 AI 配置（apiKey 明文列）、触发 rescue/retry 运维操作。并行通道：README 公开默认管理员口令（S-003-b）直接登录；compose 部署时 3307+公开 root 口令（S-002-c/f）直接拖库改 role。三通道任一即系统被控。

**链 2：上传存储型 XSS → 窃取 7 天不可吊销 token（S-004 × S-012 × S-013）**
任意认证用户 POST /api/v1/upload/image 上传 payload.html/.svg（零校验，S-004）→ 存 data/static/uploads/{uid}/{uuid}.html，响应返回可访问 URL → 受害者（含管理员）访问该 URL → 生产 nginx alias 直出按默认 mime 以 text/html 同源执行（需人工确认云端 mime 配置；无 nosniff，S-033）→ 脚本读取 localStorage['drama_mill_token']（S-013-d）→ 外传 → 攻击者持 7 天有效 JWT，受害者改密/登出无法吊销（S-013-a/b）→ 账号接管。/static/* 本身无鉴权（S-012）使 payload 分发无需任何凭证。

**链 3：全读型 SSRF → 内网数据外泄（S-005 × S-012，变体 S-014/S-015/S-017）**
攻击者注册普通账号 → POST /ai-configs 把自己控制的服务器设为 baseUrl（aiConfigs.ts:87 零 URL 校验）→ 提交图片/视频生成任务 → 假网关轮询响应返回 imageUrl=云元数据/内网地址 → generation-poll 调 downloadFile 无条件 fetch 落盘（storage-write.ts:29）→ 经无鉴权 /static/images/… 回读（S-012）→ 内网响应内容（含云凭证）完整外泄。变体：/ai-configs/test 部分回显探测（S-014）；参考图 URL 下载后 base64 回传攻击者网关（S-015）；本地参考图 `../` 穿越/跨租户路径读取后回传（S-017）。

**链 4：跨租户读写簇（S-006/S-007/S-008/S-009，放大 S-018/S-019）**
共同根因：归属校验只覆盖入口 drama/episode 一层，body 内资产 ID 与工具层 ID 零校验。① mass-assignment（S-006）：自己的 drama_id 过校验 + 受害者 character/episode 自增 ID → 篡改正文甚至改 dramaId 转移资产；② Agent 链（S-007）：自己的 drama_id + 受害者 episode_id → toolResults 回显他人剧本全文、replace_existing 清空他人分镜；③ 生成任务（S-008）：仅带 character_id/scene_id 零校验 → 完成后受害者立绘/分镜视频被替换（内容投毒）；④ 批量生成（S-009）：自己的 episode_id + 受害者资产 ids → 覆盖受害者资产 imageUrl，并可能消耗受害者额度（配置来源取决于攻击者剧集是否已锁定配置：已锁定则用攻击者自己的配置，未锁定且未传 config_id 时才按受害者 userId 选配置，S-018）。【勘误 7.1.1：原写「configId 取受害者配置」不准确，见安全修复确认清单第 7 节】泄露的素材 URL 再经 S-012 无鉴权下载，形成完整窃取闭环。

---

## 3. 统计

### 3.1 严重程度计数

| 类别 | 数量 | 索引 |
|---|---|---|
| 高危（确定） | **9** | S-001 ~ S-009 |
| 中危（确定） | **13** | S-011 ~ S-023 |
| 低危（确定，含信息项/部分疑似注明者） | **24** | S-029 ~ S-052 |
| 确定项小计 | **46** | — |
| 疑似（单列） | **15** | 倾向高危 1（S-010 sharp）；倾向中危 5（S-024 双NULL条件性、S-025 hono、S-026 node-server、S-027 drizzle、S-028 vite）；倾向低危 8（S-053 .dbpass.tmp、S-054 audit递归、S-055 提示词注入、S-056 nuxt、S-057 devtools、S-058 mammoth、S-059 lodash、S-060 qs）；待人工确认 1（S-061 ffmpeg 二进制） |
| **问题索引总数** | **61** | 原始记录 81 条（Alex 23 + Jack 11 + Tina 20 + Eric 27），按 11 个已知重复簇及同根因去重合并 |

注：S-037（C19-04）按低危计，其"上游错误体是否回显凭证"部分为疑似（描述内注明）；S-050 流程缺陷确定低危，"是否拉到投毒版本"为疑似（描述内注明）；S-016 的 concat 引号注入子项为疑似（描述内注明），主体中危。

### 3.2 按检查项 C01-C22 分布

| 检查项 | 结论 | 原始记录 → 归并索引 |
|---|---|---|
| C01 明文密钥/密码/连接串 | 发现问题（10 条） | C01-01→S-001；C01-02→S-002；C01-03/04/06→S-011；C01-05→S-029（JWT 部分→S-001-e）；C01-07→S-001-d+S-040-c；C01-08→S-040-a；C01-09→S-053；C01-10→S-030 |
| C02 硬编码账号/默认口令/后门 | 发现问题（4 条；未发现后门，测试凭证均为假样例） | C02-01→S-003-a；C02-02→S-003-b；C02-03→S-003-c/d；C02-04→S-031 |
| C03 私钥/证书/keystore | **未发现问题**（7 类扩展名 find 0 命中；-----BEGIN/PRIVATE KEY 0 命中；gitignore/dockerignore 均排除） | — |
| C04 http:// 明文地址 | 未发现高危；全部为低危例外/信息性 | →S-052 |
| C05 禁用证书校验 | **未发现问题**（rejectUnauthorized/NODE_TLS/insecure/verify=false/curl -k 全 0 命中） | — |
| C06 CORS/CSRF | CORS 非过宽（非 `*`，仅 localhost 白名单）；Bearer 鉴权无经典 CSRF；4 条低危 | C06-01→S-032；C06-02→S-013；C06-03→S-033；C06-04→S-034 |
| C07 SQL 注入 | 运行时全部参数化，未发现问题；1 条低危纵深防御 | Jack问题8→S-043；Jack问题9（交叉）→S-040-b |
| C08 命令注入 | 无 shell 注入（spawn 参数数组）；用户可控路径进 ffmpeg concat | Jack问题5→S-016；Jack问题9→S-040 |
| C09 代码注入/不安全反序列化 | 未发现问题（无 eval/new Function/yaml.load 等）；1 条疑似 | Jack疑似→S-055 |
| C10 SSRF | 发现问题（1 高危全读链 + 2 中危） | Jack问题2→S-005；问题3→S-014；问题4→S-015 |
| C11 路径遍历 | /static/* 本身安全（段校验）；参考图/skills 链路问题 | Jack问题5（交叉）→S-016；问题6→S-017；问题7→S-042 |
| C12 文件上传 | 发现问题（1 高危 XSS 链 + 1 低危） | Jack问题1→S-004；问题10→S-044 |
| C13 XSS | 前端代码层**未发现问题**（唯一 v-html 点 MentionTextarea.vue:27 经 escapeHtml 处理，useMentionTextarea.js:35-45 已核验）；存储型 XSS 经 C12 上传链成立 | 交叉引用 S-004 |
| C14 未鉴权接口 | 发现问题（5 条；白名单仅 health/login，无隐藏 debug/webhook 路由） | C14-1→S-012；C14-2→S-038；C14-3→S-002+S-011；C14-4→S-039；C14-5→S-040-a |
| C15 越权/IDOR | 发现问题（4 高危簇 + 2 中危 + 1 疑似 + 2 低危；admin 层与垂直越权未发现问题） | C15-1→S-006；C15-2→S-007；C15-3→S-008；C15-4→S-009；C15-5→S-018；C15-6→S-019；C15-7→S-024；C15-8→S-045；C15-9→S-046 |
| C16 JWT/Session | 发现问题（6 条） | C16-1→S-001；C16-2→S-013；C16-3→S-003；C16-4→S-041；C16-5→S-013-d；C16-6→S-001-d（.dbpass.tmp 空文件说法已修正→S-053/4.3） |
| C17 弱加密 | **未发现问题**（bcrypt cost10 加盐；sha1 仅 git blob 兼容性测试 brand-residue.test.mjs:16，非安全用途；sha256 文件校验合规；ssl_ciphers 排除 MD5 合规） | — |
| C18 不安全随机数 | **未发现问题**（全仓 0 处 Math.random；文件名 uuid v4；JWT 由 jsonwebtoken 签发） | — |
| C19 日志/响应泄露 | 发现问题（1 中危 + 3 低危 + 1 疑似） | C19-01→S-020；C19-02→S-035；C19-03→S-036；C19-04→S-037；C19-05→S-054 |
| C20 依赖漏洞 | 发现问题（12 条，全部疑似/版本区间判定；另核实一批已修复版本，见 4.4） | C20-01→S-025；02→S-026；03→S-010；04→S-027；05→S-056；06→S-057；07→S-028；08→S-058；09→S-059；10→S-060；11→S-050；12→S-061 |
| C21 调试/文档接口暴露 | 发现问题（5 条；devtools 已关、产物 0 sourcemap、无 swagger/actuator/autoindex） | C21-01→S-047；C21-02→S-036；C21-03→S-038；C21-04→S-002-f/g；C21-05→S-048 |
| C22 危险配置 | 发现问题（10 条） | C22-01→S-002；C22-02→S-001/S-011/S-003（三层拆分）；C22-03→S-021；C22-04→S-022；C22-05→S-023；C22-06→S-049；C22-07→S-033；C22-08→S-040；C22-09→S-050；C22-10→S-051 |

---

## 4. 覆盖率与盲区说明

### 4.1 覆盖合并说明（四路）

- **508 个范围内文件**：504 个文本文件全部至少经过"全局正则扫描 + 命中上下文阅读"（Grep 遵循 gitignore 覆盖全部入库文件；被忽略文件用只读 bash grep/直接读取补齐，含 backend/workspace/prompts/extractor.md）；其中安全关键文件去重后逾百个经语义精读（全文或关键段，清单见 1.4）。
- **routes 鉴权/归属专项**：routes/ 顶层 29 个文件逐一核对（wiki 称 28，实为 29，其中 3 个为无端点共享模块）；admin/ 19 个文件整层 adminGuard（admin/index.ts:39 先于全部 16 个子路由挂载 :40-55），adminGuard 实时取 DB role，token 内 role 不被信任——普通用户不可达，无垂直越权。prompts.ts 实为整层 adminGuard（:32，严于 wiki"仅 JWT"描述）。
- **依赖专项**：根 package.json 无依赖；backend 18+8、frontend 5+2 个声明依赖与 lock 锁定版本全部逐一核对；关键传递依赖抽查约 30 个（express/qs/lodash/MCP SDK/@mastra/* 等）。
- **docker/init.sql**：凭证/用户种子定向扫描（无 INSERT users、无明文口令）；docker/model-catalog-data.sql（5MB）正则全扫凭证模式+头部抽样+语句类型普查，未逐行语义阅读。

### 4.2 未覆盖/受限项

1. **二进制 4 个**：3 个 PNG（frontend/app/assets/drama-mill-logo.png、drama-mill-logo-128.png、根 donate.png）+ 根 .DS_Store——无法语义阅读，未覆盖（计入 508 总数）。
2. **docker/model-catalog-data.sql**（5.0MB 数据快照）：正则全扫+抽样，未逐行语义阅读。
3. **两份 package-lock.json 剩余传递依赖**：未逐一 CVE 比对（backend lock 5703 行、frontend lock 9983 行）；h3 1.15.10/nitropack 2.13.2 等仅确认属构建链且生产为静态产物，未查具体公告。
4. **运行期行为未验证（铁律禁止）**：未启动服务/调用接口/连库/投喂样本——S-037 上游错误体回显、S-016 concat 引号注入、S-055 提示词注入行为、S-010 sharp PoC 均需运行期验证；npm audit 因写入副作用被跳过。
5. **生产 nginx 主配置不在仓库**：mime.types include/types 覆盖无法核实——S-004 的 MIME 渲染行为按 nginx 默认配置推断，需人工在云端确认。
6. **数据库实际数据状态**：S-024（C15-7）双 NULL 暴露行计数需人工执行文中 SQL 确认。
7. **ffmpeg 捆绑二进制版本**：S-061（C20-12）需人工在部署机执行 `ffmpeg -version` 后比对 CVE。
8. **部分目录以定向 grep 兜底而非全文精读**：backend/src 其余编排类 services（production-*、novel-split 等，HTTP 入口归属已在路由层逐一核实）、backend/tests 74 与 frontend/tests 46（结构性测试）、frontend/app 其余 Vue 组件与 31 个 CSS（XSS 向量全量 grep 覆盖）、README.en.md/CLAUDE.md/LICENSE/docs 非执行面（README 两版凭证段落已精读核验）。

### 4.3 .dbpass.tmp 矛盾裁决（汇总实测）

- **矛盾**：Alex C01-09 报告"25 字节十六进制疑似口令"；Tina C16-6 报告"0 字节空文件"。
- **裁决（只读实测：ls -la + wc -c + Read 全文）**：文件实为 **25 字节非空**，内容为 24 位十六进制字符串+换行符（值打码 `d994****************cf30`）。**Alex 正确，Tina 的"空文件"描述错误**。
- **处理**：保留 C01-09 疑似口令描述（S-053，疑似·低危倾向，值打码），不降级为"空文件无泄露"；C16-6 中该错误描述已修正，其有效部分（rescue 脚本自签 token、未入库核实）并入 S-001-d。gitignore（.gitignore:14/:67）与 deploy-remote.sh:44 rsync 排除均生效，未见入库路径；是否云端真实口令需人工确认。
- **行号核验总结**：全部问题引用的每一处 文件:行号（含两份 package.json、两份 package-lock.json 全部引用行段、README.en.md、测试文件、前端组件、部署脚本）已逐一实读核验，**内容全部匹配：0 处行号修正、0 处子项删除**；唯一修正为上述 C16-6 描述级错误。

### 4.4 范围外发现与需人工确认事项（单独记录）

1. **node_modules 依赖证据（范围外只读引用）**：@mastra/core/dist/chunk-ABA3KD3X.js:869（contained 默认 true）、:899-907（basePath 外抛 PermissionError）——S-042 当前不可越狱的依据；:8336-8360（workspace 文件工具注入）、:8365-8375（无 sandbox 故无 executeCommand）——S-055 的依据。依赖升级需复核这些默认行为。
2. **Dockerfile Node20 与 @mastra engines 冲突**：已计入 S-023（C22-05），此处不重复计数；Alex/Jack 范围外附注与 Eric 正式记录同源。
3. **云端真实凭证有效性需人工确认**：backend/.env（MYSQL_PASSWORD 为公开默认值，S-011-b）、.dbpass.tmp（S-053）、.rescue-historical.sh（S-001-d）均未入库（git ls-files + git status --ignored 核实，状态 !!），属本地/云端留存而非仓库泄露；其值是否在云端真实有效无法只读验证。
4. **C20 已核实为"未发现问题"的关键依赖**（版本均实读 lock，供修复时参考）：jsonwebtoken 9.0.3（backend lock:3772-3774，CVE-2022-23529/23539/23540/23541 修复于 9.0.0）；mysql2 3.22.5（lock:4057-4059，CVE-2024-21508/21509/21511 已修复）；vue/@vue/compiler-sfc 3.5.31（frontend lock:9667-9669、3669-3671，CVE-2024-9506 已修复）；esbuild 0.25.12/0.27.4（backend lock:2930-2932、frontend lock:5277-5279，CVE-2024-45811/45812 已修复）；node-fetch 2.7.0（frontend lock:6769-6771）；ws 8.20.0（backend lock:5608-5610）；@modelcontextprotocol/sdk 1.28.0（lock:1805-1806，CVE-2025-66414 已修复且未运行 MCP HTTP 服务端）；axios/undici 两份 lock 均不存在；其余抽查传递依赖（cookie/cross-spawn/nanoid/semver/tar/jszip/underscore/path-to-regexp/js-yaml/kind-of/brace-expansion/minimatch/json5）均在历史 CVE 修复版之上。
5. **测试夹具假凭证**：backend/tests、frontend/tests 中 sk-test、test-only-key、sk-live-******（generate-test-failure-detail.test.mjs:35，打码，用于验证脱敏的假值）等均为测试夹具，非真实凭证，不计问题；未发现后门账号/隐藏鉴权绕过（AUTH_WHITELIST 仅 health/login，middleware/auth.ts:26）。
6. **正面确认（无需修复）**：后端日志 maskSecrets 覆盖完整且先脱敏后截断（logger.ts:43-50）；跨用户展示 Key 一律 maskApiKey 前4后4（cloud-tasks-compare.ts:13-17、admin/ai-configs.ts:76、tasks-shared.ts:52）；用户列表剔除 passwordHash（admin/users.ts:51/86/121）；failure-detail 有 redact（failure-detail-parse.ts:66-72）；task-logger 对 URL query key/base64 大字段有清洗；目录穿越防护（storage-core.ts:100-111）；merge 链路 episodeId 交叉校验+storyboardIds 先按本集过滤（ffmpeg-merge.ts:46-53）；C15 归属链完整的路由清单见 Tina 核对表（dramas/episodes/episodes-pipeline/storyboards/novels/novels-production/novel-split-templates/stylePresets/aiConfigs/user-model-prices/costs/upload/merge/production/production-batch）。
7. **与 wiki 的出入（以实读代码为准）**：routes/ 顶层 29 文件（wiki 称 28）；prompts.ts 整层 adminGuard（wiki 称仅 JWT）。

---

## 5. 结尾声明

本报告仅为问题索引，未修改任何代码。请人工审查后，将确认需修复的问题索引/文件/行号回传，再执行修复。