# Drama Mill 安全修复确认清单（两份审查报告交叉比对）

> 生成日期：2026-11-19　|　性质：比对与定性文档，未修改任何代码，也未改动两份原报告

## 1. 比对口径

| 项 | 内容 |
|---|---|
| 报告 A | `docs/安全审查报告-drama-mill-2026-11-18.md`，多智能体审查，61 个问题索引（高危 9、中危 13、低危 24、疑似 15） |
| 报告 B | `docs/安全审查报告-drama-mill-2026-11-19.md`，单路审查，39 个问题索引、113 个子项（高危 9、中危 12、低危 18） |
| 代码基线 | commit `27ab615` 加当前工作区未提交改动；行号以当前工作区为准 |
| 定性方法 | 两边一致的直接确认；只在一边出现或定级不同的，回到代码重新读过再裁决 |
| 行号来源 | 修复清单中的行号都在本次或上次审查中实际读过，个别只在报告 A 出现且未复读的已单独注明 |
| 依赖公告 | 联网检索了 8 条公告（见 6.1），其余未查；没有运行 `npm audit` |

下文用 "A:S-xxx" 和 "B:S-xxx" 区分两份报告的索引，合并后的修复项统一编号为 F-xx。

## 2. 比对结论

### 2.1 总体

两份报告在主干上一致：JWT 默认密钥、默认账号、越权簇、SSRF、上传加静态直出这五组高危两边都报了，证据链相互印证。合并去重后得到：

| 类别 | 数量 | 编号 |
|---|---|---|
| 确认修复，第一批（高危） | 11 | F-01 ~ F-11 |
| 确认修复，第二批（中危及需先加固的疑似项） | 11 | F-12 ~ F-22 |
| 确认修复，第三批（低危与纵深防御） | 14 | F-23 ~ F-36 |
| 问题成立但修法需要你决定 | 5 | D-1 ~ D-5 |
| 需要线上或运行期验证 | 9 | V-1 ~ V-9 |
| 不处理 | 4 | N-1 ~ N-4 |

### 2.2 报告 B 漏掉、报告 A 报对的

这些我回到代码核实过，全部成立：

| A 索引 | 内容 | 核实结果 |
|---|---|---|
| A:S-009 | 三个 `batch-generate-images` 接口只校验 episode 归属，`ids` 数组不过滤 | 成立，高危。报告 B 完全漏报，归入 F-05 |
| A:S-010 | sharp 0.34.5 落在已知漏洞区间，上传即触发解码 | 成立。报告 B 的 C20 结论"未发现明确命中"是错的，归入 F-10 |
| A:S-023 | Docker 基础镜像 Node 20 已停止维护，且与 `@mastra/core` 要求的 `node >=22.13.0` 冲突 | 成立（`backend/package-lock.json:1670`）。报告 B 只报了无 `USER`，归入 F-21 |
| A:S-024 | `userId` 与 `dramaId` 都为空的历史小说、任务被放行 | 代码成立，是否真有暴露取决于库内数据，归入 F-20 和 V-3 |
| A:S-025 ~ S-028、S-056 ~ S-060 | hono、@hono/node-server、drizzle-orm、vite、nuxt、devtools、mammoth、lodash、qs 的版本命中 | 锁定版本全部与报告 A 所述一致，归入 F-22 |
| A:S-043、S-046、S-047、S-049、S-050、S-051 | 导出脚本未转义反斜杠、运行态全局 Map、调试端点、PM2 无内存上限、`npm ci` 失败回退、webhook JSON 未转义 | 逐条读过，均成立，均为低危 |

### 2.3 报告 A 漏掉、报告 B 报对的

| B 索引 | 内容 | 定性 |
|---|---|---|
| B:S-015 | 最终提示词生成链路构造 Agent 上下文时不传 `userId`，文本模型退回到全部用户的配置里选 | 成立，中危，归入 F-15 |
| B:S-008-c | 下载落盘时沿用 URL 里的扩展名，配合 SSRF 也能落盘 `.html` | 成立，归入 F-09 |
| B:S-018-d | 上游响应体被拼进错误信息并落库 | 成立，归入 F-08 |
| B:S-012-c | 资产的 `image_url` / `local_path` 用户可写（报告 A 只提到 `characters.ts:36`） | 成立，归入 F-13 |
| B:S-017-c | 管理员重置密码后旧 token 不失效 | 成立，归入 F-16 |
| B:S-022 | 失败详情接口按任务里的 `configId` 读配置摘要，不校验归属 | 成立，低危，随 F-06 |
| B:S-026 | AI 配置的 `api_key` 明文返回给属主前端；Gemini Key 同时放在 URL 查询参数 | 成立，低危，归入 F-28 和 D-3 |
| B:S-034 | `/tasks/queue` 向任何登录用户返回全局队列统计 | 成立，低危，归入 F-35 |
| B:S-028、S-029-d、S-031-c | 日志记录完整业务体；小说与批量生产接口先读后判大小；PM2 以 root 运行 | 成立，分别归入 D-4、F-18、D-5 |

