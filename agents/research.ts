import { initChatModel, AIMessageChunk, ToolMessage, tool } from 'langchain';
import { modelRetryMiddleware, modelCallLimitMiddleware } from 'langchain';
import { createDeepAgent } from 'deepagents';
import { z } from 'zod';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;
type Agent = ReturnType<typeof createDeepAgent>;

const logger = createLogger('research');

const SYSTEM_PROMPT = `You are a research assistant. Today's date is ${new Date().toISOString().slice(0, 10)}.
Your job is to research topics thoroughly and summarize findings in a structured way.
Use search_topic to find relevant information, then synthesize it into a clear research summary with:
- Key findings
- Important statistics or data points
- Expert opinions
- Sources referenced`;

let agent: Agent | null = null;

const searchTopic = tool(
    async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
        const results = [
            { title: `Research: ${query}`, url: `https://scholar.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Academic research covering the latest developments in ${query}.` },
            { title: `${query} - Industry Report 2024`, url: `https://reports.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Comprehensive industry analysis with market data and forecasts.` },
            { title: `Expert Analysis: ${query}`, url: `https://analysis.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Expert-level analysis covering trends, challenges, and opportunities.` },
            { title: `${query} Case Studies`, url: `https://cases.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Real-world case studies demonstrating practical applications and results.` },
            { title: `The Future of ${query}`, url: `https://future.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Forward-looking analysis of where ${query} is heading in the next 5 years.` },
        ];
        return JSON.stringify(results.slice(0, maxResults));
    },
    {
        name: 'search_topic',
        description: 'Search for academic and industry research on a topic.',
        schema: z.object({
            query: z.string().describe('The research query'),
            maxResults: z.number().optional().default(5).describe('Maximum number of results'),
        }),
    }
);

function getAgent(modelInstance: Model) {
    if (!agent) {
        agent = createDeepAgent({
            model: modelInstance,
            systemPrompt: SYSTEM_PROMPT,
            tools: [searchTopic],
            middleware: [
                modelRetryMiddleware({ maxRetries: 3 }),
                modelCallLimitMiddleware({ runLimit: 20 }),
            ],
        });
    }
    return agent;
}

async function* eventStream(agentInstance: Agent, userMessage: string, signal?: AbortSignal): AsyncGenerator<string> {
    try {
        const stream = await agentInstance.stream(
            { messages: [{ role: "user", content: userMessage }] },
            { streamMode: "messages", signal }
        );

        for await (const chunk of stream) {
            if (signal?.aborted) break;
            const [message] = chunk;

            if (AIMessageChunk.isInstance(message) && message.tool_call_chunks?.length) {
                for (const tc of message.tool_call_chunks) {
                    if (tc.name) yield `data: ${JSON.stringify({ type: 'tool_call', name: tc.name })}\n\n`;
                }
                continue;
            }
            if (ToolMessage.isInstance(message)) {
                yield `data: ${JSON.stringify({ type: 'tool_result', name: message.name, content: message.text?.slice(0, 500) })}\n\n`;
                continue;
            }
            if (AIMessageChunk.isInstance(message) && message.text) {
                const cleaned = message.text.replace(/\n{3,}/g, '\n\n');
                if (cleaned) yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
            }
        }
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name !== 'AbortError' && !signal?.aborted) {
            yield `data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`;
        }
    }
    yield "data: [DONE]\n\n";
}

export async function onRequest(context: any) {
    const { request, env, conversation_id: conversationId, run_id: runId } = context;
    logger.log('conversationId:', conversationId, 'runId:', runId);

    const { topic } = request?.body ?? {};
    if (!topic) {
        return new Response('Missing topic', { status: 400 });
    }

    const signal = request?.signal as AbortSignal | undefined;
    let agentInstance: Agent;
    try {


        const envVars = getAgentEnv(env);
        const modelInstance = await createModel(envVars);
        agentInstance = getAgent(modelInstance);
    } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }

    const userMessage = `Research the following topic thoroughly and provide a structured summary: "${topic}"`;
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
        async start(controller) {
            const heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`)); } catch {}
            }, 5_000);
            try {
                for await (const chunk of eventStream(agentInstance, userMessage, signal)) {
                    if (signal?.aborted) break;
                    controller.enqueue(encoder.encode(chunk));
                }
            } finally {
                clearInterval(heartbeat);
                controller.close();
            }
        },
        cancel() { logger.log('client disconnected'); },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
}
