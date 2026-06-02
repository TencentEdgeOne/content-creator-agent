# Content Creator - EdgeOne Makers Agent 模板

AI 驱动的内容创作助手，支持真实网络搜索、主题研究、大纲生成、文章撰写、SEO 分析和版本管理。

基于 [EdgeOne Makers](https://edgeone.ai/makers) + [DeepAgents](https://github.com/langchain-ai/deepagents) + [LangChain](https://js.langchain.com/) 构建。

## 部署
[![使用 EdgeOne Makers 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?template=content-creator-agent&from=within&fromAgent=1&agentLang=typescript)

## 功能特性

### 核心创作流程
- **主题研究** — 通过 `context.tools.web_search` 进行真实网络搜索，获取最新参考资料
- **AI 关键词建议** — 输入主题后自动生成 SEO 关键词建议，按 Tab 一键填入
- **大纲生成（人机互动）** — AI 先生成大纲，用户可编辑确认后再写作
- **流式写作** — SSE 实时流式输出，逐字呈现写作过程
- **段落修改** — 选择特定段落精准修改，或全文润色
- **SEO 分析** — 关键词密度、可读性评分、标题结构、优化建议

### Agent 特性
- **双模式生成** — 轻量模式（低 Token）和 DeepAgent 模式（完整 Agent 框架）可切换
- **人机互动** — 大纲确认流程，用户审核 AI 规划后再执行
- **长期记忆** — 基于 Pages Memory API 持久化用户写作偏好、历史关键词
- **真实网络搜索** — 基于 `@edgeone/pages-agent-toolkit` 的 `web_search` 工具
- **子代理流水线** — 研究 → 大纲 → 写作 → SEO 多阶段 Agent 协作

### 其他功能
- **版本管理** — 每次修改自动保存版本，支持版本切换和历史回溯
- **文章历史** — Blob 存储持久化，跨会话保留所有创作记录
- **导出** — 支持 Markdown、HTML、纯文本复制和 .md 文件下载
- **双语支持** — 中文 / English 一键切换
- **Token 追踪** — 各阶段 Token 消耗独立统计
- **Toast 通知** — 右上角错误/成功通知（如保存失败提醒）

## 项目结构

```
content-creator-edgeone/
├── agents/                     # EdgeOne Cloud Functions
│   ├── _shared.ts              # 共享工具：模型初始化、环境变量、日志
│   ├── create.ts               # DeepAgent 模式 — 完整 Agent 框架
│   ├── create-lite.ts          # 轻量模式 — 手动 Agent Loop，低 Token
│   ├── outline.ts              # 大纲生成（人机互动）
│   ├── suggest-keywords.ts     # AI 关键词建议（主题 → 关键词）
│   ├── refine.ts               # 文章修改（全文/段落）
│   ├── optimize.ts             # SEO 优化
│   ├── research.ts             # 独立研究 Agent
│   ├── articles.ts             # 文章 CRUD + 版本管理（Blob 存储）
│   ├── preferences.ts          # 用户偏好（Pages Memory / Blob）
│   ├── health.ts               # 健康检查
│   ├── stop.ts                 # 中断生成
│   └── test.ts                 # 模型连通性测试
├── app/                        # Next.js App Router
│   ├── page.tsx                # 主页面 + 多步流程编排
│   └── components/
│       ├── topic-form.tsx      # 输入表单 + AI 关键词建议 + 模式切换
│       ├── article-editor.tsx  # 编辑器 + 版本切换
│       ├── outline-card.tsx    # 大纲确认/编辑（顶部固定操作栏）
│       ├── refine-bar.tsx      # 段落选择 + 修改指令
│       ├── article-stats.tsx   # 字数、段落、阅读时间统计
│       ├── seo-panel.tsx       # SEO 分析面板
│       ├── article-history.tsx # 历史文章列表 + 自动保存
│       ├── export-panel.tsx    # 导出功能
│       ├── process-steps.tsx   # 工作流程可视化
│       └── research-results.tsx # 搜索结果展示
├── lib/
│   ├── i18n.tsx                # 中英文国际化
│   └── utils.ts                # 工具函数
├── components/ui/              # 基础 UI 组件（含 ghost text Input 等）
├── edgeone.json                # EdgeOne 部署配置
├── next.config.mjs             # Next.js 配置
└── .env.example                # 环境变量模板
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 填入你的 AI Gateway 配置：

```env
AI_GATEWAY_API_KEY=your-api-key
AI_GATEWAY_BASE_URL=your-gateway-url
```

### 3. 本地开发

```bash
edgeone makers dev
```

访问 http://localhost:8088

### 4. 部署

```bash
edgeone makers deploy
```

## 双模式架构

### 轻量模式（默认）

```
用户输入 → /outline（大纲） → 用户确认 → /create-lite（写作） → 文章
```

- 使用 `model.bindTools()` + 手动 Agent Loop
- 通过 `context.tools.web_search` 进行真实搜索，搜索后移除工具强制文本输出
- Token 消耗：~12-15k / 篇

### DeepAgent 模式

```
用户输入 → /outline（大纲） → 用户确认 → /create（写作） → 文章
```

- 手动 Agent Loop + 用户记忆层
- 包含偏好持久化和结构化 Prompt
- 通过 `context.tools.web_search` 进行真实搜索
- Token 消耗：~20-30k / 篇

## API 接口

| 端点 | 方法 | 说明 | 响应格式 |
|------|------|------|----------|
| `/outline` | POST | 生成文章大纲 | JSON |
| `/create` | POST | DeepAgent 模式创作 | SSE |
| `/create-lite` | POST | 轻量模式创作 | SSE |
| `/suggest-keywords` | POST | AI 关键词建议 | JSON |
| `/refine` | POST | 修改文章（全文/段落） | SSE |
| `/optimize` | POST | SEO 优化分析 | JSON |
| `/research` | POST | 独立研究 | SSE |
| `/articles` | POST | 文章 CRUD + 版本管理 | JSON |
| `/preferences` | POST | 用户偏好读写 | JSON |
| `/health` | GET | 健康检查 | JSON |
| `/test` | POST | 模型连通性测试 | JSON |

### SSE 事件类型

```
ai_response   — 文章文本内容（流式）
tool_call     — 工具调用开始
tool_result   — 工具调用结果
usage         — Token 消耗统计
error_message — 错误信息
ping          — 心跳保活
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | AI Gateway API Key |
| `AI_GATEWAY_BASE_URL` | 是 | AI Gateway Base URL |
| `PROJECT_ID` | 否 | Makers 项目 ID（部署时自动注入） |
| `EDGEONE_PAGES_API_TOKEN` | 否 | API Token（部署时自动注入） |

## 使用模型

默认使用 `@makers/deepseek-v4-flash`，如需更换请修改 `agents/_shared.ts` 中的 `MODEL_NAME` 常量。

| 模型 | 推荐场景 |
|------|---------|
| `@makers/deepseek-v4-flash` | **推荐** — 响应快、遵从指令好 |
| `@makers/minimax-m2.7` | 通用 |
| `@makers/hy3-preview` | 通用 |

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS 4
- **Agent**: [deepagents](https://github.com/langchain-ai/deepagents) + [langchain](https://js.langchain.com/)
- **工具**: [@edgeone/pages-agent-toolkit](https://www.npmjs.com/package/@edgeone/pages-agent-toolkit)（`web_search`）
- **存储**: [@edgeone/pages-blob](https://www.npmjs.com/package/@edgeone/pages-blob)（文章历史）+ Pages Memory API（用户偏好）
- **部署**: [EdgeOne Makers](https://edgeone.ai/makers)

## License

MIT