### 2.4 定级分歧的裁决

| 问题 | 报告 A | 报告 B | 裁决 | 理由 |
|---|---|---|---|---|
| compose 默认凭证加 3307 端口发布 | 高危 | 中危 | **高危** | 采纳 A。root 口令公开，端口默认绑全部网卡，照默认 compose 部署到公网主机即可被直连。你自己的生产走 PM2，不在这条路径上，但这是开源仓库给出的默认部署方式 |
| `config_id` 不校验归属 | 中危 | 高危 | **高危** | 维持 B。配置 id 是自增整数，任何登录用户（包括公开的 test 账号）可直接用别人的 Key 发起调用，不需要其他前提 |
| `/ai-configs/test` 与参考图 URL 的 SSRF | 中危 | 高危（并入簇） | **中危** | 采纳 A 的细分：前者只回显 240 字符，后者只有图片能回流。`downloadFile` 那条完整回显链两边都是高危。三处用同一个校验函数修，分级不影响动作 |
| Agent 可写 Workspace | 疑似·低 | 疑似·高 | **疑似·高，先加固** | A 按"小说原文里的间接注入"评估；实际上普通用户直接控制对话 `message`，不需要间接途径。能否诱导成功没有运行期证据，但加固只需改一处且不影响管理端（见 F-19），不必等验证 |
| 请求体无上限 | 中危 | 低危 | **中危** | 采纳 A。请求日志中间件挂在鉴权之前（`backend/src/index.ts:75` 早于 `:86`），未登录即可让服务端把 100MB 请求体整个读进内存 |
| `err.message` 直接返回 | 低危 | 中危 | **低危** | 采纳 A。多数是受控的业务文案。上游响应体进错误信息那一处另随 F-08 处理 |
| `/disk_status` | 低危 | 中危 | **低危** | 采纳 A。只有主机名和磁盘容量 |
| `image-prompt-tools` 按任意资产 id 写 | 高危（并入 Agent 簇） | 中危（单列） | 随 F-03 | 需要诱导模型输出他人的资产 id，比入口越权多一步，但修复点相同 |
| 新建资产时 `episode_id` 未校验 | 低危 | 中危 | 随 F-14 | 写关联是弱写入，读剧本上下文那一处两边都是中危，同一修法 |

## 3. 逐条定性对照表

### 3.1 以报告 A 的 61 项为主线

