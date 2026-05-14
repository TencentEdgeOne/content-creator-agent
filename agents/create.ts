/**
 * Content Creation Agent
 *
 * Uses createDeepAgent from deepagents framework with enhanced system prompt
 * to guide the model through the content creation workflow.
 *
 * Note: createDeepAgent automatically includes built-in tools (write_todos,
 * filesystem, task). We instruct the model to focus on search_web and text
 * output, and filter built-in tool events in the stream.
 */
import { initChatModel, AIMessageChunk, ToolMessage } from 'langchain';
import { createDeepAgent } from 'deepagents';
import { tool } from 'langchain';
import { z } from 'zod';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;
type Agent = ReturnType<typeof createDeepAgent>;

const logger = createLogger('create');

// Aggressive system prompt to override deepagents' built-in tool instructions
const SYSTEM_PROMPT = `You are a professional content creator. Today's date is ${new Date().toISOString().slice(0, 10)}.

## YOUR TASK
Write a complete article based on the user's topic. Follow these steps:
1. Call search_web ONCE to research the topic
2. Write the COMPLETE article directly in your response text

## CRITICAL RULES — READ CAREFULLY
- After calling search_web, you MUST write the article as plain text in your next message
- Do NOT call write_todos — planning is unnecessary for this task
- Do NOT call any filesystem tools (ls, read_file, write_file, edit_file, glob, grep, execute)
- Do NOT call the task tool — no subagents needed
- Do NOT save the article to a file — output it directly as text
- These tools exist for other use cases. For content creation, ONLY use search_web then write text.

## OUTPUT FORMAT
- Markdown with ## or ### headings, paragraphs, lists
- Write in the same language as the user's topic
- For Chinese topics: count by Chinese characters (汉字). For English: count by words.
- Follow the target length strictly:
  - "short" ≈ 1000 Chinese characters OR 800 English words, 4-5 sections
  - "medium" ≈ 2500 Chinese characters OR 2000 English words, 6-8 sections
  - "long" ≈ 5000 Chinese characters OR 4000 English words, 10-15 sections
- This is VERY IMPORTANT: Do NOT write less than the target. If "medium", write AT LEAST 2500 Chinese characters.`;

// Built-in tool names from deepagents — filter these from stream output
const BUILTIN_TOOLS = new Set([
    'write_todos', 'ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute',
    'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task', 'list_async_tasks',
    'task',
]);

let agent: Agent | null = null;

const searchWeb = tool(
    async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
        logger.log(`search_web called: "${query}"`);
        const mockResults = [
            { title: `Latest Research on ${query}`, url: `https://research.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Comprehensive analysis of ${query} with recent findings and expert opinions.` },
            { title: `${query}: A Complete Guide`, url: `https://guide.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Everything you need to know about ${query}. Covers fundamentals, best practices, and advanced strategies.` },
            { title: `Expert Insights: ${query}`, url: `https://experts.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Industry experts share perspectives on ${query}, including trends and future predictions.` },
            { title: `${query} Statistics & Data 2024`, url: `https://data.example.com/${query.replace(/\s+/g, '-')}`, snippet: `Key statistics and data points about ${query}. Updated with latest market research.` },
            { title: `How ${query} is Changing the Industry`, url: `https://industry.example.com/${query.replace(/\s+/g, '-')}`, snippet: `In-depth look at how ${query} is transforming business practices.` },
        ];
        return JSON.stringify(mockResults.slice(0, maxResults));
    },
    {
        name: 'search_web',
        description: 'Search the web for information. Call this ONCE before writing the article.',
        schema: z.object({
            query: z.string().describe('Search query'),
            maxResults: z.number().optional().default(5).describe('Max results'),
        }),
    }
);

function getAgent(modelInstance: Model) {
    if (!agent) {
        logger.log('Initializing deep agent...');
        agent = createDeepAgent({
            model: modelInstance,
            systemPrompt: SYSTEM_PROMPT,
            tools: [searchWeb],
        });
    }
    return agent;
}

