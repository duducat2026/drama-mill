# 🎬 Drama Mill - AI Short-Drama Generation Platform

<div align="center">

[中文](./README.md) | [English](./README.en.md)

**A full-stack TypeScript platform for automated AI short-drama production**

[![Version](https://img.shields.io/badge/version-v1.0.0-red?style=flat)](#-changelog)
[![Node Version](https://img.shields.io/badge/Node.js-22+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1?style=flat&logo=mysql)](https://www.mysql.com)
[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.html)

[Features](#-features) • [Quick Start](#-quick-start) • [Deployment](#-deployment-guide) • [Changelog](#-changelog)

**Novel → Script → Assets → Storyboard → Images → Videos → Final cut — one-click end-to-end production**

</div>

---

## 📖 Introduction

Drama Mill is an AI-powered short-drama production platform: import a novel and the platform uses LLMs to rewrite the script, extract characters/scenes/props, break the story into storyboards, generate image & video prompts, render asset illustrations and per-shot videos, and finally compose and export each episode.

Creators only confirm and fine-tune at key checkpoints; everything else advances episode-by-episode through the production pipeline, with pause / resume / retry on failures.

### 🎯 Core Value

- **📚 Novel-first**: `.txt` / `.md` / `.docx` import, automatic chapter detection and episode splitting via templates
- **🤖 Agent-driven**: 5 Mastra Agents cover rewriting, extraction, storyboarding and prompting; skills are editable online and extensible
- **🎨 Visual consistency**: 29 built-in comic-drama style presets + @-mention references to asset images keep characters and scenes consistent across shots
- **📹 Multi-vendor video generation**: Seedance 2.0 / Tongyi Wanxiang wan3.0 / MiniMax H3 and more, with multi-model traffic splitting and priority preemption
- **🛡️ Production-grade protection**: concurrency slots + pacing gate + four-layer throughput guards + watchdog auto-recovery, so upstream quotas never get blown
- **👥 Multi-tenant**: user/admin role separation; configurations, styles and tasks isolated by owner, centrally governed from the admin console

### 🛠️ Architecture

```
frontend/                    — Nuxt 3 + Vue 3 + TypeScript (pure CSS + CSS variables, no UI framework)
backend/                     — Hono + Drizzle ORM + mysql2 + Mastra AI Agents
backend/workspace/skills/    — Agent skill definitions (SKILL.md, editable online from Settings)
data/static/                 — generated images / videos / composites (local file storage)
docker/init.sql              — pre-built schema + built-in seeds (29 style presets, 3 novel-split templates, optional)
docker/model-catalog-data.sql — model catalog data snapshot (~2,500 models / 10,000+ price rows, import and go)
deployment/                  — one-click deploy, cloud publish, disk monitor, root ops scripts
nginx/                       — reverse-proxy templates (SSE buffering off, /static served from disk, large uploads)
```

> The runtime only needs **Node.js + MySQL**: AI service keys / base URLs / models all live in the database and are configured via the web UI — no config files required; FFmpeg binaries ship with the npm packages.

---

## ✨ Features

### 📚 Novels & Episodes

- ✅ Novel library management (import, soft delete, project-scoped ownership)
- ✅ Chapter detection and smart splitting (customizable templates; split by paragraph or by target word count)
- ✅ Episode titles and synopses parsed by the model; batch production locks a snapshot of the split prompt

### 🎭 Scripts & Assets

- ✅ AI script rewriting (novel → formatted scenes/dialogue)
- ✅ Intelligent extraction of characters / scenes / props with same-name dedup and merging
- ✅ Batch asset-image generation, manual upload, automatic thumbnails and poster frames
- ✅ @-mention reference images to keep appearances consistent across shots

### 🎬 Storyboard & Video

- ✅ Automatic script → storyboard breakdown, storyboards manually editable
- ✅ Batch video-prompt generation (with reference images and multi-model templates)
- ✅ Text-to-video / image-to-video / reference-to-video, per-shot videos generated directly from storyboards
- ✅ Selective per-episode concatenation (assets validated before merging) and full-drama export

### 🏭 Batch Production & Queues

- ✅ 7-step pipeline per episode: script rewrite → asset extraction → storyboard breakdown → video prompts → asset images → video generation → episode composition
- ✅ Idempotent steps, pausable and resumable; one failed title never aborts the batch (configurable)
- ✅ Cloud queue aggregates multi-model pools with real-time visibility into queue depth and consumption
- ✅ Watchdog auto-recovery (per-user opt-in): failed tasks resubmitted, missing asset images regenerated

### 🔐 Accounts, Permissions & Governance

- ✅ JWT login, self-service password change, account area in the global top bar
- ✅ Admin console: 15 governance pages (accounts, audit log, cloud queue, cost, storage quota, gateway, monitoring, etc.)
- ✅ Global model-call switch (users can disable all their own AI calls in one click — no silent spending)
- ✅ Usage records and per-model pricing; cost stats by user / model / pipeline stage

### 🧪 Configuration Usability & Diagnostics

- ✅ AI service settings split into Text / Image / Video columns; official vendor templates auto-fill recommended values
- ✅ Connectivity tests and **minimal generation tests**: text returns results synchronously, image/video submit-then-poll
- ✅ Localized failure diagnostics (distinguishing auth, quota, parameters, content moderation, gateway timeouts, etc.)

### 🤖 AI Agents

5 built-in Mastra Agents — prompts stored in the database, skills extensible:

| Agent | Responsibility |
|---|---|
| `script_rewriter` | Novel → formatted script rewriting |
| `extractor` | Character / scene / prop extraction and dedup |
| `storyboard_breaker` | Script → storyboard sequence breakdown |
| `prompt_generator` | Character/scene/prop image prompts + per-shot video prompts |
| `novel_splitter` | Episode title/synopsis parsing for novels (single step, JSON output, no tools) |

---

## 🔌 AI Gateway & Vendor Support

Whitelist as defined in code (`officialProviders` in `backend/src/services/ai.ts` + `services/adapters/registry.ts`):

| Vendor | Text | Image | Video | Protocol notes |
|---|:--:|:--:|:--:|---|
| **OpenAI** | ✅ | ✅ | — | OpenAI Chat / Images compatible |
| **Google Gemini** | ✅ | ✅ | — | Generative Language `/v1beta` |
| **Volcengine Ark** | — | ✅ | ✅ | Ark `/api/v3`, Seedance 2.0 Standard / Fast / Mini |
| **Alibaba Cloud Bailian (DashScope)** | ✅ | ✅ | ✅ | Text via OpenAI compatible-mode; image/video via native DashScope |
| **MiniMax** | — | — | ✅ | MiniMax H3 video |
| **Model Router gateway** | ✅ | ✅ | ✅ | Text OpenAI Chat compatible; image/video DashScope compatible; all endpoints under `/v1` |

### 📌 Base URL Guidelines

- Put **only the site root or version prefix** in Base URL; endpoint paths are appended dynamically by each adapter. Pasting the full endpoint from docs (e.g. `.../v1/responses`) produces `/v1/responses/v1/chat/completions` and a 404.
- When going through Model Router, model IDs must carry the `symbol/` prefix (e.g. `qwen/wan3.0-video`), and the key must have the model checked under "Authorization Management" in the console — otherwise you get 403.
- When calling through `new-api`-style relays, a 400 caused by mandatory `reasoning_content` round-tripping can be fixed by injecting the thinking-disable parameter via `AI_DISABLE_THINKING` (automatically skipped on official endpoints).

> **Third-party OpenAI / Anthropic-compatible providers**: the backend currently validates `provider` against the official whitelist and there is no standalone "custom provider" entry yet. As a workaround, use the `openai` / `dashscope` (text) template + a custom Base URL to connect to OpenAI-compatible gateways; Anthropic-protocol adapters are not built in yet.

---

## 🚀 Quick Start

### 📋 Requirements

| Software | Version | Notes |
|---|---|---|
| **Node.js** | **22+** (≥22.13) | Required by @mastra/core and the Nuxt toolchain; deploy scripts enforce a version gate |
| **npm** | 9+ | Package manager |
| **MySQL** | 8.0+ | The only runtime database; local or remote |
| **PM2** | latest | Production process manager (`npm i -g pm2`) |

> **No FFmpeg installation needed**: binaries are bundled via the `ffmpeg-static` / `ffprobe-static` npm packages and used preferentially.

### ⚙️ Environment Variables

All have defaults — zero-config works for local development. Copy `backend/.env.example` → `backend/.env` and adjust as needed:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Full MySQL connection string (takes precedence over individual options) |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | Individual options when `DATABASE_URL` is unset; inside containers, falls back to `host.docker.internal` |
| `MYSQL_USER` / `MYSQL_PASSWORD` | `dramamill` / `dramamill_tool` | Fallback values when unset |
| `MYSQL_DATABASE` | `drama_mill` | Database name |
| `MYSQL_CONNECTION_LIMIT` / `MYSQL_QUEUE_LIMIT` | `30` / `200` | Pool size and queue cap |
| `PORT` | `5679` | Backend port |
| `STORAGE_PATH` | `./data/static` | Generated-file storage directory (can point outside the project) |
| `PUBLIC_BASE_URL` | — | Publicly reachable domain; required when passing local reference videos to Seedance |
| `TEXT_AI_MAX_CONCURRENT` / `TEXT_AI_MIN_INTERVAL_MS` | `3` / `0` | Text AI concurrency slots and call pacing |
| `GEN_MAX_CONCURRENT_IMAGE` / `GEN_MAX_CONCURRENT_VIDEO` | `3` / `3` | Image / video generation concurrency caps |
| `GEN_SUBMIT_INTERVAL_MS` | `2000` | Submission pacing gate (doubles automatically on 429, halves on sustained success) |
| `PROD_EPISODE_CONCURRENCY` / `BATCH_DRAMA_CONCURRENCY` | `3` / `1` | Parallel episodes per title / parallel titles per batch |
| `VIDEO_TASK_TIMEOUT_MS` | `1800000` | Video task timeout (plus a hard 4-hour wall-clock cap) |
| `GEN_TASK_AUTO_RETRY_MAX` | `3` | Watchdog auto-resubmit cap (`0` disables) |
| `AI_DISABLE_THINKING` / `AI_THINKING_OFF_PATCH` | — | Relay thinking-disable compatibility |

> See comments in `backend/.env.example` for all tunables. AI service API keys, Base URLs and model names are **not environment variables** — they are configured in the web UI and stored in the database.

### 📥 Install Dependencies

```bash
git clone https://github.com/duducat2026/drama-mill.git && cd drama-mill

cd backend && npm install
cd ../frontend && npm install
```

### 🎯 Run the Project

#### Option 1: Development mode (recommended)

```bash
# Terminal 1: backend (tsx watch, port 5679)
cd backend && npm run dev

# Terminal 2: frontend (Nuxt dev, port 3013)
cd frontend && npm run dev
```

- Frontend: <http://localhost:3013>
- Backend API: <http://localhost:5679/api/v1>
- The frontend auto-proxies `/api` and `/static` to the backend (configured in `frontend/nuxt.config.ts`)

#### Option 2: Single-service mode

The backend serves both the API and the frontend static files:

```bash
cd frontend && npm run generate
cp -r .output/public dist          # the backend only reads frontend/dist; without this the API works but pages 404
cd ../backend && npm start
```

Visit: <http://localhost:5679>

### 🗄️ Database

Tables are created automatically on first launch (idempotent — initialization and incremental migrations are replayed on every start):

```bash
DATABASE_URL=mysql://dramamill:dramamill_tool@127.0.0.1:3306/drama_mill npm start
```

- **30 tables** in total, covering dramas / episodes / storyboards / assets / tasks / AI configs / styles / usage / audit / model catalog, etc.
- To pre-create the schema outside the app (e.g. DBA review), use `docker/init.sql`; after schema changes, regenerate it with `npx tsx scripts/export-init-sql.ts` inside `backend/`.
- Built-in seeds (idempotent row insertion, never overwriting user edits): **29 comic-drama style presets** and **3 novel-split templates**; `user_id IS NULL` marks them as system-built and globally shared.
- **Model catalog data** (the admin "Model Catalog Prices" page) ships as the repo snapshot `docker/model-catalog-data.sql`: import once with `mysql drama_mill < docker/model-catalog-data.sql` (primary-key upsert, safe to re-run); with Docker, compose loads it automatically during MySQL's first initialization.

### 🔑 First Use

1. Log in. The first launch idempotently seeds two default accounts (for security the login page **only hints at the regular user account**; the admin account is documented in the table below — both share the same default password):

   | Role | Username | Default password | Purpose |
   |---|---|---|---|
   | Regular user | `test` | `drama-mill` | Everyday creation: projects / novels / storyboards / generation, sees only own data |
   | Admin | `drama-mill` | `drama-mill` | Admin console: accounts, audit, cost, storage quota, gateway, monitoring, etc. |

   > ⚠️ **Right after logging in, change the default passwords via "top-right account area → Change password"**. The admin account is deliberately excluded from the public login-page hints and recorded only in this README to shrink the brute-force surface on public deployments; if any admin already exists in the database, seeding automatically skips creating a new one (existing accounts are kept).
2. Open **Settings → AI Service Configuration** and add services under the Text / Image / Video columns:
   - Pick an official vendor template to auto-fill the Base URL and recommended models, then enter your own API key
   - Validate with "Test config / Generation test" — failures come with localized reasons
3. Once all three service types have an enabled configuration, the onboarding banner at the top disappears — create a project and start producing

> Additional accounts are created by admins under "Admin console → Users"; regular users can only see their own projects, configurations and private styles.

---

## 📦 Deployment Guide

### 🚀 One-Click Deploy (recommended, no Docker)

Local and cloud share the same scripts (`deployment/deploy.sh` + PM2 process guarding):

```bash
npm i -g pm2
cp backend/.env.example backend/.env      # set your real MySQL info (first deploy)

npm run deploy                # install deps → build frontend → connectivity check → PM2 start → health check
npm run deploy:backend        # update backend only (no frontend rebuild)
npm run deploy:frontend       # update frontend only (deps + build + restart)

npm run publish               # automated cloud publish: rsync sync → deploy on server → public verification (needs passwordless ~/.ssh/config)
npm run publish:backend       # backend-only publish
npm run publish:frontend      # frontend-only publish

npm run logs / restart / stop # daily ops
```

| Script | Purpose |
|---|---|
| `bash deployment/deploy.sh` | Full deployment (deps + build + start) |
| `bash deployment/deploy.sh --backend-only / --frontend-only / --build-only / --restart` | Partial updates on demand |
| `bash deployment/deploy-remote.sh [args]` | Cloud publish (sync + deploy + public verification, same args) |
| `bash deployment/disk-monitor.sh` | Disk monitor (cloud cron every 30 min, alerts over threshold) |
| `bash deployment/drama-mill-services.sh` / `drama-mill-boot-check.sh` | Service status summary and boot self-check |
| `bash deployment/install-root-scripts.sh` | Install root-level ops scripts on the server |
| `pm2 startup && pm2 save` | (Optional) auto-restart after server reboot |

**Deployment topology**: a single backend process serves both the API and the frontend static files (`frontend/dist`); MySQL is deployed separately. Only ports 80/443 need to be open in the security group — `5679` does not have to be public.

Persistent data (all plain directories, back up directly):

| Directory | Content |
|---|---|
| `data/` | Generated images / videos / composites |
| `backend/workspace/` | Agent skill files (edited online from Settings; keep with the code) |
| MySQL data directory | Business data (managed by MySQL itself) |
| `logs/` | PM2 application logs |

> **Tip**: builds download `ffmpeg-static` / `sharp` prebuilt binaries; on restricted networks set a mirror first: `npm config set registry https://registry.npmmirror.com`

### 🌐 Cloud Nginx Reverse Proxy (80/443, optional)

Bundled templates (SSE buffering off, `/static/` served straight from disk, 100MB uploads, long timeouts):

```bash
yum install -y nginx
scp nginx/drama-mill.conf nginx/drama-mill.common.inc root@server:/etc/nginx/conf.d/
nginx -t && systemctl enable --now nginx
```

> If your distro's `nginx.conf` ships a default server on port 80, comment it out or add `default_server` to this site's `listen`. HTTPS needs a domain + certificate (e.g. Let's Encrypt); without a domain you can run HTTP first — HTTPS notes are included in the config.

Key snippet:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 100m;          # reference video / audio uploads

    # artifacts are uuid-named and immutable → sendfile zero-copy + immutable long caching
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

> **Media optimization**: generating an image also produces a 400px thumbnail (`*_thumb.webp`); videos get an auto-extracted poster frame (`*_poster.jpg`); the frontend loads the original file only when opened full-size / played. For historical assets, run `npm run backfill-artwork` inside `backend/` once.

### 🐳 Docker (alternative)

The repo keeps `Dockerfile` + `docker-compose.yml` (app + MySQL 8.4 + health checks). On the MySQL volume's first initialization, compose automatically runs `docker/init.sql` (schema + seeds) and `docker/model-catalog-data.sql` (model catalog snapshot), so the database ships fully pre-loaded. The multi-stage image is still based on `node:20-slim`, while the runtime requires Node 22+ — upgrade the image base layer before deploying with Docker, or prefer the PM2 one-click path above.

### 🧮 Handy Checks

```bash
cd backend  && npm run typecheck && npm test    # backend typecheck + structural/pure-function tests
cd frontend && npm run build     && npm test    # frontend build + structural tests
```

---

## 🎨 Tech Stack

### Backend

- **Web framework**: Hono + `@hono/node-server` (CORS, logging, JWT auth and audit middleware)
- **ORM**: Drizzle ORM + mysql2 (schema creation and incremental migrations at startup)
- **AI**: Mastra Agent + Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/google`) + in-house vendor adapter registry
- **Media**: FFmpeg (`ffmpeg-static` / `ffprobe-static` / `fluent-ffmpeg`), Sharp
- **Others**: bcryptjs, jsonwebtoken, pino, mammoth (docx import), zod

### Frontend

- **Framework**: Nuxt 3 + Vue 3 + TypeScript (`ssr: true`; production uses `nuxt generate` and the backend serves the static site)
- **Styling**: pure CSS + CSS-variable design tokens, light theme, no third-party UI library
- **Icons / feedback**: `lucide-vue-next`, `vue-sonner`
- **State & data**: composables (`useApi` / `useAuth` / `useAgent` / `useWatchdogSwitch`, etc.) with a unified fetch client

### Testing

`node:test` structural tests + pure-function unit tests (46 backend, 26 frontend test files) — validating key-flow code structure and model-parsing logic without a browser.

---

## 📝 FAQ

### Q: The banner says "no model configured yet"?

A: Normal onboarding for a first deployment. Go to "Settings → AI Service Configuration" and add services under the Text / Image / Video columns with your API keys; the banner disappears once all three types have enabled configurations.

### Q: Config test returns 404 / 403?

A: See [Base URL Guidelines](#-base-url-guidelines) first. 404 is almost always a full endpoint pasted into Base URL; 403 on Model Router usually means the model ID lacks the `symbol/` prefix or the key isn't authorized for that model.

### Q: The user-side "Style Presets" list is empty?

A: Style data is guaranteed by the startup seed (29 system presets, `user_id IS NULL`, globally shared and visible to every logged-in user). An empty list usually means the backend isn't running so the API call fails — the page would also show an error toast. Confirm `http://localhost:5679/api/v1/health` is reachable, then refresh.

### Q: How does a Docker container reach Ollama / local models on the host?

A: Use Base URL `http://host.docker.internal:11434/v1`. The host must listen on `0.0.0.0` (`OLLAMA_HOST=0.0.0.0:11434 ollama serve`); on Linux add `--add-host=host.docker.internal:host-gateway` to `docker run`.

### Q: FFmpeg not installed or not found?

A: No installation needed — the project bundles binaries and prefers them; a system FFmpeg on your `PATH` won't conflict.

### Q: Frontend can't reach the backend API?

A: Make sure the backend is running (port 5679 by default); the dev-mode proxy is configured in `frontend/nuxt.config.ts`.

### Q: Database tables not created?

A: The backend creates tables automatically on first launch — check `logs/` or console output to confirm initialization and migrations succeeded.

---

## 📋 Changelog

### v1.0.0 (2026-09-17)

First stable release. From this version we follow semantic versioning (`MAJOR.MINOR.PATCH`); earlier development history is not logged separately.

#### 🏭 Production Pipeline

- 7-step automation per episode (script rewrite → asset extraction → storyboard breakdown → video prompts → asset images → video generation → episode composition), idempotent steps, pausable and resumable
- Batch production with cloud-queue multi-model pool aggregation; multi-model video traffic splitting and four-layer throughput protection
- Watchdog auto-recovery (resubmits failed tasks, regenerates missing asset images), now gated on explicit per-user authorization
- Hard 4-hour wall-clock cap for video tasks; episode text upgraded to `MEDIUMTEXT`, fixing long-text splits breaking the 64KB limit

#### 📚 Novels & Content

- Novel library management (`.txt` / `.md` / `.docx` import, encoding fallback, soft delete, tenant ownership)
- Novel episode splitting: templates (by paragraph / by target word count), the `novel_splitter` Agent, two-step batch production
- Multi-tenant rework of style presets, seeded with 29 built-in comic-drama styles + `docker/init.sql` preset data

#### 🔌 AI Gateway & Configuration

- AI service configuration reworked into Text / Image / Video columns with a full-page form and official vendor quick-fill templates
- New Model Router gateway adapter (text OpenAI Chat compatible, image/video DashScope compatible)
- New connectivity tests and minimal generation tests (text synchronous, image/video submit-and-poll) with localized failure diagnostics
- Global model-call switch (users can disable all AI calls in one click)

#### 🔐 Accounts & Governance

- Self-service password change + persistent account area in the global top bar
- 15 admin governance pages (accounts, audit, cloud queue, cost, storage quota, gateway, monitoring, etc.)
- Multi-tenant attribution fixes and permission tightening on batch entry points

#### 🎨 UI & Experience

- Password visibility toggle on the login page
- Workbench and episode-list rework, asset library redesign, @-mention improvements
- Storage-layout migration and quota governance, documentation pagination and performance tuning

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this project and clone your fork
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add some AmazingFeature'`, keeping the repo's existing `feat:` / `fix:` prefix style)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request, describing the affected pipeline stages and how to verify

Always run this before and after changes:

```bash
cd backend  && npm run typecheck && npm test
cd frontend && npm run build     && npm test
```

---

## 📜 License

This project is open-sourced under the **GNU Affero General Public License v3.0 (AGPL-3.0)**; full text in [LICENSE](./LICENSE).

> ⚠️ **Commercial licensing**: AGPL-3.0 requires open-sourcing network-distributed works as well. If you want to use this project in closed-source commercial products, SaaS integrations, or need relief from AGPL's copyleft obligations, obtain a separate commercial license via email: **52859273@qq.com**.

---

## ☕ Sponsor

If this project helps you, consider buying the author a coffee ☕ — your support powers continuous updates!

<div align="center">

<!-- Alipay donation QR code -->
<img src="donate.png" alt="Alipay donation QR code" width="240" />

</div>

---

> _"Let AI do the more creative work for us."_
