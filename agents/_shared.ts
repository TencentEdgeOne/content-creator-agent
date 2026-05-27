/**
 * Shared utilities for all agent endpoints.
 * Centralizes model initialization and environment config.
 */
import { initChatModel } from 'langchain';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const MODEL_NAME = '@makers/deepseek-v4-flash';

export interface AgentEnv {
    AI_GATEWAY_API_KEY: string;
    AI_GATEWAY_BASE_URL: string;
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
    };
}

/** Initialize a chat model. Caches per base URL to avoid re-initialization. */
const modelCache = new Map<string, Model>();

export async function createModel(env: AgentEnv, options?: { timeout?: number }): Promise<Model> {
    const cacheKey = `${MODEL_NAME}:${env.AI_GATEWAY_BASE_URL}`;

    if (modelCache.has(cacheKey)) {
        return modelCache.get(cacheKey)!;
    }

    const model = await initChatModel(MODEL_NAME, {
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