| A 索引 | A 定级 | B 对应 | B 定级 | 定性 | 去向 |
|---|---|---|---|---|---|
| S-001 | 高危 | S-001、X-01、X-03 | 高危 | 一致，确认 | F-01 |
| S-002 | 高危 | S-019-a/b、S-001-b、S-039-b | 中危 | 确认，采纳高危 | F-11（JWT 一行并入 F-01） |
| S-003 | 高危 | S-002 | 高危 | 一致，确认 | F-02 |
| S-004 | 高危 | S-008 | 高危 | 一致，确认；nginx 类型配置待线上确认 | F-09、V-2 |
| S-005 | 高危 | S-007-b/d | 高危 | 一致，确认 | F-08 |
| S-006 | 高危 | S-006 | 高危 | 一致，确认 | F-07 |
| S-007 | 高危 | S-003、S-014 | 高危 / 中危 | 一致，确认 | F-03 |
| S-008 | 高危 | S-004 | 高危 | 一致，确认 | F-04 |
| S-009 | 高危 | 无 | — | B 漏报；核实成立；A 的描述有一处不准（见 7.1） | F-05 |
| S-010 | 疑似·高危 | S-038 | 疑似·低危 | B 结论有误；公告已检索到，触发链已读代码确认；未做实际样本验证 | F-10 |
| S-011 | 中危 | S-019-c/d | 中危 | 一致，确认 | F-11 |
| S-012 | 中危 | S-020 | 中危 | 一致，问题成立；修法影响前端全部图片视频加载 | D-1 |
| S-013 | 中危 | S-017、S-025-a | 中危 / 低危 | 一致，确认 | F-16、D-2 |
| S-014 | 中危 | S-007-a | 高危 | 确认，采纳中危 | F-08 |
| S-015 | 中危 | S-007-c | 高危 | 确认，采纳中危 | F-08 |
| S-016 | 中危 | S-011 | 中危 | 一致，确认；ffmpeg 实际能带出多少内容待验证 | F-13、V-5 |
| S-017 | 中危 | S-012 | 中危 | 一致，确认 | F-13 |
| S-018 | 中危 | S-005、S-022 | 高危 / 低危 | 确认，维持高危 | F-06 |
| S-019 | 中危 | S-013-d/e | 中危 | 一致，确认 | F-14 |
| S-020 | 中危 | S-010 | 中危 | 一致，确认 | F-12 |
| S-021 | 中危 | S-016、S-029-e | 中危 / 低危 | 一致，确认 | F-17 |
| S-022 | 中危 | S-029-a/b/c | 低危 | 确认，采纳中危 | F-18 |
| S-023 | 中危 | S-031-a | 低危 | 确认，采纳中危 | F-21 |
| S-024 | 疑似·中危 | 无 | — | 代码成立；定级待查库 | F-20、V-3 |
| S-025 | 疑似·中危 | S-038 | 疑似·低危 | 版本命中属实；只服务公开的前端产物，暴露面低 | F-22 |
| S-026 | 疑似·中危 | S-038 | 疑似·低危 | 同上；1.x 没有修复版，需升到 2.x | F-22 |
| S-027 | 疑似·中危 | S-038 | 疑似·低危 | 版本命中属实；前提是用用户输入拼标识符，未见 | F-22 |
| S-028 | 疑似·中危 | S-038 | 疑似·低危 | 版本命中属实；只影响开发服务器 | F-22 |
| S-029 | 低危 | S-019-d、S-001-c | 中危 / 高危 | 确认，随主项 | F-01、F-11 |
| S-030 | 低危 | S-019-d | 中危 | 确认，随主项 | F-11 |
| S-031 | 低危 | S-023 | 低危 | 一致，确认 | F-25 |
| S-032 | 低危 | S-039-a | 低危 | 一致，确认 | F-31 |
| S-033 | 低危 | S-030 | 低危 | 一致，确认 | F-30 |
| S-034 | 低危 | S-027-b | 低危 | 一致，确认 | F-29 |
| S-035 | 低危 | S-025-b | 低危 | 一致，确认 | F-27 |
| S-036 | 低危 | S-018-a/b/c/e | 中危 | 确认，采纳低危 | F-23 |
| S-037 | 低危（部分疑似） | S-018-b | 中危 | 确认；上游是否回显 Key 待验证 | F-23、V-8 |
| S-038 | 低危 | S-021 | 中危 | 确认，采纳低危 | F-24 |
| S-039 | 低危 | S-039-b | 低危 | 一致，确认 | F-31 |
| S-040 | 低危 | S-033、X-03 | 低危 | 一致，确认 | F-33 |
| S-041 | 低危 | S-024 | 低危 | 一致，确认 | F-26 |
| S-042 | 低危 | S-032 | 低危 | 一致，确认 | F-32 |
| S-043 | 低危 | 无（B 盲区第 2 条提过未核实） | — | 核实成立，现不可利用 | F-33 |
| S-044 | 低危 | S-008-a、S-029-c | 高危 / 低危 | 确认；MIME 为空时跳过校验已核实 | F-09、F-18 |
| S-045 | 低危 | S-013-a | 中危 | 确认，同一修法 | F-14 |
| S-046 | 低危 | 无 | — | 核实成立；入口修好后自动消除 | F-03 |
| S-047 | 低危 | 无（B 记为"未发现调试接口"） | — | 核实成立，无敏感返回 | F-36 |
| S-048 | 低危（信息项） | 无 | — | 信息项 | F-36 |
| S-049 | 低危 | 无 | — | 核实成立 | F-18 |
| S-050 | 低危 | S-031-b（只报了 tsx） | 低危 | 流程缺陷核实成立；投毒事件背景未核实 | F-34、V-9 |
| S-051 | 低危（信息项） | 无 | — | 核实成立 | F-33 |
| S-052 | 低危（信息项） | S-037 | 低危 | 一致，无需处理 | N-1 |
| S-053 | 疑似·低危 | X-02 | 范围外 | 需你确认这串字符是什么 | V-6 |
| S-054 | 疑似·低危 | S-027-a | 低危 | 一致，确认 | F-29 |
| S-055 | 疑似·低危 | S-009 | 疑似·高危 | 分歧最大，见 2.4；先加固再验证 | F-19、V-4 |
| S-056 | 疑似·低危 | S-038 | 疑似·低危 | 版本命中属实；生产是静态产物，前提不成立 | F-22 |
| S-057 | 疑似·低危 | S-038 | 疑似·低危 | 版本命中属实；devtools 已关闭 | F-22 |
| S-058 | 疑似·低危 | S-038 | 疑似·低危 | 版本命中属实；上传 docx 可触发 | F-22 |
| S-059 | 疑似·低危 | S-038 | 疑似·低危 | 版本属实；公告未查；构建链依赖 | F-22 |
| S-060 | 疑似·低危 | S-038 | 疑似·低危 | 版本属实；公告未查；不在请求路径 | F-22 |
| S-061 | 待人工确认 | 无 | — | 需在部署机查看 | V-5 |

