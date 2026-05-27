# Content Creator - EdgeOne Makers Agent Template

AI-powered content creation assistant with real web search, outline generation, article writing, SEO analysis, and version management.

Built on [EdgeOne Makers](https://edgeone.ai/makers) + [DeepAgents](https://github.com/langchain-ai/deepagents) + [LangChain](https://js.langchain.com/).

## Features

### Core Writing Pipeline
- **Topic Research** — Real web search via `context.tools.web_search` for up-to-date references
- **AI Keyword Suggestions** — Auto-suggest SEO keywords when topic is entered (Tab to accept)
- **Outline Generation (HITL)** — AI generates outline, user reviews and edits before writing
- **Streaming Writing** — SSE real-time streaming output
- **Section Refinement** — Select specific paragraphs for precise editing
- **SEO Analysis** — Keyword density, readability score, heading structure, optimization suggestions

### Agent Features
- **Dual Mode Generation** — Lite mode (low token) and DeepAgent mode (full framework) switchable
- **Human-in-the-Loop** — Outline confirmation flow, user approves AI planning before execution
- **Long-term Memory** — User writing preferences persisted via Pages Memory API
- **Real Web Search** — Powered by `@edgeone/pages-agent-toolkit` `web_search` tool
- **Sub-agent Pipeline** — Research → Outline → Writing → SEO multi-stage agent collaboration

### Other
- **Version Management** — Auto-save versions on each edit, support history rollback
- **Article History** — Blob storage persistence across sessions
- **Export** — Markdown, HTML, plain text copy and .md file download
- **Bilingual Support** — Chinese / English toggle
- **Token Tracking** — Per-stage token consumption statistics
- **Toast Notifications** — Top-right error/success notifications for save failures etc.

## Project Structure

```
content-creator-edgeone/
├── agents/                     # EdgeOne Cloud Functions
│   ├── _shared.ts              # Shared: model init, env vars, logger
│   ├── create.ts               # DeepAgent mode — full agent framework
│   ├── create-lite.ts          # Lite mode — manual Agent Loop, low token
│   ├── outline.ts              # Outline generation (HITL)
│   ├── suggest-keywords.ts     # AI keyword suggestion from topic
│   ├── refine.ts               # Article refinement (full/section)
│   ├── optimize.ts             # SEO optimization
│   ├── research.ts             # Standalone research agent
│   ├── articles.ts             # Article CRUD + version management (Blob)
│   ├── preferences.ts          # User preferences (Pages Memory / Blob)
│   ├── health.ts               # Health check
│   ├── stop.ts                 # Cancel generation
│   └── test.ts                 # Model connectivity test
├── app/                        # Next.js App Router
│   ├── page.tsx                # Main page + multi-step orchestration
│   └── components/
│       ├── topic-form.tsx      # Input form + AI keyword suggestion + mode switch
│       ├── article-editor.tsx  # Editor + version switch
│       ├── outline-card.tsx    # Outline confirm/edit (sticky action bar)
│       ├── refine-bar.tsx      # Section selection + refine instructions
│       ├── article-stats.tsx   # Word count, paragraphs, reading time
│       ├── seo-panel.tsx       # SEO analysis panel
│       ├── article-history.tsx # Article history list + auto-save
│       ├── export-panel.tsx    # Export functionality
│       ├── process-steps.tsx   # Workflow progress visualization
│       └── research-results.tsx # Search results display
├── lib/
│   ├── i18n.tsx                # i18n (Chinese/English)
│   └── utils.ts
├── components/ui/              # Base UI components (Input with ghost text, etc.)
├── edgeone.json                # EdgeOne deployment config
└── .env.example                # Environment variable template
```

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your AI Gateway credentials

# Local development
edgeone makers dev
```

Visit http://localhost:8088

## Dual Mode Architecture

### Lite Mode (Default)

```
User input → /outline (outline) → user confirms → /create-lite (write) → article
```

- Uses `model.bindTools()` + manual Agent Loop
- Single tool (`web_search` via `context.tools`), removed after search to force text output
- Token usage: ~12-15k / article

### DeepAgent Mode

```
User input → /outline (outline) → user confirms → /create (write) → article
```

- Uses manual agent loop with memory layer
- Includes user preference persistence and structured prompts
- Real web search via `context.tools.web_search`
- Token usage: ~20-30k / article

## API Endpoints

| Endpoint | Method | Description | Response |
|----------|--------|-------------|----------|
| `/outline` | POST | Generate article outline | JSON |
| `/create` | POST | DeepAgent mode creation | SSE |
| `/create-lite` | POST | Lite mode creation | SSE |
| `/suggest-keywords` | POST | AI keyword suggestions from topic | JSON |
| `/refine` | POST | Refine article (full/section) | SSE |
| `/optimize` | POST | SEO analysis | JSON |
| `/research` | POST | Standalone research | SSE |
| `/articles` | POST | Article CRUD + versioning | JSON |
| `/preferences` | POST | User preferences read/write | JSON |
| `/health` | GET | Health check | JSON |
| `/test` | POST | Model connectivity test | JSON |

### SSE Event Types

```
ai_response   — Article text content (streaming)
tool_call     — Tool call start
tool_result   — Tool call result
usage         — Token consumption stats
error_message — Error message
ping          — Heartbeat keepalive
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway API Key |
| `AI_GATEWAY_BASE_URL` | Yes | AI Gateway Base URL |
| `PROJECT_ID` | No | Makers project ID (auto-injected on deploy) |
| `EDGEONE_PAGES_API_TOKEN` | No | API token (auto-injected on deploy) |

## Recommended Models

Default: `@makers/deepseek-v4-flash`. To change, update the `MODEL_NAME` constant in `agents/_shared.ts`.

| Model | Best For |
|-------|---------|
| `@makers/deepseek-v4-flash` | **Recommended** — Fast, good instruction following |
| `@makers/minimax-m2.7` | General purpose |
| `@makers/hy3-preview` | General purpose |

## Tech Stack

- **Frontend**: Next.js 16 + React 19 + Tailwind CSS 4
- **Agent**: [deepagents](https://github.com/langchain-ai/deepagents) + [langchain](https://js.langchain.com/)
- **Tools**: [@edgeone/pages-agent-toolkit](https://www.npmjs.com/package/@edgeone/pages-agent-toolkit) (`web_search`)
- **Storage**: [@edgeone/pages-blob](https://www.npmjs.com/package/@edgeone/pages-blob) (articles) + Pages Memory API (preferences)
- **Deployment**: [EdgeOne Makers](https://edgeone.ai/makers)

## Deployment

```bash
edgeone makers deploy
```

## License

MIT
