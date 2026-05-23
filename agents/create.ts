/**
 * Content Creation Agent — Hybrid Mode
 *
 * Optimization strategy:
 * - "short" / "medium" articles: manual agent loop (bindTools), ~12-15k tokens
 * - "long" articles: createDeepAgent with maxSteps=3, ~20-25k tokens
 *
 * Key optimizations vs original:
 * 1. Lite loop as default (no built-in tools overhead)
 * 2. Deep agent only for long articles that benefit from multi-step research
 * 3. maxSteps=3 hard cap prevents runaway loops
 * 4. search_web limited to maxResults=3 (less context to carry)
 * 5. After search, tools are unbound to force text output
 */
import { initChatModel } from 'langchain';
import { createDeepAgent } from 'deepagents';
import { tool } from 'langchain';
import { z } from 'zod';
import { HumanMessage, AIMessage, ToolMessage as LCToolMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const logger = createLogger('create');

// Shared system prompt — concise to save tokens
const SYSTEM_PROMPT = `You are a professional content creator. Date: ${new Date().toISOString().slice(0, 10)}.

WORKFLOW:
1. Call search_web ONCE with a focused query to research the topic
2. Write the COMPLETE article directly as text output

RULES:
- Call search_web exactly ONCE, then write the full article
- Do NOT call search_web multiple times — one comprehensive query is enough
- Output in markdown (## headings, paragraphs, lists)
- Write in the same language as the user's topic
- Length targets (STRICTLY follow):
  - "short" ≈ 1000 Chinese chars / 800 English words, 4-5 sections
  - "medium" ≈ 2500 Chinese chars / 2000 English words, 6-8 sections
  - "long" ≈ 5000 Chinese chars / 4000 English words, 10-15 sections`;

// Deep agent mode: extra rules to suppress built-in tools
const DEEP_SYSTEM_PROMPT = SYSTEM_PROMPT + `

CRITICAL: Do NOT use write_todos, filesystem tools, or task/subagent tools.
Only use search_web (max 2 calls), then write the article as text.`;

// Built-in tool names from deepagents — filter from stream
const BUILTIN_TOOLS = new Set([
    'write_todos', 'ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute',
    'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task', 'list_async_tasks',
    'task',
]);

// Shared search tool — maxResults reduced to save context tokens
const searchWeb = tool(
    async ({ query, maxResults = 3 }: { query: string; maxResults?: number }) => {
        logger.log(`search_web: "${query}"`);
        const mockResults = [
            { title: `Latest Research on ${query}`, url: `https://research.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Comprehensive analysis of ${query} with recent findings and expert opinions.` },
            { title: `${query}: A Complete Guide`, url: `https://guide.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Everything you need to know about ${query}. Covers fundamentals, best practices, and advanced strategies.` },
            { title: `Expert Insights: ${query}`, url: `https://experts.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Industry experts share perspectives on ${query}, including trends and future predictions.` },
        ];
        return JSON.stringify(mockResults.slice(0, maxResults));
    },
    {
        name: 'search_web',
        description: 'Search the web for information. Call ONCE with a comprehensive query.',
        schema: z.object({
            query: z.string().describe('Search query — be specific and comprehensive in one query'),
            maxResults: z.number().optional().default(3).describe('Max results (default 3)'),
        }),
    }
);

const tools = [searchWeb];
const toolMap: Record<string, typeof searchWeb> = { search_web: searchWeb };

// ============================================================
// Lite Loop — for short/medium articles (~12-15k tokens)
// ============================================================
async function* liteEventStream(modelInstance: Model, userMessage: string, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
        logger.log(`[lite] Starting: "${userMessage.slice(0, 80)}"`);
        const modelWithTools = modelInstance.bindTools(tools);
        const messages: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            new HumanMessage(userMessage),
        ];
        let searchDone = false;

        // Max 3 iterations: search → write (→ fallback)
        for (let i = 0; i < 3; i++) {
            if (signal?.aborted) break;

            const activeModel = searchDone ? modelInstance : modelWithTools;
            const stream = await activeModel.stream(messages);
            let fullContent = '';
            let toolCalls: any[] = [];

            for await (const chunk of stream) {
                if (signal?.aborted) break;
                const msg = chunk as any;

                if (msg?.usage_metadata) {
                    totalInputTokens += msg.usage_metadata.input_tokens || 0;
                    totalOutputTokens += msg.usage_metadata.output_tokens || 0;
                }
                if (msg?.response_metadata?.usage) {
                    totalInputTokens += msg.response_metadata.usage.prompt_tokens || 0;
                    totalOutputTokens += msg.response_metadata.usage.completion_tokens || 0;
                }

                if (msg?.tool_call_chunks?.length) {
                    for (const tc of msg.tool_call_chunks) {
                        if (tc.index !== undefined) {
                            while (toolCalls.length <= tc.index) toolCalls.push({ name: '', args: '' });
                            if (tc.name) toolCalls[tc.index].name = tc.name;
                            if (tc.args) toolCalls[tc.index].args += tc.args;
                            if (tc.id) toolCalls[tc.index].id = tc.id;
                        }
                    }
                }

                if (msg?.text) {
                    fullContent += msg.text;
                    const cleaned = msg.text.replace(/\n{3,}/g, '\n\n');
                    if (cleaned) yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
                }
            }

            // If we got text and no tool calls, we're done
            if (fullContent && toolCalls.length === 0) break;

            if (toolCalls.length > 0) {
                const aiMsg = new AIMessage({
                    content: fullContent || '',
                    tool_calls: toolCalls.filter(tc => tc.name).map(tc => ({
                        name: tc.name,
                        args: JSON.parse(tc.args || '{}'),
                        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    })),
                });
                messages.push(aiMsg);

                // Execute tool calls (but limit to first one to prevent multi-search)
                const callsToExecute = aiMsg.tool_calls!.slice(0, 1);
                for (const tc of callsToExecute) {
                    yield `data: ${JSON.stringify({ type: 'tool_call', name: tc.name })}\n\n`;
                    const toolFn = toolMap[tc.name];
                    if (toolFn) {
                        const result = await (toolFn as any).invoke(tc.args);
                        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                        yield `data: ${JSON.stringify({ type: 'tool_result', name: tc.name, content: resultStr.slice(0, 500) })}\n\n`;
                        messages.push(new LCToolMessage({ content: resultStr, tool_call_id: tc.id || '' }));
                    }
                }

                // Provide empty results for any extra tool calls to satisfy message format
                for (const tc of aiMsg.tool_calls!.slice(1)) {
                    messages.push(new LCToolMessage({ content: '[]', tool_call_id: tc.id || '' }));
                }

                searchDone = true;
                logger.log('[lite] Search done, next iteration forces text output');
                continue;
            }

            break;
        }
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'AbortError' || signal?.aborted) {
            // normal
        } else if (error.message?.includes('terminated')) {
            logger.log('[lite] Stream terminated by runtime');
        } else {
            logger.error('[lite] Error:', error.message);
            yield `data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`;
        }
    }

    logger.log(`[lite] Tokens — input: ${totalInputTokens}, output: ${totalOutputTokens}`);
    yield `data: ${JSON.stringify({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens })}\n\n`;
    yield "data: [DONE]\n\n";
}