### 3.2 只在报告 B 出现的

| B 索引 | B 定级 | 定性 | 去向 |
|---|---|---|---|
| S-015 | 中危 | 确认（已复读 `final-prompt.ts:43-55`、`model-factory.ts:162-163`） | F-15 |
| S-022 | 低危 | 确认 | F-06 |
| S-026-a | 低危 | 问题成立，加密存储需要密钥管理方案 | D-3 |
| S-026-b/c | 低危 | 确认 | F-28 |
| S-028 | 低危 | 是否算问题取决于你对排障日志的需求 | D-4 |
| S-031-c | 低危 | 问题成立，改运行账号涉及服务器目录权限 | D-5 |
| S-034 | 低危 | 确认 | F-35 |
| S-035 | 低危 | 当前无可利用路径，可选 | F-36 |
| S-036 | 低危 | 无需处理（A 也明确不计） | N-2 |

## 4. 确认修复清单

### 4.1 第一批：高危

| 编号 | 问题 | 来源 | 修复点（文件:行号） | 修复方向 |
|---|---|---|---|---|
| F-01 | JWT 签名密钥有公开的默认值 | A:S-001、S-002-b；B:S-001 | `backend/src/services/auth.ts:27`；`docker-compose.yml:14`；`.env.example:17`；`backend/.env.example`（缺该项）；`deployment/deploy.sh:68`；`.rescue-historical.sh:19`（本地未入库） | 去掉回退值，未配置或等于公开默认值时拒绝启动；compose 改为强制外部注入；两个示例文件给占位符；部署脚本加校验 |
| F-02 | 默认账号口令公开 | A:S-003；B:S-002 | `backend/src/db/migrations-seed.ts:12-15`（播种逻辑 `:46-58`）；`frontend/app/pages/login.vue:59-64`；`README.md:223-230`；`README.en.md:225-230` | 首次启动生成随机口令或强制首登改密；移除登录页与文档里的口令 |
| F-03 | Agent 链路 `episode_id` 越权读、写、删 | A:S-007、S-046；B:S-003、S-014 | `backend/src/routes/agent.ts:63-67`；`backend/src/routes/agent-async.ts:50-52, 115-117, 177-179, 239-241`；`backend/src/agents/tools/script-tools.ts:40-47, 65-76, 86-93`；`storyboard-tools-write.ts:83-93, 183-188, 241`；`storyboard-tools-read.ts:36-48, 61`；`extract-tools.ts:42-48`；`extract-tools-shared.ts:28-54`；`image-prompt-tools.ts:42-49, 82-90, 128, 131, 169, 172` | 五个入口加 `getEpisodeOwned` 并校验 episode 属于该 drama；工具层的查询与更新条件加 `dramaId` 约束 |
| F-04 | `POST /tasks` 归属缺口，完成后回写他人资产 | A:S-008；B:S-004 | `backend/src/routes/tasks.ts:56-67, 77-78, 95-125`；`backend/src/services/generation-poll.ts:189-207, 223-225` | 请求里出现的每个资源 id 逐一校验归属且同属一个 drama；回写前再核对一次 |
| F-05 | 批量生图接口不过滤 `ids` | A:S-009；B 漏报 | `backend/src/routes/characters.ts:142-157`；`scenes.ts:119-135`；`props.ts:149-162`；`backend/src/services/asset-images.ts:99-102, 119-122, 147-150, 168-183` | `ids` 按 episode 所属 drama 过滤，越权 id 直接拒绝；服务层校验资产与 episode 同属一个 drama |
| F-06 | `config_id` 不校验归属，可盗用他人 Key 额度 | A:S-018；B:S-005、S-022 | `backend/src/services/ai.ts:123-133, 214-243`；`routes/tasks.ts:88-89, 154-183`；`routes/tasks-shared.ts:43-56`；`routes/agent.ts:82`；`routes/agent-async.ts:69`；`agents/model-factory.ts:160-163`；`services/generation-generate.ts:69-71, 108-110`；`routes/characters.ts:106-110`；`scenes.ts:102-106`；`props.ts:134-138`；`routes/episodes.ts:91-92`；`services/asset-images.ts:114, 142, 162` | `getConfigById` 增加调用者参数并强制比对，后台链路显式豁免；剧集锁定配置时校验配置属于本人 |
| F-07 | 批量保存接口越权加批量赋值 | A:S-006；B:S-006 | `backend/src/routes/dramas-assets.ts:57-63, 76-88` | 更新条件加 `dramaId`；改为字段白名单，禁止写 `dramaId` |
| F-08 | 服务端请求伪造（三条链） | A:S-005、S-014、S-015；B:S-007、S-018-d | `backend/src/routes/aiConfigs.ts:87, 110-164, 223-229`；`routes/ai-config-probe.ts:56-72`；`utils/storage-write.ts:21-37`；`utils/storage-image.ts:72-102`；`services/generation-refs.ts:42-58, 64`；`services/generation.ts:145` | 写一个统一的出网地址校验（协议白名单、解析后拦截环回、私网、链路本地与元数据地址、重定向逐跳校验、超时与大小上限），在入库、探测、下载、参考图四处调用；探测接口不回显响应体。会影响自建网关与本机 Ollama 的用法，见 4.4 第 3 条 |
| F-09 | 图片上传无校验，静态目录同源直出 | A:S-004、S-044；B:S-008 | `backend/src/routes/upload.ts:37-50, 110-112`；`utils/storage-write.ts:25, 42-52`；`utils/storage-core.ts:71-78`；`nginx/drama-mill.common.conf:27-33` | 扩展名加文件头白名单、大小上限、统一重命名扩展名；nginx 对静态目录加 `nosniff`，上传目录只放行图片视频类型或强制下载 |
| F-10 | sharp 0.34.5 存在已公开的解码漏洞 | A:S-010；B:S-038（结论有误） | `backend/package.json:39`；`backend/package-lock.json`；触发链 `backend/src/routes/upload.ts:48` 到 `utils/storage-image.ts:20` | 升级到 0.35.5 或更高；F-09 的白名单会顺带挡掉 SVG 与 TIFF |
| F-11 | compose 默认数据库凭证与端口发布 | A:S-002、S-011、S-029、S-030；B:S-019、S-039-b | `docker-compose.yml:8-9, 13, 40-41, 43, 46, 57`；`backend/src/db/index.ts:41-42`；`.env.example:8`；`backend/.env.example:9-10`；`README.md:155, 213`；`backend/scripts/audit-storage-orphans.ts:54-55` | 凭证改为强制外部注入；MySQL 端口不发布或只绑环回；应用端口只绑环回；代码里去掉回退口令；示例与文档改占位符 |

