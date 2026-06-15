# Content Creator Agent

AI-driven content creation assistant that researches topics, generates structured outlines, and writes streaming articles with SEO analysis, version management, and persistent memory. Built on Deep Agents and deployed on EdgeOne Makers.

**Framework:** Deep Agents · **Category:** Content · **Language:** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=content-creator-agent&from=within&fromAgent=1&agentLang=typescript)

## Overview

This template orchestrates a full content creation pipeline — from topic research to polished article — through a multi-stage agent workflow. It uses LangChain-powered agents with structured prompts, accumulates user preferences across sessions, and stores article versions for retrieval and comparison.

- **Topic Research** — Optionally searches the web once per request for background material before writing.
- **Structured Outlining** — Generates a hierarchical outline with `##` sections and `###` subsections before drafting.
- **Streaming Article Writing** — Produces the full article in a single streaming run with word-count targets and style adherence.
- **SEO & Keyword Tools** — Dedicated endpoints for SEO optimization and keyword suggestions.
- **Persistent Memory** — Tracks user preferences (style, length, tone, recent topics) across articles via conversation-scoped message storage.
- **Version Management** — Saves each generated article as a versioned record with title, content, and metadata.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Model gateway API key. Use your Makers Models API Key, or any OpenAI-compatible provider key. |
| `AI_GATEWAY_BASE_URL` | Yes | Gateway base URL. For Makers Models, use `https://ai-gateway.edgeone.link/v1`. |
| `AI_GATEWAY_MODEL` | No | Model ID. Defaults to `@makers/deepseek-v4-flash`. |

This template follows the OpenAI-compatible standard — point these at Makers Models or any compatible provider.

### How to get AI_GATEWAY_API_KEY

1. Open the Makers Console (https://edgeone.ai/makers/new?s_url=https://console.tencentcloud.com/edgeone/makers)
2. Sign in and enable Makers
3. Go to Makers → Models → API Key and create a key
4. Copy it into `AI_GATEWAY_API_KEY`

> Built-in models are free within quota and great for validation. For production, bind your own paid provider key (BYOK).

## Local Development

**Prerequisites**
- Node.js 18+
- EdgeOne CLI (`npm i -g edgeone`)

```bash
npm install
cp .env.example .env
# Edit .env with your AI_GATEWAY_API_KEY and AI_GATEWAY_BASE_URL
edgeone makers dev
```

Open the local observability dashboard at http://localhost:8088/agent-metrics.

## Project Structure

```
content-creator-agent/
├── agents/
│   ├── create.ts           # POST /create — full article creation with memory
│   ├── create-lite.ts      # POST /create-lite — lightweight mode
│   ├── outline.ts          # POST /outline — structured outline generation
│   ├── refine.ts           # POST /refine — article polishing
│   ├── research.ts         # POST /research — topic background research
│   ├── optimize.ts         # POST /optimize — SEO optimization
│   ├── suggest-keywords.ts # POST /suggest-keywords
│   ├── test.ts             # POST /test
│   ├── stop.ts             # POST /stop — abort active run
│   └── _shared.ts          # Model init, env validation, SSE helpers
├── cloud-functions/
│   ├── articles/           # Article version persistence
│   ├── preferences/        # User preference storage
│   ├── health/             # GET /health
│   └── _logger.ts
├── app/                    # Next.js App Router frontend
├── lib/
│   └── i18n.tsx            # Chinese / English translations
└── edgeone.json            # EdgeOne deployment config
```

Files prefixed with `_` are private modules — not exposed as public routes.

## How It Works

### Runtime Mode
Files under `agents/` run in **session mode**: requests with the same `conversation_id` are sticky-routed to the same agent instance. This ensures user memory and conversation context persist across follow-up messages.

### End-to-End Workflow

1. **Input collection** — The frontend POSTs `/create` with topic, keywords, style, length, and optional reference material.
2. **Memory load** — The agent loads previously stored user preferences (style, tone, avoid-patterns) from conversation-scoped message storage.
3. **Research (optional)** — If enabled, a single web search is executed via the platform `web_search` tool to gather background material.
4. **Outline generation** — An outline agent produces a structured hierarchy (`##` sections with `###` subsections) tailored to the requested length.
5. **Article drafting** — The create agent streams the full article in one run, respecting the outline, word-count target, and loaded user preferences.
6. **Post-processing** — The article can be refined (`/refine`), SEO-optimized (`/optimize`), or keyword-analyzed (`/suggest-keywords`) in separate calls.
7. **Persistence** — The final article is saved as a versioned record via `cloud-functions/articles/`; user preferences are updated via `cloud-functions/preferences/`.

### Key Routes & Parameters
- `/create` — Full article creation. Body: `{ topic, keywords, style, length, language }`.
- `/create-lite` — Lightweight mode with fewer parameters.
- `/outline` — Generates an outline only.
- `/refine` — Polishes an existing article.
- `/optimize` — SEO analysis and suggestions.
- `/suggest-keywords` — Keyword recommendations.
- `/stop` — Aborts the active run. Body: `{ conversation_id }`.
- `conversation_id` is generated client-side and forwarded via the `makers-conversation-id` header; the runtime auto-binds it to `context.conversation_id`.

### Timeouts
No custom agent timeout is configured in `edgeone.json`; the platform default applies. The model client uses a 300-second internal timeout.

## Resources

- [Makers Agents Documentation](https://pages.edgeone.ai/document/agents)
- [Makers Quick Start](https://pages.edgeone.ai/document/agents-quick-start)
- [Makers Models](https://pages.edgeone.ai/document/models)

## License

MIT
