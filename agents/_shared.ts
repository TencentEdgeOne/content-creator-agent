/**
 * Shared utilities for all agent endpoints.
 * Centralizes model initialization, environment config, and SSE helpers.
 */
import { initChatModel } from 'langchain';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const DEFAULT_MODEL = '@makers/deepseek-v4-flash';

export interface AgentEnv {
    AI_GATEWAY_API_KEY: string;
    AI_GATEWAY_BASE_URL: string;
    AI_GATEWAY_MODEL?: string;
}

/** Extract and validate required environment variables. */
export function getAgentEnv(contextEnv: Record<string, string | undefined> | undefined): AgentEnv {
    const source = contextEnv ?? {};
    const required = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL'] as const;
    const missing = required.filter((k) => !source[k]?.trim());
    if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    return {
        AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY!,
        AI_GATEWAY_BASE_URL: source.AI_GATEWAY_BASE_URL!,
        AI_GATEWAY_MODEL: source.AI_GATEWAY_MODEL,
    };
}

/** Initialize a chat model. Caches per base URL to avoid re-initialization. */
const modelCache = new Map<string, Model>();

export async function createModel(env: AgentEnv, options?: { timeout?: number }): Promise<Model> {
    const modelName = env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
    const cacheKey = `${modelName}:${env.AI_GATEWAY_BASE_URL}`;

    if (modelCache.has(cacheKey)) {
        return modelCache.get(cacheKey)!;
    }

    const model = await initChatModel(modelName, {
        modelProvider: 'openai',
        apiKey: env.AI_GATEWAY_API_KEY,
        configuration: {
            baseURL: env.AI_GATEWAY_BASE_URL,
        },
        timeout: options?.timeout ?? 300_000,
    });

    modelCache.set(cacheKey, model);
    return model;
}

/** Create a logger with a consistent prefix. */
export function createLogger(name: string) {
    return {
        log(...args: unknown[]) { console.log(`[${name}]`, ...args); },
        error(...args: unknown[]) { console.error(`[${name}]`, ...args); },
    };
}

// ─── SSE Helpers ───
// SOP D 段要求："Use the shared createSSEResponse helper instead of inlining a
// ReadableStream per file"。所有 agent 端点统一走这个 helper。

export function sseEvent(data: Record<string, unknown>): string {
    return `data: ${JSON.stringify(data)}\n\n`;
}

export function createSSEResponse(
    generator: AsyncGenerator<string> | ((signal?: AbortSignal) => AsyncGenerator<string>),
    signal?: AbortSignal
): Response {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
        async start(controller) {
            const heartbeat = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(sseEvent({ type: 'ping', ts: Date.now() })));
                } catch {}
            }, 5_000);
            try {
                const it = typeof generator === 'function' ? generator(signal) : generator;
                for await (const chunk of it) {
                    if (signal?.aborted) break;
                    controller.enqueue(encoder.encode(chunk));
                }
            } catch (e) {
                const error = e as Error;
                if (error.name !== 'AbortError' && !signal?.aborted) {
                    controller.enqueue(encoder.encode(sseEvent({ type: 'error_message', content: error.message })));
                }
            } finally {
                clearInterval(heartbeat);
                controller.close();
            }
        },
        cancel() {},
    });

    return new Response(readable, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