### 4.2 第二批：中危

| 编号 | 问题 | 来源 | 修复点（文件:行号） | 修复方向 |
|---|---|---|---|---|
| F-12 | Gemini API Key 明文写入日志 | A:S-020；B:S-010 | `backend/src/utils/task-logger.ts:84-85`；`backend/src/services/generation.ts:209` | 脱敏规则覆盖带连字符的写法，或请求头默认全部打码只放行白名单 |
| F-13 | 本地路径无约束（ffmpeg 合成与参考图读取） | A:S-016、S-017；B:S-011、S-012 | `backend/src/utils/storage-core.ts:84-94`；`routes/storyboards.ts:139-147`；`services/ffmpeg-merge.ts:152-154, 179`；`services/generation-refs.ts:31-39, 62`；`utils/storage-image.ts:40-65`；`routes/characters.ts:36`；`scenes.ts:79-85`；`props.ts:85-88`；`routes/tasks.ts:95-108` | `getAbsolutePath` 统一做规范化后的根目录前缀校验，拒绝绝对路径与 `..`；用户可写的路径字段限定在本租户目录；concat 清单转义单引号与换行 |
| F-14 | 资产路由的 `episode_id` 未校验 | A:S-019、S-045；B:S-013 | `backend/src/routes/characters.ts:58-62, 121-132`；`scenes.ts:47, 54-58, 138-149`；`props.ts:63-67, 105-116` | `episode_id` 走 `getEpisodeOwned`，并校验与资产同属一个 drama |
| F-15 | 最终提示词链路不传 `userId`，退回全量配置 | B:S-015；A 未报 | `backend/src/services/final-prompt.ts:46-54`；`services/asset-images.ts:112, 132, 160`；`services/ai.ts:136-147`；`agents/model-factory.ts:162-163` | 调用处传入 drama 属主的用户 id；用户侧链路禁止 `userId` 为空 |
| F-16 | 改密、注销、重置密码后旧 token 仍有效 | A:S-013；B:S-017 | `backend/src/routes/auth.ts:68-82, 128-129`；`routes/admin/users.ts:115`；`services/auth.ts:28, 54-56`；`backend/src/middleware/auth.ts`（每请求查库处，A 标为 `:46-49`，本次未复读） | 用户表加 token 版本号，改密、注销、重置时递增，中间件比对；视情况缩短有效期 |
| F-17 | 登录无限流 | A:S-021；B:S-016 | `backend/src/routes/auth.ts:38-45`；`nginx/drama-mill.common.conf` | 后端按账号与来源计数限速；nginx 对登录路径加 `limit_req` |
| F-18 | 请求体无上限，内存无兜底 | A:S-022、S-044、S-049；B:S-029 | `backend/src/index.ts:75`；`middleware/logger.ts:63-73`；`routes/upload.ts:115-116, 130-131`；`routes/novels.ts:81-82`；`routes/production-batch.ts:101-102`；`nginx/drama-mill.common.conf:4`；`ecosystem.config.cjs:11-27` | 全局加请求体上限；日志中间件跳过 multipart 与超长请求体；上传先看大小再读入；PM2 加 `max_memory_restart` |
| F-19 | Agent 的 Workspace 可写（疑似·高） | A:S-055；B:S-009 | `backend/src/agents/skills.ts:77-84`（`:81`） | Agent 用的文件系统实例设为只读。管理端编辑技能与提示词走的是另一个独立实例（`:87-92`），不受影响，已读代码确认 |
| F-20 | 归属字段全空的历史数据被放行 | A:S-024；B 未报 | `backend/src/services/ownership.ts:94-103`；`routes/tasks-shared.ts:19-25`；`routes/tasks.ts:207-213`；`routes/tasks-cloud-queue.ts:37-43` | V-3 查库确认无此类数据后删除放行分支，改为一律拒绝 |
| F-21 | Docker 基础镜像过期且以 root 运行 | A:S-023；B:S-031-a/b | `Dockerfile:8, 20, 45, 48, 63` | 基础镜像升到 Node 22 或更高；加非特权 `USER`；全局安装的 tsx 锁定版本 |
| F-22 | 其余依赖升级 | A:S-025 ~ S-028、S-056 ~ S-060；B:S-038 | `backend/package.json` 与 lock：hono 4.12.9、@hono/node-server 1.19.11、drizzle-orm 0.45.1、mammoth 1.12.1、qs 6.15.0（传递依赖）；`frontend/package.json` 与 lock：nuxt 3.21.2、vite 7.3.1、@nuxt/devtools 3.2.4、lodash 4.17.23（传递依赖） | 先跑 `npm audit`（V-7）拿到权威的修复版本再升级。@hono/node-server 需要跨大版本到 2.x，升级后要回归静态文件与启动流程 |

