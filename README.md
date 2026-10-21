# 🎬 Drama Mill - AI 短剧生成平台

<div align="center">

[中文](./README.md) | [English](./README.en.md)

**基于 TypeScript 全栈的 AI 短剧自动化生产平台**

[![Version](https://img.shields.io/badge/version-v1.0.0-red?style=flat)](#更新日志)
[![Node Version](https://img.shields.io/badge/Node.js-22+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1?style=flat&logo=mysql)](https://www.mysql.com)
[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.html)

[功能特性](#功能特性) • [快速开始](#快速开始) • [部署指南](#部署指南) • [更新日志](#更新日志)

**小说 → 剧本 → 资产 → 分镜 → 图片 → 视频 → 成片，全流程一键自动生产**

</div>

---

## 📖 项目简介

Drama Mill 是一个 AI 短剧自动化生产平台：导入一部小说，平台用大模型完成剧本改写、角色/场景/道具提取、分镜拆解、图片与视频提示词生成、资产绘图、镜头视频生成，直到整集合成与导出。

作者只需在关键节点做确认和微调，其余环节由生产流水线按集推进，失败可暂停、续跑、重试。

### 🎯 核心价值

- **📚 小说直进**：支持 `.txt` / `.md` / `.docx` 导入，自动识别章节并按拆分模版分集
- **🤖 Agent 驱动**：5 个 Mastra Agent 覆盖改写、提取、分镜、提示词，技能可在线编辑扩展
- **🎨 视觉一致性**：29 个内置漫剧风格预设 + @提及引用资产图，角色场景跨镜头保持一致
- **📹 多厂商视频生成**：Seedance 2.0 / 通义万相 wan3.0 / MiniMax H3 等，支持多模型分流与优先级抢占
- **🛡️ 生产级防护**：并发槽位 + 节奏闸门 + 吞吐四重防护 + 看门狗自动恢复，避免打爆上游配额
- **👥 多租户**：用户/管理员两级角色，配置、风格、任务按属主隔离，管理后台统一治理

### 🛠️ 技术架构

```
frontend/                    — Nuxt 3 + Vue 3 + TypeScript（纯 CSS + CSS 变量，无 UI 框架）
backend/                     — Hono + Drizzle ORM + mysql2 + Mastra AI Agents
backend/workspace/skills/    — Agent 技能定义（SKILL.md，设置页可在线编辑）
data/static/                 — 生成的图片 / 视频 / 合成产物（本地文件存储）
docker/init.sql              — 预建表 + 内置种子（29 个风格预设、3 个小说拆分模版，可选）
deployment/                  — 一键部署、云端发布、磁盘监测、root 运维脚本
nginx/                       — 反向代理模板（SSE 关缓冲、/static 磁盘直连、大文件上传）
```

> 运行时只依赖 **Node.js + MySQL**：AI 服务的 Key / Base URL / 模型全部存库并在 Web 界面配置，无需配置文件；FFmpeg 由 npm 包内置二进制。

---

## ✨ 功能特性

### 📚 小说与分集

- ✅ 小说库管理（导入、软删除、按项目归属）
- ✅ 章节识别与智能拆分（拆分模版可自建，支持按段落 / 按目标字数两种模式）
- ✅ 分集标题与概要由模型解析，批量生产可锁定拆分提示词快照

### 🎭 剧本与资产

- ✅ AI 剧本改写（小说 → 格式化场景/对白）
- ✅ 角色 / 场景 / 道具智能提取与同名去重合并
- ✅ 资产图批量生成、手工上传、缩略图与海报帧自动产出
- ✅ @提及引用参考图，保持跨镜头形象一致

### 🎬 分镜与视频

- ✅ 剧本 → 分镜序列自动拆解，分镜可手工编辑
- ✅ 视频提示词批量生成（支持参考图与多模型模板）
- ✅ 文生视频 / 图生视频 / 参考生视频，按分镜直出镜头视频
- ✅ 单集选择性拼接（拼接前校验素材存在）、整剧导出

### 🏭 批量生产与队列

- ✅ 每集 7 步流水线编排：剧本改写 → 资产提取 → 分镜拆解 → 视频提示词 → 资产图片 → 视频生成 → 整集合成
- ✅ 步骤幂等、可暂停续跑；单部失败不中止整批（可配置）
- ✅ 云端队列多模型分池聚合，可实时观察排队与消耗
- ✅ 看门狗自动恢复（用户级 opt-in 授权）：失败任务自动重提、缺图资产自动补生成

### 🔐 账号、权限与治理

- ✅ JWT 登录、用户侧自助改密、全站顶栏账号区
- ✅ 管理后台：账号、审计日志、云端队列、成本、存储配额、网关、监控等 15 个治理页
- ✅ 模型调用总开关（用户可一键停用本人全部 AI 调用，防止后台悄悄花钱）
- ✅ 用量记录与模型单价配置，成本按用户/模型/环节统计

### 🧪 配置可用性与诊断

- ✅ AI 服务配置分文本 / 图片 / 视频三栏，官方厂商模板一键填入推荐值
- ✅ 连通性测试与**极简生成测试**：文本同步回传结果，图片/视频提交任务并轮询
- ✅ 失败原因中文化诊断（区分鉴权、配额、参数、内容审核、网关超时等）

### 🤖 AI Agents

内置 5 个 Mastra Agent，提示词入库、Skill 可扩展：

| Agent | 职责 |
|---|---|
| `script_rewriter` | 小说 → 格式化剧本改写 |
| `extractor` | 角色 / 场景 / 道具智能提取与去重 |
| `storyboard_breaker` | 剧本 → 分镜序列拆解 |
| `prompt_generator` | 角色/场景/道具图片提示词 + 分镜视频提示词生成 |
| `novel_splitter` | 小说分集标题/概要解析（单步输出 JSON，无工具） |

---

## 🔌 AI 网关与厂商支持

以代码中的白名单为准（`backend/src/services/ai.ts` 的 `officialProviders` + `services/adapters/registry.ts`）：

| 厂商 | 文本 | 图片 | 视频 | 协议说明 |
|---|:--:|:--:|:--:|---|
| **OpenAI** | ✅ | ✅ | — | OpenAI Chat / Images 兼容 |
| **Google Gemini** | ✅ | ✅ | — | Generative Language `/v1beta` |
| **火山引擎（方舟）** | — | ✅ | ✅ | Ark `/api/v3`，Seedance 2.0 标准 / Fast / Mini |
| **阿里云百炼 DashScope** | ✅ | ✅ | ✅ | 文本走 OpenAI compatible-mode；图片/视频走 DashScope 原生 |
| **MiniMax** | — | — | ✅ | MiniMax H3 视频 |
| **Model Router 网关** | ✅ | ✅ | ✅ | 文本 OpenAI Chat 兼容、图片/视频 DashScope 兼容体，端点均在 `/v1` 下 |

### 📌 Base URL 填写说明

- Base URL **只填站点根地址或版本前缀**，端点路径由适配器按能力动态拼接；把文档里的完整端点（如 `.../v1/responses`）粘进来会重复拼接成 `/v1/responses/v1/chat/completions` 而 404。
- 走 Model Router 时模型标识必须带 `symbol/` 前缀（如 `qwen/wan3.0-video`），且该 Key 需已在控制台「授权管理」勾选对应模型，否则回 403。
- 通过 `new-api` 类中转站调用时，如遇强制回传 `reasoning_content` 导致的 400，可用 `AI_DISABLE_THINKING` 注入关思考参数（官方端点自动跳过）。

> **三方 OpenAI / Anthropic 协议服务商**：目前后端对 `provider` 做官方白名单校验，尚无独立的「自定义服务商」入口。临时可用 `openai` / `dashscope`（文本）模板 + 自定义 Base URL 接入 OpenAI 兼容网关；Anthropic 协议暂未内置适配器。

---

## 🚀 快速开始

### 📋 环境要求

| 软件 | 版本要求 | 说明 |
|---|---|---|
| **Node.js** | **22+**（≥22.13） | @mastra/core 与 Nuxt 工具链要求，部署脚本会做版本闸门 |
| **npm** | 9+ | 包管理工具 |
| **MySQL** | 8.0+ | 唯一运行时数据库，本地或远程均可 |
| **PM2** | 最新 | 生产进程守护（`npm i -g pm2`） |

> **FFmpeg 无需安装**：通过 `ffmpeg-static` / `ffprobe-static` npm 包内置二进制，代码优先使用内置版本。

### ⚙️ 环境变量

均有默认值，本地开发可零配置启动。复制 `backend/.env.example` → `backend/.env` 后按需修改：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | — | 完整 MySQL 连接串（优先于分项配置） |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | 未设 `DATABASE_URL` 时分项配置；容器内未配置时自动改用 `host.docker.internal` |
| `MYSQL_USER` / `MYSQL_PASSWORD` | `dramamill` / `dramamill_tool` | 未设置时的回退值 |
| `MYSQL_DATABASE` | `drama_mill` | 库名 |
| `MYSQL_CONNECTION_LIMIT` / `MYSQL_QUEUE_LIMIT` | `30` / `200` | 连接池大小与排队上限 |
| `PORT` | `5679` | 后端服务端口 |
| `STORAGE_PATH` | `./data/static` | 生成文件存储目录（可指向项目外） |
| `PUBLIC_BASE_URL` | — | 对外可访问域名；向 Seedance 传本地参考视频时必需 |
| `TEXT_AI_MAX_CONCURRENT` / `TEXT_AI_MIN_INTERVAL_MS` | `3` / `0` | 文本 AI 并发槽位与调用节奏 |
| `GEN_MAX_CONCURRENT_IMAGE` / `GEN_MAX_CONCURRENT_VIDEO` | `3` / `3` | 图片、视频生成并发上限 |
| `GEN_SUBMIT_INTERVAL_MS` | `2000` | 提交节奏闸门（命中 429 自动翻倍，连续成功逐步减半） |
| `PROD_EPISODE_CONCURRENCY` / `BATCH_DRAMA_CONCURRENCY` | `3` / `1` | 单部并行集数 / 批量并行部数 |
| `VIDEO_TASK_TIMEOUT_MS` | `1800000` | 视频任务超时判定（另有 4 小时硬性墙钟上限） |
| `GEN_TASK_AUTO_RETRY_MAX` | `3` | 看门狗自动重提上限（`0` 关闭） |
| `AI_DISABLE_THINKING` / `AI_THINKING_OFF_PATCH` | — | 中转站关思考适配 |

> 完整可调项见 `backend/.env.example` 注释。AI 服务的 API Key、Base URL、模型名**不在环境变量中**，全部在 Web 界面配置并入库。

### 📥 安装依赖

```bash
git clone https://github.com/duducat2026/drama-mill.git && cd drama-mill

cd backend && npm install
cd ../frontend && npm install
```

### 🎯 启动项目

#### 方式一：开发模式（推荐）

```bash
# 终端 1：后端（tsx watch，端口 5679）
cd backend && npm run dev

# 终端 2：前端（Nuxt dev，端口 3013）
cd frontend && npm run dev
```

- 前端：<http://localhost:3013>
- 后端 API：<http://localhost:5679/api/v1>
- 前端自动代理 `/api` 与 `/static` 到后端（配置见 `frontend/nuxt.config.ts`）

#### 方式二：单服务模式

后端同时提供 API 与前端静态文件：

```bash
cd frontend && npm run generate
cp -r .output/public dist          # 后端只读取 frontend/dist，缺此步 API 正常但页面 404
cd ../backend && npm start
```

访问：<http://localhost:5679>

### 🗄️ 数据库

首次启动自动建表（幂等，每次启动重放初始化与增量迁移）：

```bash
DATABASE_URL=mysql://dramamill:dramamill_tool@127.0.0.1:3306/drama_mill npm start
```

- 共 **27 张表**，覆盖剧集/分集/分镜/资产/任务/AI 配置/风格/用量/审计等。
- 需要在应用外预建表（如 DBA 审核）时用 `docker/init.sql`；schema 变更后在 `backend/` 下执行 `npx tsx scripts/export-init-sql.ts` 重新生成。
- 内置种子（幂等补行，不覆盖用户编辑）：**29 个漫剧风格预设**、**3 个小说拆分模版**，`user_id IS NULL` 表示系统内置、全局共享。

### 🔑 首次使用

1. 登录。首次启动会幂等播种两个默认账号（登录页出于安全**仅提示普通用户账号**，管理员账号以下表为准，两者默认口令相同）：

   | 角色 | 用户名 | 默认口令 | 用途 |
   |---|---|---|---|
   | 普通用户 | `test` | `drama-mill` | 日常创作：项目 / 小说 / 分镜 / 生成，仅可见自己的数据 |
   | 管理员 | `drama-mill` | `drama-mill` | 管理后台：账号、审计、成本、存储配额、网关、监控等治理 |

   > ⚠️ **登录后请立即在「右上角账号区 → 修改密码」更换默认口令**。管理员账号不进入公开登录页提示、只在本 README 记录，以缩小公网环境的爆破面；若库内已存在任意管理员，播种会自动跳过新建（沿用已有账号）。
2. 打开「设置」页 → AI 服务配置，按文本 / 图片 / 视频三栏分别添加服务：
   - 选择官方厂商模板自动填入 Base URL 与推荐模型，再填自己的 API Key
   - 用「测试配置 / 生成测试」验证连通性，失败会给出中文化原因
3. 三类服务均有启用中的配置后，顶部引导横幅自动消失，即可创建项目开始生产

> 其他账号由管理员在「管理后台 → 用户」中创建；普通用户可见范围仅限自己的项目、配置与私有风格。

---

## 📦 部署指南

### 🚀 一键部署（推荐，免 Docker）

本地与云端共用同一套脚本（`deployment/deploy.sh` + PM2 进程守护）：

```bash
npm i -g pm2
cp backend/.env.example backend/.env      # 按实际 MySQL 信息修改（首次部署）

npm run deploy                # 装依赖 → 构建前端 → 连通性检查 → PM2 启动 → 健康检查
npm run deploy:backend        # 仅更新后端（不重建前端）
npm run deploy:frontend       # 仅更新前端（依赖 + 构建 + 重启）

npm run publish               # 云端自动化发布：rsync 同步 → 云端部署 → 公网验证（需 ~/.ssh/config 免密）
npm run publish:backend       # 仅后端发布
npm run publish:frontend      # 仅前端发布

npm run logs / restart / stop # 日常运维
```

| 脚本 | 作用 |
|---|---|
| `bash deployment/deploy.sh` | 完整部署（依赖 + 构建 + 启动） |
| `bash deployment/deploy.sh --backend-only / --frontend-only / --build-only / --restart` | 按需局部更新 |
| `bash deployment/deploy-remote.sh [参数]` | 云端发布（同步 + 部署 + 公网验证，参数同上） |
| `bash deployment/disk-monitor.sh` | 磁盘监测（云端 cron 每 30 分钟，超阈值告警） |
| `bash deployment/drama-mill-services.sh` / `drama-mill-boot-check.sh` | 服务状态汇总与启动自检 |
| `bash deployment/install-root-scripts.sh` | 安装云主机 root 级运维脚本 |
| `pm2 startup && pm2 save` | （可选）服务器重启后自动拉起 |

**部署架构**：后端单进程同时提供 API 与前端静态文件（`frontend/dist`），MySQL 独立部署。安全组只需放行 80/443，`5679` 不必暴露公网。

持久化数据（均为普通目录，直接备份）：

| 目录 | 内容 |
|---|---|
| `data/` | 生成的图片 / 视频 / 合成产物 |
| `backend/workspace/` | Agent 技能文件（设置页在线编辑，需随代码保留） |
| MySQL 数据目录 | 业务数据（由 MySQL 自身管理） |
| `logs/` | PM2 应用日志 |

> **提示**：构建需下载 `ffmpeg-static` / `sharp` 预编译二进制，网络受限环境先设镜像：`npm config set registry https://registry.npmmirror.com`

### 🌐 云端 Nginx 转发（80/443，可选）

项目自带模板（含 SSE 关缓冲、`/static/` 磁盘直连、100MB 上传、长超时）：

```bash
yum install -y nginx
scp nginx/drama-mill.conf nginx/drama-mill.common.inc root@服务器:/etc/nginx/conf.d/
nginx -t && systemctl enable --now nginx
```

> 若发行版 `nginx.conf` 自带 80 端口默认 server，需注释掉或给本站 `listen` 加 `default_server`。443 需域名 + 证书（如 Let's Encrypt），无域名时可先以 HTTP 运行，配置内已附 HTTPS 说明。

关键片段：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 100m;          # 参考视频/音频上传

    # 产物按 uuid 命名、内容不变 → sendfile 零拷贝 + immutable 长缓存
    location /static/ {
        alias /path/to/drama-mill/data/static/;
        sendfile on;
        tcp_nopush on;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://localhost:5679;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **媒体优化**：生成图片时自动产出 400px 缩略图（`*_thumb.webp`），视频自动抽海报帧（`*_poster.jpg`），前端仅在点开大图/播放时加载原文件。历史存量在 `backend/` 下执行 `npm run backfill-artwork` 一次性补齐。

### 🐳 Docker（备选）

仓库保留 `Dockerfile` + `docker-compose.yml`（应用 + MySQL 8.4 + 健康检查）。多阶段构建镜像仍以 `node:20-slim` 为基础，而运行时要求 Node 22+，使用 Docker 部署前请先升级镜像基础层，或优先采用上面的 PM2 一键部署路径。

### 🧮 常用检查命令

```bash
cd backend  && npm run typecheck && npm test    # 后端类型检查 + 结构/纯函数测试
cd frontend && npm run build     && npm test    # 前端构建 + 结构测试
```

---

## 🎨 技术栈

### 后端

- **Web 框架**：Hono + `@hono/node-server`（CORS、日志、JWT 鉴权与审计中间件）
- **ORM**：Drizzle ORM + mysql2（启动时建表与增量迁移）
- **AI**：Mastra Agent + Vercel AI SDK（`@ai-sdk/openai`、`@ai-sdk/google`）+ 自研厂商 Adapter 注册表
- **媒体**：FFmpeg（`ffmpeg-static` / `ffprobe-static` / `fluent-ffmpeg`）、Sharp
- **其他**：bcryptjs、jsonwebtoken、pino、mammoth（docx 导入）、zod

### 前端

- **框架**：Nuxt 3 + Vue 3 + TypeScript（`ssr: true`，生产以 `nuxt generate` 产出静态站点由后端托管）
- **样式**：纯 CSS + CSS 变量设计令牌，浅色主题，无第三方 UI 组件库
- **图标 / 反馈**：`lucide-vue-next`、`vue-sonner`
- **状态与数据**：组合式函数（`useApi` / `useAuth` / `useAgent` / `useWatchdogSwitch` 等），统一 fetch 客户端

### 测试

`node:test` 结构测试 + 纯函数单测（后端 46 个、前端 26 个测试文件），不依赖浏览器即可校验关键链路的代码结构与模型解析逻辑。

---

## 📝 常见问题

### Q: 页面顶部提示「尚未配置模型」？

A: 首次部署的正常引导。前往「设置 → AI 服务配置」，按文本 / 图片 / 视频三栏逐个添加服务并填入 API Key；三类都有启用中的配置后横幅消失。

### Q: 配置测试报 404 / 403？

A: 先看 [Base URL 填写说明](#base-url-填写说明)。404 几乎都是把完整端点粘进了 Base URL；Model Router 的 403 通常是模型标识缺 `symbol/` 前缀或 Key 未在该模型下授权。

### Q: 用户侧「风格预设」列表为空？

A: 风格数据由启动种子保证（29 个系统内置，`user_id IS NULL` 全局共享，任何登录用户都可见）。列表为空通常是后端未启动导致接口请求失败——此时页面会同时弹出错误提示。确认 `http://localhost:5679/api/v1/health` 可访问后刷新即可。

### Q: Docker 容器如何访问宿主机的 Ollama / 本地模型？

A: Base URL 用 `http://host.docker.internal:11434/v1`。宿主机需监听 `0.0.0.0`（`OLLAMA_HOST=0.0.0.0:11434 ollama serve`）；Linux 下 `docker run` 加 `--add-host=host.docker.internal:host-gateway`。

### Q: FFmpeg 未安装或找不到？

A: 无需安装，项目内置二进制且优先使用；自定义 `PATH` 中的系统 FFmpeg 不会冲突。

### Q: 前端连不上后端 API？

A: 确认后端已启动（默认 5679）；开发模式代理配置在 `frontend/nuxt.config.ts`。

### Q: 数据库表未创建？

A: 后端首次启动自动建表，检查 `logs/` 或控制台输出确认初始化与迁移是否成功。

---

## 📋 更新日志

### v1.0.0 (2026-09-17)

首个正式版本，自本版本起按语义化版本（`MAJOR.MINOR.PATCH`）维护，此前开发历史不再单独记录。

#### 🏭 生产流水线

- 每集 7 步自动化编排（剧本改写 → 资产提取 → 分镜拆解 → 视频提示词 → 资产图片 → 视频生成 → 整集合成），步骤幂等、可暂停续跑
- 批量生产批次与云端队列多模型分池聚合；视频多模型分流与吞吐四重防护
- 看门狗自动恢复（失败任务自动重提、缺图资产自动补生成），改为用户级显式授权
- 视频任务 4 小时硬性墙钟上限；集正文扩容 `MEDIUMTEXT`，修复长文本拆分击穿 64KB 上限

#### 📚 小说与内容

- 小说库管理（导入 `.txt` / `.md` / `.docx`、编码回退、软删除、租户归属）
- 小说分集：拆分模版（按段落 / 按目标字数）、`novel_splitter` Agent、批次生产两步走
- 风格预设多租户改造，内置 29 个漫剧风格种子 + `docker/init.sql` 预置初始化数据

#### 🔌 AI 网关与配置

- AI 服务配置重构为文本 / 图片 / 视频三栏 + 整页表单，官方厂商模板快捷填入
- 新增 Model Router 网关适配器（文本 OpenAI Chat 兼容、图片/视频 DashScope 兼容体）
- 新增配置连通性测试与极简生成测试（文本同步回传、图片/视频提交并轮询）与失败原因中文化诊断
- 模型调用总开关（用户侧可一键停用全部 AI 调用）

#### 🔐 账号与治理

- 用户侧自助修改密码 + 全站顶栏常驻账号区
- 管理后台 15 个治理页（账号、审计、云端队列、成本、存储配额、网关、监控等）
- 多租户归属修复与批量入口权限收敛

#### 🎨 界面与体验

- 登录页密码框支持明文 / 密文切换
- 工作台与剧集列表重构、素材库改版、@提及优化
- 存储布局迁移与配额治理、文档库分页与性能优化

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目并克隆
2. 创建特性分支（`git checkout -b feature/AmazingFeature`）
3. 提交改动（`git commit -m 'feat: add some AmazingFeature'`，提交信息沿用仓库现有的 `feat:` / `fix:` 前缀风格）
4. 推送到分支（`git push origin feature/AmazingFeature`）
5. 开启 Pull Request，并说明影响的环节与验证方式

改动前后请务必跑一遍：

```bash
cd backend  && npm run typecheck && npm test
cd frontend && npm run build     && npm test
```

---

## 📜 许可证

本项目采用 **GNU Affero General Public License v3.0（AGPL-3.0）** 开源，完整条款见 [LICENSE](./LICENSE)。

> ⚠️ **商业授权**：AGPL-3.0 要求网络服务分发同样开源。如你希望将本项目用于闭源商用、SaaS 集成或需要免除 AGPL 传染性约束，请通过邮箱获取单独的商业授权：**52859273@qq.com**。

---

## ☕ 捐赠支持

如果这个项目对你有帮助，欢迎请作者喝杯咖啡 ☕，你的支持是持续更新的动力！

<div align="center">

<!-- 支付宝捐赠二维码 -->
<img src="donate.png" alt="支付宝捐赠二维码" width="240" />

</div>

---

> _"让 AI 帮我们做更有创造力的事"_
