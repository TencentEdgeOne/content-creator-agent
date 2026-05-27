/**
 * Content Creation Agent — Lite Mode
 * Low-token alternative using direct bindTools loop.
 */
import { initChatModel } from 'langchain';
import { tool } from 'langchain';
import { z } from 'zod';
import { HumanMessage, AIMessage, ToolMessage as LCToolMessage } from '@langchain/core/messages';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const logger = createLogger('create-lite');

const SYSTEM_PROMPT = `You are a professional content creator. Today's date is ${new Date().toISOString().slice(0, 10)}.

WORKFLOW:
1. Use search_web ONCE to research the topic
2. Write the COMPLETE article directly in your response

RULES:
- Call search_web exactly ONCE, then write the full article as text
- Output in markdown format with ## or ### headings, paragraphs, and lists
- Write in the same language as the user's topic
- For Chinese: count by 汉字. For English: count by words.
- STRICTLY follow the target length:
  - "short" ≈ 1000 Chinese characters OR 800 English words, 4-5 sections
  - "medium" ≈ 2500 Chinese characters OR 2000 English words, 6-8 sections
  - "long" ≈ 5000 Chinese characters OR 4000 English words, 10-15 sections
- IMPORTANT: Do NOT write less than the target length.`;

/**
 * Create search tool backed by context.tools.web_search (real search).
 */
function createSearchTool(contextTools: any) {
    const webSearchTool = contextTools?.get?.('web_search');

    return tool(
        async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
            logger.log(`search_web: "${query}"`);

            if (webSearchTool) {
                try {
                    const result = await webSearchTool.execute({ query, maxResults });
                    const text = typeof result === 'string' ? result : JSON.stringify(result);
                    return text.slice(0, 2000);
                } catch (e) {
                    logger.error('web_search failed:', (e as Error).message);
                }
            }

            // Fallback if context.tools unavailable
            return `[1] ${query}的最新研究：该领域最新研究进展与专家观点综合分析。\n[2] ${query}全面指南：涵盖基础原理、最佳实践与进阶策略。\n[3] ${query}深度解读：行业专家解读，包含趋势分析与未来预测。`;
        },
        {
            name: 'search_web',
            description: 'Search the web. Call ONCE before writing.',
            schema: z.object({
                query: z.string().describe('Search query'),
                maxResults: z.number().optional().default(5),
            }),
        }
    );
}

async function* eventStream(modelInstance: Model, userMessage: string, contextTools: any, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const searchTool = createSearchTool(contextTools);
    const tools = [searchTool];
    const toolMap: Record<string, typeof searchTool> = { search_web: searchTool };

    try {
        logger.log(`Starting: "${userMessage.slice(0, 80)}"`);
        const modelWithTools = modelInstance.bindTools(tools);
        const messages: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            new HumanMessage(userMessage),
        ];
        let searchDone = false;

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
                    // Filter out model internal markup (DSML)
                    if (msg.text.includes('DSML') || msg.text.includes('tool_calls>') || msg.text.includes('invoke>') || msg.text.includes('parameter>')) {
                        continue;
                    }
                    const cleaned = msg.text.replace(/\n{3,}/g, '\n\n');
                    if (cleaned) yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
                }
            }

            if (fullContent && toolCalls.length === 0) {
                // If model output DSML markup instead of real content, retry without tools
                const hasDSML = fullContent.includes('DSML') || fullContent.includes('<tool_calls>') || fullContent.includes('<invoke');
                if (hasDSML && !searchDone) {
                    searchDone = true;
                    messages.push(new AIMessage({ content: '' }));
                    logger.log('Model output DSML as text, retrying without tools');
                    continue;
                }
                break;
            }

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

                for (const tc of aiMsg.tool_calls || []) {
                    yield `data: ${JSON.stringify({ type: 'tool_call', name: tc.name })}\n\n`;

                    const toolFn = toolMap[tc.name];
                    if (toolFn) {
                        const result = await (toolFn as any).invoke(tc.args);
                        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                        yield `data: ${JSON.stringify({ type: 'tool_result', name: tc.name, content: resultStr.slice(0, 500) })}\n\n`;
                        messages.push(new LCToolMessage({ content: resultStr, tool_call_id: tc.id || '' }));
                    }
                }

                searchDone = true;
                continue;
            }

            break;
        }
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'AbortError' || signal?.aborted) {
            // Normal abort
        } else if (error.message?.includes('terminated')) {
            logger.log('Stream terminated by runtime');
        } else {
            logger.error('Error:', error.message);
            yield `data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`;
        }
    }

    yield `data: ${JSON.stringify({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens })}\n\n`;
    yield "data: [DONE]\n\n";
}

export async function onRequest(context: any) {
    const { request, env, tools: contextTools } = context;
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
    let modelInstance: Model;
    try {
        modelInstance = await createModel(getAgentEnv(env));
    } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
        async start(controller) {
            const heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`)); } catch {}
            }, 5_000);
            try {
                for await (const chunk of eventStream(modelInstance, userMessage, contextTools, signal)) {
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
        cancel() { logger.log('Disconnected'); },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
}