### 4.3 第三批：低危与纵深防御

| 编号 | 问题 | 来源 | 修复点（文件:行号） | 修复方向 |
|---|---|---|---|---|
| F-23 | 异常信息原样返回前端 | A:S-036、S-037；B:S-018 | `backend/src/middleware/logger.ts:95-96`；`routes/agent.ts:118-120`；`routes/tasks.ts:132-133, 274`；`routes/aiConfigs.ts:160`；`routes/characters.ts:116`；`scenes.ts:114`；`props.ts:144`；`merge.ts:70`；`episodes.ts:96`；`routes/admin/videos.ts:56, 95` | 非业务异常统一返回通用文案；Agent 错误先过现有的脱敏函数再记录与返回 |
| F-24 | `/disk_status` 无鉴权 | A:S-038；B:S-021 | `nginx/drama-mill.common.conf:36-40` | 加来源地址限制或移到管理端鉴权之后 |
| F-25 | 口令最小长度过短 | A:S-031；B:S-023 | `backend/src/routes/auth.ts:35, 76`；`routes/admin/users.ts:71, 115` | 统一到 8 位以上 |
| F-26 | JWT 未显式指定算法 | A:S-041；B:S-024 | `backend/src/services/auth.ts:54-56, 61` | 签发与校验都显式限定 HS256 |
| F-27 | 前端把请求体打到控制台 | A:S-035；B:S-025-b | `frontend/app/api/core.ts:50` | 生产构建去掉或脱敏 |
| F-28 | `api_key` 明文回显；Gemini Key 放在 URL 里 | B:S-026-b/c；A 未报 | `backend/src/routes/aiConfigs.ts:46-53`；`routes/ai-config-probe.ts:65-66`；`services/adapters/gemini-image.ts:80, 137` | 列表只返回掩码，编辑时留空表示不变（前端表单要同步改，`useAiConfigs.js` 目前有未提交改动）；Key 只走请求头 |
| F-29 | 审计脱敏只处理顶层；来源 IP 可伪造 | A:S-034、S-054；B:S-027 | `backend/src/middleware/audit.ts:28-43, 75`；`nginx/drama-mill.common.conf:47` | 递归脱敏；nginx 覆盖式设置转发头 |
| F-30 | nginx 缺安全响应头，套件偏宽 | A:S-033；B:S-030 | `nginx/drama-mill.conf:35-36`；`nginx/drama-mill.common.conf` | 加 HSTS 与基础安全头，收紧套件 |
| F-31 | 后端监听全部网卡；CORS 多余的 `credentials` | A:S-032、S-039；B:S-039 | `backend/src/index.ts:71-74, 188` | 生产绑定环回地址；去掉 `credentials` |
| F-32 | skills 路由未校验路径段 | A:S-042；B:S-032 | `backend/src/routes/skills.ts:38, 56, 64, 102` | 读、写、删三处复用新建接口已有的路径段校验 |
| F-33 | 运维脚本的几处小问题 | A:S-040、S-043、S-051；B:S-033 | `deployment/fix-tenant-attribution.sh:32, 40`；`.rescue-historical.sh:14`；`backend/scripts/export-init-sql.ts:44`；`deployment/disk-monitor.sh:91-93` | 口令改用环境变量传递；数字校验挪到拼接之前；导出脚本转义反斜杠；webhook 报文用工具构造 |
| F-34 | 部署时依赖可能被重新解析 | A:S-050；B:S-031-b | `deployment/deploy.sh:51-55`；`backend/package.json:27` | `npm ci` 失败即中止，不回退到 `npm install`；`@mastra/core` 钉死版本 |
| F-35 | `/tasks/queue` 返回全局统计 | B:S-034；A 未报 | `backend/src/routes/tasks.ts:138` | 按用户过滤或仅管理员可见 |
| F-36 | 可选清理 | A:S-047、S-048；B:S-035 | `backend/src/routes/agent.ts:125-129`；`backend/.gen-smoke.mts`；`frontend/app/composables/useMentionTextarea.js:35-45` | 移除调试端点与冒烟脚本；转义函数补上引号 |