async function* eventStream(agentInstance: Agent, userMessage: string, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let hasTextOutput = false;

    try {
        logger.log(`Starting stream: "${userMessage.slice(0, 80)}"`);
        const stream = await agentInstance.stream(
            { messages: [{ role: "user", content: userMessage }] } as any,
            { streamMode: "messages", signal }
        );

        for await (const chunk of stream) {
            if (signal?.aborted) break;
            const [rawMessage] = chunk;
            const message = rawMessage as any;

            // Track tokens
            if (message?.usage_metadata) {
                totalInputTokens += message.usage_metadata.input_tokens || 0;
                totalOutputTokens += message.usage_metadata.output_tokens || 0;
            }
            if (message?.response_metadata?.usage) {
                totalInputTokens += message.response_metadata.usage.prompt_tokens || 0;
                totalOutputTokens += message.response_metadata.usage.completion_tokens || 0;
            }

            // AI tool calls — only emit user-defined tools
            if (AIMessageChunk.isInstance(rawMessage) && message.tool_call_chunks?.length) {
                for (const tc of message.tool_call_chunks) {
                    if (tc.name && !BUILTIN_TOOLS.has(tc.name)) {
                        yield `data: ${JSON.stringify({ type: 'tool_call', name: tc.name })}\n\n`;
                    }
                }
                continue;
            }

            // Tool results — only emit user-defined tools
            if (ToolMessage.isInstance(rawMessage)) {
                const toolName = message.name;
                if (toolName && !BUILTIN_TOOLS.has(toolName)) {
                    yield `data: ${JSON.stringify({ type: 'tool_result', name: toolName, content: message.text?.slice(0, 500) })}\n\n`;
                }
                continue;
            }

            // AI text output — the article content
            if (AIMessageChunk.isInstance(rawMessage) && message.text) {
                const cleaned = message.text.replace(/\n{3,}/g, '\n\n');
                if (cleaned) {
                    hasTextOutput = true;
                    yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
                }
            }
        }

        if (!hasTextOutput) {
            logger.error('No text output from agent — model may have used built-in tools instead');
            yield `data: ${JSON.stringify({ type: 'error_message', content: 'Generation produced no article text. The model may need to be retried.' })}\n\n`;
        }

        logger.log('Stream completed');
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'AbortError' || signal?.aborted) {
            logger.log('Aborted');
        } else if (error.message?.includes('terminated')) {
            logger.log('Stream terminated by runtime (content already delivered)');
        } else {
            logger.error('Stream error:', error.message);
            yield `data: ${JSON.stringify({ type: 'error_message', content: `Error: ${error.message}` })}\n\n`;
        }
    }

    logger.log(`Tokens - input: ${totalInputTokens}, output: ${totalOutputTokens}`);
    yield `data: ${JSON.stringify({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens })}\n\n`;
    yield "data: [DONE]\n\n";
}

export async function onRequest(context: any) {
    const { request, env } = context;

    const { message, topic, keywords, style, length, outline } = request?.body ?? {};

    let userMessage = message || '';
    if (topic) {
        userMessage = `Create an article about: "${topic}"`;
        if (keywords) userMessage += `\nTarget keywords: ${keywords}`;
        if (style) userMessage += `\nWriting style: ${style}`;
        if (length) userMessage += `\nTarget length: ${length}`;
        if (outline && outline.sections) {
            userMessage += `\n\nFollow this confirmed outline:`;
            userMessage += `\nTitle: ${outline.title}`;
            for (const section of outline.sections) {
                userMessage += `\n- ${section.heading}: ${(section.keyPoints || []).join('; ')}`;
            }
        }
    }

    if (!userMessage) {
        return new Response('Missing message or topic', { status: 400 });
    }

    const signal = request?.signal as AbortSignal | undefined;

    let agentInstance: Agent;
    try {
        const envVars = getAgentEnv(env);
        const modelInstance = await createModel(envVars);
        agentInstance = getAgent(modelInstance);
    } catch (e) {
        const msg = (e as Error).message;
        logger.error(msg);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }

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
            } catch (e) {
                const error = e as Error;
                if (error.name !== 'AbortError' && !signal?.aborted) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`));
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
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
