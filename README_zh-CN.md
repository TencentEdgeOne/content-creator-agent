# 内容创作助手

AI 驱动的内容创作助手，支持主题研究、结构化大纲生成、流式文章写作、SEO 分析与关键词建议，具备版本管理和持久记忆。基于 Deep Agents 构建，部署在 EdgeOne Makers。

**Framework:** Deep Agents · **Category:** Content · **Language:** TypeScript

[![部署到 EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=content-creator-agent&from=within&fromAgent=1&agentLang=typescript)

## 概述

本模板通过多阶段 Agent 工作流，将内容创作的全流程——从主题研究到成稿润色——编排为一条完整管线。它使用基于 LangChain 的 Agent 与结构化提示词，跨会话积累用户偏好，并存储文章版本以供检索与对比。

- **主题研究** — 每次请求可选执行一次联网搜索，获取写作背景材料。
- **结构化大纲** — 在正式起草前生成带有 `##` 章节和 `###` 子章节的层级大纲。
- **流式文章写作** — 在单次流式运行中产出完整文章，遵循字数目标与风格要求。
- **SEO 与关键词工具** — 提供专门的 SEO 优化和关键词建议端点。
- **持久记忆** — 通过对话级消息存储，跨文章追踪用户偏好（风格、长度、语气、近期主题）。
- **版本管理** — 将每篇生成的文章保存为带标题、内容和元数据的版本化记录。

## 环境变量

| 变量 | 必填 | 说明 |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | 是 | 模型网关 API Key。使用 Makers Models 的 API Key，或任何兼容 OpenAI 协议的提供商 Key。 |
| `AI_GATEWAY_BASE_URL` | 是 | 网关基础地址。使用 Makers Models 时填写 `https://ai-gateway.edgeone.link/v1`。 |
| `AI_GATEWAY_MODEL` | 否 | 模型 ID，默认为 `@makers/deepseek-v4-flash`。 |

本模板遵循 OpenAI 兼容标准 —— 可指向 Makers Models 或任何兼容提供商。

### 如何获取 AI_GATEWAY_API_KEY

1. 打开 Makers 控制台（https://edgeone.ai/makers/new?s_url=https://console.tencentcloud.com/edgeone/makers）
2. 登录并启用 Makers
3. 进入 Makers → Models → API Key，创建 Key
4. 将其填入 `AI_GATEWAY_API_KEY`

> 内置模型在额度内免费，适合验证；生产环境请绑定自费厂商 Key（BYOK）。

## 本地开发

**前置依赖**
- Node.js 18+
- EdgeOne CLI（`npm i -g edgeone`）

```bash
npm install
cp .env.example .env
# 编辑 .env，填入 AI_GATEWAY_API_KEY 与 AI_GATEWAY_BASE_URL
edgeone makers dev
```

本地可观测面板地址：http://localhost:8088/agent-metrics。

## 项目结构

```
content-creator-agent/
├── agents/
│   ├── create.ts           # POST /create —— 完整文章创作（带记忆）
│   ├── create-lite.ts      # POST /create-lite —— 轻量模式
│   ├── outline.ts          # POST /outline —— 结构化大纲生成
│   ├── refine.ts           # POST /refine —— 文章润色
│   ├── research.ts         # POST /research —— 主题背景研究
│   ├── optimize.ts         # POST /optimize —— SEO 优化
│   ├── suggest-keywords.ts # POST /suggest-keywords —— 关键词建议
│   ├── test.ts             # POST /test
│   ├── stop.ts             # POST /stop —— 中止运行
│   └── _shared.ts          # 模型初始化、环境校验、SSE 辅助函数
├── cloud-functions/
│   ├── articles/           # 文章版本持久化
│   ├── preferences/        # 用户偏好存储
│   ├── health/             # GET /health
│   └── _logger.ts
├── app/                    # Next.js App Router 前端
├── lib/
│   └── i18n.tsx            # 中 / 英翻译
└── edgeone.json            # EdgeOne 部署配置
```

以 `_` 为前缀的文件是私有模块，不会作为公共路由暴露。

## 工作原理

### 运行模式
`agents/` 下的文件以**会话模式**运行：相同 `conversation_id` 的请求会被粘性路由到同一 Agent 实例。这保证了用户记忆和对话上下文在后续消息中始终可用。

### 端到端流程

1. **输入收集** —— 前端 POST `/create`，携带主题、关键词、风格、长度和可选参考资料。
2. **记忆加载** —— Agent 从对话级消息存储中加载先前保存的用户偏好（风格、语气、需避免的模式）。
3. **研究（可选）** —— 如启用，通过平台 `web_search` 工具执行单次联网搜索，收集背景材料。
4. **大纲生成** —— 大纲 Agent 根据请求长度产出结构化层级（`##` 章节含 `###` 子章节）。
5. **文章起草** —— 创建 Agent 在单次流式运行中产出完整文章，遵循大纲、字数目标和已加载的用户偏好。
6. **后处理** —— 文章可通过 `/refine` 润色、`/optimize` SEO 优化或 `/suggest-keywords` 关键词分析进行单独调用处理。
7. **持久化** —— 最终文章通过 `cloud-functions/articles/` 保存为版本化记录；用户偏好通过 `cloud-functions/preferences/` 更新。

### 关键路由与参数
- `/create` —— 完整文章创作。Body：`{ topic, keywords, style, length, language }`。
- `/create-lite` —— 轻量模式，参数更少。
- `/outline` —— 仅生成大纲。
- `/refine` —— 润色已有文章。
- `/optimize` —— SEO 分析与建议。
- `/suggest-keywords` —— 关键词推荐。
- `/stop` —— 中止活跃运行。Body：`{ conversation_id }`。
- `conversation_id` 由前端生成，通过 `makers-conversation-id` Header 传入；运行时会自动绑定到 `context.conversation_id`。

### 超时配置
`edgeone.json` 中未自定义 Agent 超时，使用平台默认值。模型客户端内部超时为 300 秒。

## 相关资源

- [Makers Agents 文档](https://cloud.tencent.com/document/product/1552/132759)
- [Makers 快速开始](https://cloud.tencent.com/document/product/1552/132786)
- [Makers Models](https://cloud.tencent.com/document/product/1552/132748)

## 许可证

MIT