### 4.4 修复时会改变现有行为的地方

动手前需要你知情的几处：

1. **F-01**：线上换密钥后所有人需要重新登录。`.rescue-historical.sh` 与 `backend/scripts/regen-missing-assets.ts:52-53` 都靠这个密钥自签 token，改完后要确认它们从环境变量取值。
2. **F-02**：代码修复只影响新部署，已有库里的 `drama-mill` 和 `test` 两个账号口令不会变，需要手工改。
3. **F-08**：拦截内网地址会影响"自建网关"和 README 里指导的本机 Ollama 用法（`README.md:376`）。需要你定一个策略，例如默认拦截、管理员可配置放行名单。
4. **F-11**：compose 改成强制注入后，不再能不配任何变量直接启动，README 的部署步骤要同步更新。
5. **F-22**：@hono/node-server 跨大版本升级。
6. **F-28**：配置列表不再返回明文 Key，前端编辑表单的交互要跟着改。

## 5. 需要你决定的事项

| 编号 | 问题 | 来源 | 需要决定什么 |
|---|---|---|---|
| D-1 | `/static/*` 全链路无鉴权，只靠 UUID 文件名 | A:S-012；B:S-020 | 问题成立。可选做法：签名链接、nginx 内部重定向鉴权、或接受现状只修上传目录（F-09 已覆盖）。前两种都要改前端所有图片视频的加载方式 |
| D-2 | 登录 token 存在 `localStorage` | A:S-013-d；B:S-025-a | 改成 HttpOnly Cookie 要同时引入 CSRF 防护。F-09 修完后现实风险明显下降，可以先不动 |
| D-3 | `api_key` 以明文列存储 | B:S-026-a | 应用层加密需要一个主密钥及其保管方式，是否要做 |
| D-4 | 日志里记录完整对话与请求体 | B:S-028 | 这是排障便利与内容隐私的取舍，是否截断 |
| D-5 | 生产 PM2 以 root 运行 | B:S-031-c | 换专用账号要调整服务器上的目录权限与开机服务，是否纳入本轮 |

## 6. 需要验证的事项

