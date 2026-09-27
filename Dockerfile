# Drama Mill 镜像构建。三阶段：前端静态生成 → 后端原生依赖编译 → 极简运行时。
# 构建参数面向国内网络环境，均可用 --build-arg 覆盖：
#   APT_MIRROR    Debian 源主机名，默认清华（可选阿里云 mirrors.aliyun.com、中科大 mirrors.ustc.edu.cn）
#   NPM_REGISTRY  npm 源，默认 npmmirror
#   PIP_INDEX     python 包源，默认清华（当前仅预置配置供未来使用）

# ---------- 阶段 1：前端静态产物 ----------
FROM node:20-slim AS web

ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}"

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run generate

# ---------- 阶段 2：后端生产依赖（含原生模块编译） ----------
FROM node:20-slim AS native

ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple

# 同时改写 deb822 (debian.sources) 与经典 sources.list 两种 apt 配置
RUN set -eux; for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
     [ -f "$f" ] && sed -i -e "s|deb.debian.org|${APT_MIRROR}|g" -e "s|security.debian.org|${APT_MIRROR}|g" "$f" || true; \
   done
RUN printf '[global]\nindex-url = %s\n' "${PIP_INDEX}" > /etc/pip.conf

# node-gyp 编译头文件与 ffmpeg 静态二进制均改走 npmmirror 镜像加速
ENV npm_config_disturl=https://registry.npmmirror.com/-/binary/node \
    FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static \
    npm_config_registry=${NPM_REGISTRY}
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---------- 阶段 3：运行时（tsx 直跑 TS，ffmpeg 由 npm 包自带二进制） ----------
FROM node:20-slim

ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}" && npm i -g tsx

WORKDIR /app
COPY --from=native /src/backend/node_modules ./backend/node_modules
COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
COPY backend/workspace/skills/ ./backend/workspace/skills/
COPY --from=web /src/frontend/.output/public ./frontend/dist

RUN mkdir -p data/static
ENV NODE_ENV=production PORT=5679
EXPOSE 5679
VOLUME /app/data

CMD ["tsx", "backend/src/index.ts"]
