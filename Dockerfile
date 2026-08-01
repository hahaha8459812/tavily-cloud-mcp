# 构建阶段：编译后端 TypeScript
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 构建阶段：编译前端 React 面板
FROM node:22-alpine AS web-builder
WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# 运行阶段：仅保留后端产物和前端静态页
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=web-builder /web/dist ./web/dist

# 范例配置文件 + 入口脚本（首次部署无 config.json 时自动初始化）
COPY config.example.json ./config.example.json
COPY docker-entrypoint.sh ./

# 非 root 运行（L7）：降低容器逃逸影响面；su-exec 用于降权执行
RUN apk add --no-cache su-exec \
    && addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app \
    && chmod +x /app/docker-entrypoint.sh

# config.json 通过外部卷挂载，保持持久化
EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
