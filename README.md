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
cp config.example.json config.json   # 必须手动复制（容器不会自动生成）
vim config.json                      # 必改 1 项：把 admin.password 的 CHANGE_ME 改成你自己的强密码
                                     # 可改：把 apiKeys 里的 tvly-your-real-api-key 换成真实 key（也可启动后在面板添加）
docker compose up -d
```

> **注意**：`config.example.json` 中面板密码为占位符 `CHANGE_ME`。若未修改，服务会**拒绝启动**并提示你补上密码——这是有意设计，避免默认凭据对外服务。容器也不会自动生成 config.json，必须先手动复制。

服务启动后：

- **管理面板**：http://localhost:8080/admin （用你在 config.json 里设置的密码登录）
- **MCP 端点**：http://localhost:8080/mcp
- **健康检查**：http://localhost:8080/health

> 说明：
> - `config.json` 是唯一的持久化配置文件（密钥、参数、账号密码），被 docker-compose 挂载为卷。
>   仓库提供 `config.example.json` 作为可复制范例；推荐启动后直接在面板"添加密钥"里管理。
> - 本项目不依赖 `.env` 文件，所有配置统一从 `config.json` 读取。
>   本地开发时仍可用 `npm start` + 环境变量（见下方"环境变量（可选）"）。
> - 容器以非 root 用户运行；若宿主机 config.json 权限过严导致保存失败，容器入口会自动尝试修正属主。

### 生产部署建议（安全）

服务默认使用**明文 HTTP**。若部署到公网，建议：

1. **前置 TLS 反向代理**（推荐 Caddy/Nginx）终止 HTTPS，再转发到本机 8080；
2. **开启 MCP 通道鉴权**（否则任何能访问 8080 的人都能调用搜索消耗你的 Tavily 额度）：
   - 面板「设置 → MCP 通道鉴权」打开开关并设置共享密钥，保存后**立即生效，无需重启**；
   - 开启后 MCP 客户端连接时需携带 `Authorization: Bearer <密钥>`；
   - 兼容旧方式：也可用环境变量 `MCP_API_KEY` 设置（config.json 未开启时兜底）；
3. 面板密码请在 config.json 中设置为强密码，不要在浏览器记住非本机使用的密码；
4. 数据库（config.json）含敏感凭据，确保宿主机文件权限仅本人可读。

## 环境变量（可选，本地开发用）

Docker 部署**不需要**环境变量文件，一切配置从 `config.json` 读取。以下环境变量仅在**本地直接运行**（`npm start`）时作为初始配置兜底使用：

| 变量 | 作用 |
|---|---|
| `PORT` | 服务端口，默认 8080 |
| `TAVILY_API_KEY` | 单个 Tavily API Key（兜底） |
| `TAVILY_API_KEYS` | 多 key 逗号分隔，启动时进入轮询池 |
| `TAVILY_INCLUDE_ANSWER` 等 | 面板管控参数的环境变量兜底（面板配置优先） |

**重要**：环境变量只作为"初始兜底"，且优先级**低于** `config.json`。启动后面板里的所有修改（增删密钥、配置 Token、改参数、改密码）都持久化到挂载的 `config.json`。

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

以下环境变量仅作为本地直接运行（`npm start`）时的初始兜底，优先级**低于** `config.json`（面板里的修改始终持久化到 config.json）：

| 变量 | 说明 |
|---|---|
| `TAVILY_API_KEYS` | 逗号分隔的 Tavily API Key 列表（仅 config.json 无 apiKeys 时兜底） |
| `PORT` | 服务端口，默认 8080 |
| `CONFIG_FILE` | config.json 路径，默认项目根目录 |
| `MCP_API_KEY` | MCP 鉴权共享密钥（仅 config.json 的 mcpAuth.enabled 为 false 时兜底） |

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