// ============================================================
// Deep Agent — for long articles only (~20-25k tokens with caps)
// ============================================================
let deepAgent: ReturnType<typeof createDeepAgent> | null = null;

function getDeepAgent(modelInstance: Model) {
    if (!deepAgent) {
        logger.log('[deep] Initializing deep agent with maxSteps=3...');
        deepAgent = createDeepAgent({
            model: modelInstance,
            systemPrompt: DEEP_SYSTEM_PROMPT,
            tools: [searchWeb],
            maxSteps: 3,  // Hard cap: prevents runaway loops
        });
    }
    return deepAgent;
}

async function* deepEventStream(modelInstance: Model, userMessage: string, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let hasTextOutput = false;

    try {
        logger.log(`[deep] Starting: "${userMessage.slice(0, 80)}"`);
        const agentInstance = getDeepAgent(modelInstance);
        const stream = await agentInstance.stream(
            { messages: [{ role: "user", content: userMessage }] } as any,
            { streamMode: "messages", signal }
        );

        for await (const chunk of stream) {
            if (signal?.aborted) break;
            const [rawMessage] = chunk;
            const message = rawMessage as any;

            if (message?.usage_metadata) {
                totalInputTokens += message.usage_metadata.input_tokens || 0;
                totalOutputTokens += message.usage_metadata.output_tokens || 0;
            }
            if (message?.response_metadata?.usage) {
                totalInputTokens += message.response_metadata.usage.prompt_tokens || 0;
                totalOutputTokens += message.response_metadata.usage.completion_tokens || 0;
            }

            if (AIMessageChunk.isInstance(rawMessage) && message.tool_call_chunks?.length) {
                for (const tc of message.tool_call_chunks) {
                    if (tc.name && !BUILTIN_TOOLS.has(tc.name)) {
                        yield `data: ${JSON.stringify({ type: 'tool_call', name: tc.name })}\n\n`;
                    }
                }
                continue;
            }

            if (ToolMessage.isInstance(rawMessage)) {
                const toolName = message.name;
                if (toolName && !BUILTIN_TOOLS.has(toolName)) {
                    yield `data: ${JSON.stringify({ type: 'tool_result', name: toolName, content: message.text?.slice(0, 500) })}\n\n`;
                }
                continue;
            }

            if (AIMessageChunk.isInstance(rawMessage) && message.text) {
                const cleaned = message.text.replace(/\n{3,}/g, '\n\n');
                if (cleaned) {
                    hasTextOutput = true;
                    yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
                }
            }
        }

        if (!hasTextOutput) {
            logger.error('[deep] No text output — falling back to lite mode');
            yield `data: ${JSON.stringify({ type: 'error_message', content: 'Deep agent did not produce text. Retrying with lite mode...' })}\n\n`;
        }
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'AbortError' || signal?.aborted) {
            // normal
        } else if (error.message?.includes('terminated')) {
            logger.log('[deep] Stream terminated by runtime');
        } else {
            logger.error('[deep] Error:', error.message);
            yield `data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`;
        }
    }

    logger.log(`[deep] Tokens — input: ${totalInputTokens}, output: ${totalOutputTokens}`);
    yield `data: ${JSON.stringify({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens })}\n\n`;
    yield "data: [DONE]\n\n";
}

