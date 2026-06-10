# Content Creator

**Language:** English | [简体中文](./README_zh-CN.md)

AI-powered content creation assistant with real web search, outline generation, article writing, SEO analysis, and version management. Built on DeepAgents + LangChain and deployed on EdgeOne Makers.

**Framework:** None (raw Node.js) · **Category:** Content · **Language:** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.tencentcloud.com/edgeone/makers/new?template=content-creator-edgeone&from=within&fromAgent=1&agentLang=typescript)

<!-- TODO: confirm -->
![preview](./assets/preview.png)

## Overview

This template streamlines long-form content creation from topic to publishable article. It researches topics via live web search, generates structured outlines for human review, writes full articles in either a lightweight or deep-agent mode, and provides SEO scoring and section-level refinement. All article versions and user preferences are persisted across sessions.

- **Research-Driven Writing** — Uses real web search to gather up-to-date references before drafting.
- **Human-in-the-Loop Outlines** — The AI generates a structured outline; the user reviews and edits it before the writing phase begins.
- **Dual Generation Modes** — Lite mode (low-token manual tool loop) for speed, or DeepAgent mode (full framework with memory) for richer personalization.
- **SEO & Refinement** — Automated keyword-density, readability, and heading-structure analysis; refine individual sections or the full article on demand.
- **Version Management** — Articles and user preferences are persisted to Blob storage, enabling history rollback and cross-session continuity.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Model gateway API key. Use your Makers Models API Key, or any OpenAI-compatible provider key. |
| `AI_GATEWAY_BASE_URL` | Yes | Gateway base URL. For Makers Models, use `https://ai-gateway.edgeone.link/v1`. |
| `BLOB_PROJECT_ID` | No | Pages project ID for Blob storage (article history & preferences). |
| `BLOB_TOKEN` | No | API token for Blob storage. |

This template follows the OpenAI-compatible standard — point these at Makers Models or any compatible provider.

### How to get AI_GATEWAY_API_KEY

1. Open the Makers Console (https://console.cloud.tencent.com/edgeone/makers)
2. Sign in and enable Makers
3. Go to Makers → Models → API Key and create a key
4. Copy it into `AI_GATEWAY_API_KEY`

> Built-in models are free within quota and great for validation. For production, bind your own paid provider key (BYOK).

## Local Development

**Prerequisites**
- Node.js 18+
- EdgeOne CLI (`npm i -g @edgeone/cli`)

```bash
npm install
cp .env.example .env
# Edit .env with your AI_GATEWAY_API_KEY and AI_GATEWAY_BASE_URL
edgeone makers dev
```

Open the local observability dashboard at http://localhost:8080/agent-metrics.

## Project Structure

```
content-creator-agent/
├── agents/
│   ├── _shared.ts              # Model init, env validation, logger
│   ├── create.ts               # POST /create — DeepAgent mode writing (SSE)
│   ├── create-lite.ts          # POST /create-lite — Lite mode writing (SSE)
│   ├── outline.ts              # POST /outline — structured outline generation (JSON)
│   ├── optimize.ts             # POST /optimize — SEO analysis (JSON)
│   ├── refine.ts               # POST /refine — article editing (SSE)
│   ├── research.ts             # POST /research — standalone research agent (SSE)
│   ├── stop.ts                 # POST /stop — abort active run
│   ├── suggest-keywords.ts     # POST /suggest-keywords — keyword suggestions (JSON)
│   └── test.ts                 # POST /test — model connectivity test
├── cloud-functions/
│   ├── articles/               # POST /articles — article CRUD + versioning
│   ├── health/                 # GET /health
│   └── preferences/            # POST /preferences — user preferences read/write
├── app/                        # Next.js App Router frontend
├── components/                 # UI components (editor, SEO panel, history, export)
├── lib/
│   └── i18n.tsx                # Chinese / English translations
└── edgeone.json                # EdgeOne deployment config
```

Files prefixed with `_` are private modules — not exposed as public routes.

## How It Works

### Runtime Mode
Agents under `agents/` run as **stateless HTTP handlers** by default. The writing endpoints (`/create`, `/create-lite`, `/refine`, `/research`) return Server-Sent Events (SSE) for real-time streaming. Outline, optimization, and keyword endpoints return JSON directly.

### End-to-End Workflow

1. **Topic input** — The user enters a topic; the frontend calls `/suggest-keywords` to get SEO keyword ideas.
2. **Outline generation** — The frontend calls `/outline` with the topic, keywords, style, and target length. The agent returns a structured JSON outline (title, sections, key points, word counts).
3. **Human review** — The user edits the outline in the UI and confirms.
4. **Article writing** —
   - **Lite mode** (`/create-lite`): a lightweight `bindTools` loop calls `search_web` once, then streams the full article with minimal token overhead.
   - **DeepAgent mode** (`/create`): a full DeepAgent loop with user memory (style, length, tone preferences) and structured system prompts for richer output.
5. **SEO analysis** — After writing, the frontend calls `/optimize` to score keyword density, readability, and heading structure.
6. **Refinement** — The user selects a section or the full article and calls `/refine` with an instruction; the agent streams the updated text.
7. **Persistence** — Article versions are saved to Blob via `/articles`; user preferences are persisted via `/preferences`.

### Key Routes & Parameters
- `/outline` — Accepts `{ topic, keywords, style, length }`, returns `{ outline, usage }`.
- `/create` and `/create-lite` — Accept `{ message, topic, keywords, style, length, outline }`, stream `ai_response`, `tool_call`, `tool_result`, and `usage` events.
- `/refine` — Accepts `{ article, instruction, section }`, streams updated text.
- `/optimize` — Accepts `{ content, keywords }`, returns SEO JSON.
- `/stop` — Cancels the active SSE stream for a conversation.

### Timeouts
No custom agent timeout is configured; the platform default applies.

## Resources

- [Makers Agents Documentation](https://edgeone.ai/makers)
- [Makers Quick Start](https://edgeone.ai/makers/docs/quickstart)
- [Makers Models](https://console.cloud.tencent.com/edgeone/makers/models)

## License

MIT
