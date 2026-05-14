/**
 * Article Refinement Agent
 *
 * Uses langchain direct model streaming for efficient article editing.
 * Supports both full-article and section-based refinement modes.
 *
 * Architecture:
 * - Direct model.stream() for minimal token overhead
 * - No tools needed - pure text-in, text-out transformation
 * - Retry logic inspired by deepagents modelRetryMiddleware
 */
import { initChatModel } from 'langchain';
import { HumanMessage } from '@langchain/core/messages';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const logger = createLogger('refine');

const FULL_SYSTEM_PROMPT = `You are an article editor. The user has an existing article and wants you to modify it.

RULES:
- Apply the user's instruction and output the COMPLETE updated article
- Output directly as markdown text
- Preserve the overall structure unless the instruction says otherwise`;

const SECTION_SYSTEM_PROMPT = `You are an article editor focused on a single section.

RULES:
- Modify ONLY the given section according to the instruction
- Keep the same heading level and formatting style
- Return ONLY the modified section content (including the heading)
- Do NOT output the full article`;

async function* eventStream(modelInstance: Model, systemPrompt: string, userMessage: string, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const MAX_RETRIES = 3;

    try {
        logger.log(`Starting refine: "${userMessage.slice(0, 80)}"`);

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            new HumanMessage(userMessage),
        ];

        // Retry logic (modelRetryMiddleware pattern)
        let stream: any = null;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
            try {
                stream = await modelInstance.stream(messages);
                break;
            } catch (e: any) {
                logger.error(`Model call failed (attempt ${retry + 1}/${MAX_RETRIES}):`, e.message);
                if (retry === MAX_RETRIES - 1) throw e;
                await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
            }
        }
        if (!stream) return;

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

            if (msg?.text) {
                const cleaned = msg.text.replace(/\n{3,}/g, '\n\n');
                if (cleaned) {
                    yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
                }
            }
        }
        logger.log('Refine completed');
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'AbortError' || signal?.aborted) {
            logger.log('Aborted');
        } else {
            logger.error('Error:', error.message);
            yield `data: ${JSON.stringify({ type: 'error_message', content: `Error: ${error.message}` })}\n\n`;
        }
    }
    yield `data: ${JSON.stringify({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens })}\n\n`;
    yield "data: [DONE]\n\n";
}

export async function onRequest(context: any) {
    const { request, env } = context;

    const { article, instruction, section } = request?.body ?? {};

    if (!article || !instruction) {
        return new Response(JSON.stringify({ error: 'Missing article or instruction' }), {
            status: 400, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }

    let userMessage: string;
    let systemPrompt: string;

    if (section && section.content && section.title !== undefined) {
        systemPrompt = SECTION_SYSTEM_PROMPT;
        userMessage = `Section to modify:\n\n${section.content}\n\n---\nInstruction: ${instruction}`;
    } else {
        systemPrompt = FULL_SYSTEM_PROMPT;
        userMessage = `Article:\n\n${article}\n\n---\nInstruction: ${instruction}`;
    }

    const signal = request?.signal as AbortSignal | undefined;

    let modelInstance: Model;
    try {
        const envVars = getAgentEnv(env);
        modelInstance = await createModel(envVars);
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
                for await (const chunk of eventStream(modelInstance, systemPrompt, userMessage, signal)) {
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