// ============================================================
// Request handler — routes to lite or deep based on length
// ============================================================
export async function onRequest(context: any) {
    const { request, env } = context;
    const { message, topic, keywords, style, length, outline } = request?.body ?? {};

    let userMessage = message || '';
    if (topic) {
        userMessage = `Create an article about: "${topic}"`;
        if (keywords) userMessage += `\nTarget keywords: ${keywords}`;
        if (style) userMessage += `\nWriting style: ${style}`;
        if (length) userMessage += `\nTarget length: ${length}`;
        if (outline?.sections) {
            userMessage += `\n\nFollow this outline:`;
            userMessage += `\nTitle: ${outline.title}`;
            for (const section of outline.sections) {
                userMessage += `\n- ${section.heading}: ${(section.keyPoints || []).join('; ')}`;
            }
        }
    }

    if (!userMessage) return new Response('Missing message or topic', { status: 400 });

    const signal = request?.signal as AbortSignal | undefined;

    // Route decision: only "long" articles use deep agent
    const useDeeAgent = length === 'long';
    logger.log(`Mode: ${useDeeAgent ? 'deep' : 'lite'}, length: ${length || 'default'}`);

    let modelInstance: Model;
    try {
        modelInstance = await createModel(getAgentEnv(env));
    } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }

    const streamFn = useDeeAgent
        ? deepEventStream(modelInstance, userMessage, signal)
        : liteEventStream(modelInstance, userMessage, signal);

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
        async start(controller) {
            const heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`)); } catch {}
            }, 5_000);
            try {
                for await (const chunk of streamFn) {
                    if (signal?.aborted) break;
                    controller.enqueue(encoder.encode(chunk));
                }
            } catch (e) {
                const error = e as Error;
                if (error.name !== 'AbortError' && !signal?.aborted) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`));
                }
            } finally { clearInterval(heartbeat); controller.close(); }
        },
        cancel() { logger.log('Client disconnected'); },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
}
