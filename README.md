# Tavily Cloud MCP

基于 Tavily API 的云端 MCP 服务器，支持多 API Key 轮询、实时额度查询与 Web 管理面板。

## 功能特性

- **MCP Server（Streamable HTTP）**：提供 `web_search` / `web_extract` / `web_crawl` / `web_map` / `research_create` / `research_get_status` / `get_key_usage` 共 7 个工具
- **多密钥轮询池**：round-robin 负载均衡，401/429/432/433 自动故障转移，连续失败熔断临时禁用
- **实时额度查询**：使用官网 appSession token 调用内部 `/api/account`，绕开公共 `/usage` 接口的计费周期滞后问题，每 6 小时自动续期
- **Web 管理面板**：概览（密钥数量/健康状态/账户 Plan 用量进度条）、密钥管理（添加/删除/配置 Token）、参数配置（面板管控参数热修改，无需重启）、修改面板密码
- **面板密码登录**：个人项目仅需密码，浏览器记住密码后自动登录
- **Docker 一键部署**：三阶段构建，config.json 卷挂载持久化

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
git clone https://github.com/hahaha8459812/tavily-cloud-mcp.git
cd tavily-cloud-mcp
cp .env.example .env
# 编辑 .env 填入 TAVILY_API_KEYS
docker compose up -d
```

服务启动后：

- **管理面板**：http://localhost:8080/admin （默认密码 `admin123`，首次登录后请尽快修改）
- **MCP 端点**：http://localhost:8080/mcp
- **健康检查**：http://localhost:8080/health

### 方式二：本地运行

```bash
npm install
cp .env.example .env
npm run build       # 编译后端
npm run build:web   # 构建管理面板前端
npm start           # 启动，默认端口 8080
```

## 配置说明

### 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `TAVILY_API_KEYS` | 逗号分隔的 Tavily API Key 列表（优先于 config.json） |
| `PORT` | 服务端口，默认 8080 |
| `CONFIG_FILE` | config.json 路径，默认项目根目录 |

### 密钥与 Token

- **API Key**：`tvly-` 开头的 Tavily 密钥，多个 key 自动轮询
- **Token（可选）**：Tavily 官网的 `appSession` Cookie（浏览器登录 app.tavily.com 后从 Cookie 中复制）。配置后可在面板查看**实时额度**（邮箱、已用/总配额、剩余），token 每 6 小时自动续期。未配置 token 的 key 正常参与调用但不展示额度。

### 面板管控参数

管理面板可统一配置（不对 AI 暴露，保存后立即生效）：

- **Search**：附带 LLM 答案、原始内容、图片、站点图标、每来源片段数、域名白名单/黑名单、国家加权、自动参数
- **Extract/Crawl**：提取深度、内容格式、图片、站点图标

## 开发与测试

```bash
npm test        # 核心测试（集成/密钥池/边界/管理 API）
npm run test:tools  # 全工具真实调用测试
npm run test:hot    # 面板热修改测试
```

## 项目结构

```
├── src/               # 后端源码
│   ├── index.ts       # MCP Server + HTTP 路由 + 会话管理
│   ├── keyPool.ts     # 多密钥轮询池
│   ├── tavily.ts      # Tavily API 客户端 + 官网额度查询
│   ├── adminApi.ts    # 管理面板 API + 登录鉴权 + 限流
│   ├── config.ts      # 面板参数读取/合并
│   └── configStore.ts # config.json 读写（原子写入 + scrypt 密码哈希）
├── web/               # 管理面板前端（React + AntD 暗色主题）
├── scripts/           # 测试与验证脚本
├── Dockerfile         # 三阶段构建
└── docker-compose.yml
```

## License

MIT
