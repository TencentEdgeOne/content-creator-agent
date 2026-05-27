/**
 * Research Agent
 * Researches topics using web search and provides structured summaries.
 */
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

function createSearchTool(contextTools: any) {
    const webSearchTool = contextTools?.get?.('web_search');

    return tool(
        async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
            logger.log(`search_topic: "${query}"`);

            if (webSearchTool) {
                try {
                    const result = await webSearchTool.execute({ query, maxResults });
                    return typeof result === 'string' ? result : JSON.stringify(result);
                } catch (e) {
                    logger.error('web_search failed:', (e as Error).message);
                }
            }

            // Fallback
            return JSON.stringify([
                { title: `Research: ${query}`, url: `https://scholar.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Academic research on ${query}.` },
                { title: `${query} - Industry Report`, url: `https://reports.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Industry analysis with market data.` },
                { title: `Expert Analysis: ${query}`, url: `https://analysis.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Expert analysis covering trends and opportunities.` },
            ].slice(0, maxResults));
        },
        {
            name: 'search_topic',
            description: 'Search for academic and industry research on a topic.',
            schema: z.object({
                query: z.string().describe('The research query'),
                maxResults: z.number().optional().default(5),
            }),
        }
    );
}

let agent: Agent | null = null;
let lastContextTools: any = null;

function getAgent(modelInstance: Model, contextTools: any) {
    // Recreate agent if context.tools changed
    if (!agent || lastContextTools !== contextTools) {
        lastContextTools = contextTools;
        agent = createDeepAgent({
            model: modelInstance,
            systemPrompt: SYSTEM_PROMPT,
            tools: [createSearchTool(contextTools)],
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
    const { request, env, tools: contextTools } = context;

    const { topic } = request?.body ?? {};
    if (!topic) {
        return new Response('Missing topic', { status: 400 });
    }

    const signal = request?.signal as AbortSignal | undefined;
    let agentInstance: Agent;
    try {
        const envVars = getAgentEnv(env);
        const modelInstance = await createModel(envVars);
        agentInstance = getAgent(modelInstance, contextTools);
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
        cancel() { logger.log('Client disconnected'); },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
}