| 编号 | 事项 | 关联 | 怎么验证 |
|---|---|---|---|
| V-1 | 线上 `backend/.env` 是否配了 `JWT_SECRET` | F-01 | 登录服务器查看。本地这份没有配；如果线上也没有，F-01 当前就可被直接利用，应先于一切处理 |
| V-2 | 线上 nginx 对静态目录按什么类型返回 `.html` 与 `.svg` | F-09 | 查看生效配置里的类型映射，或上传一个无害的测试文件看响应头 |
| V-3 | 库里是否有归属字段全空的行 | F-20 | `SELECT COUNT(*) FROM novels WHERE user_id IS NULL AND drama_id IS NULL;` 以及对 `sys_task` 的同样查询。为 0 则只是代码隐患，大于 0 则是现实的越权 |
| V-4 | 普通用户能否通过对话让 Agent 改写提示词或技能文件 | F-19 | 测试环境实测。F-19 加固后此项自然关闭，可以不测 |
| V-5 | ffmpeg 合成能从非视频文件带出多少内容；捆绑的 ffmpeg 版本 | F-13；A:S-061 | 测试环境实测；部署机执行 `ffmpeg -version` |
| V-6 | 根目录 `.dbpass.tmp` 里那串 24 位字符是什么 | A:S-053；B:X-02 | 你自己确认。如果是有效口令，轮换后删除该文件 |
| V-7 | 依赖漏洞的权威清单 | F-10、F-22 | 在 `backend/` 与 `frontend/` 分别运行 `npm audit`。这条命令要联网并写本机 npm 缓存，我没有擅自执行 |
| V-8 | 上游报错时是否会把 Key 回显在错误体里 | F-23 | 用一把测试 Key 触发一次上游 401 看错误内容 |
| V-9 | 报告 A 提到的 2026-06 `@mastra` 包投毒事件 | F-34 | 我没有核实这起事件本身。已核实的是：两份 lock 文件里都没有 `easy-day-js`，`@mastra/core` 锁定在 1.17.0 |

### 6.1 依赖公告的核实范围

本次联网检索了 8 条公告，都能查到：sharp 的 GHSA-f88m-g3jw-g9cj（低于 0.35.0）与 librsvg 相关的 CVE-2026-96889（sharp 低于 0.35.5）、hono 的 CVE-2026-39407（低于 4.12.12）、@hono/node-server 的 GHSA-rmxm-3fg6-px4f（1.19.10 至 2.1.3 之前）、drizzle-orm 的 CVE-2026-39356（低于 0.45.2）、mammoth 的 CVE-2026-105219（低于 1.12.3）、nuxt 的 CVE-2026-53721（低于 3.21.7）、vite 的 CVE-2026-39363。前 7 条的受影响区间在检索摘要里可见，与锁定版本吻合；vite 一条只确认了公告存在。

我只看了检索结果的摘要，没有逐篇读公告全文。@nuxt/devtools、lodash、qs 三项以及 Node 20 停止维护后的安全公告没有查。升级到哪个版本以 V-7 的输出为准。

## 7. 两份报告的勘误

两份原报告都没有改动，勘误只记在这里。

### 7.1 报告 A（11-18）

1. **S-009 的配置来源描述不准确。** 报告写"configId 取受害者 ep.imageConfigId"。实际 `ep` 是攻击者自己传入并通过归属校验的剧集（`backend/src/services/asset-images.ts:114`）。准确的情况是：攻击者的剧集锁定了配置时用攻击者自己的配置；未锁定且未传 `config_id` 时，`generateImage` 按任务的 `userId`（即受害者）选配置（`backend/src/services/generation-generate.ts:69-71`），这时才消耗受害者的额度。结论（跨租户写入加资源滥用）不变。
2. **`ai.ts` 的行号与当前工作区不一致。** 报告写 `207-236`，当前工作区是 `214-243`。该文件有未提交改动，属于基线不同，不是读错。
3. **S-055 的威胁模型偏窄。** 只考虑了小说原文里的间接注入，没有考虑普通用户直接控制对话输入这条更短的路径，因此定级偏低。

### 7.2 报告 B（11-19）

1. **漏报批量生图接口越权**（对应 A:S-009），高危。
2. **C20 的结论错误。** S-038 写"未发现能确定命中的已知高危组件版本"，实际 sharp 等多个依赖落在已公开的漏洞区间内。
3. **C21 的结论不完整。** 写"未发现调试开关"，漏了 `GET /agent/:type/debug`（`backend/src/routes/agent.ts:125-129`）。
4. **漏报 Docker 基础镜像过期与引擎版本冲突、归属字段全空的放行分支**，以及 2.2 表末行列出的几个低危项。
5. **四处定级偏离**：compose 默认凭证与请求体上限定低了，`/disk_status` 与 `err.message` 定高了，见 2.4。

## 8. 不处理的项

| 编号 | 内容 | 来源 | 原因 |
|---|---|---|---|
| N-1 | 范围内的 `http://` 明文地址清单 | A:S-052；B:S-037 | 全部是本机地址、健康检查或文档示例 |
| N-2 | 测试代码里的 `vm.runInNewContext` | B:S-036 | 输入是仓库自身源码，不来自外部 |
| N-3 | 依赖安装走 npmmirror 镜像 | A:S-050-c | 国内部署的现实选择，只记录 |
| N-4 | 报告 A 中标为"核实证据"或"放大证据"的子行 | A:S-003-d、S-050-d | 是其他问题的佐证，本身不是修复项 |

---

本清单未修改任何代码。请确认要修复的 F 编号范围，以及 4.4、第 5 节中需要你决定的事项，再执行修复。
