/**
 * Research Agent
 * Researches topics using web search and provides structured summaries.
 */
import { initChatModel, AIMessageChunk, ToolMessage, tool } from 'langchain';
import { modelRetryMiddleware, modelCallLimitMiddleware } from 'langchain';
import { createDeepAgent } from 'deepagents';
import { getAgentEnv, createModel, createLogger, sseEvent, createSSEResponse } from './_shared';

/**
 * Strip DSML/tool-call markup that sometimes leaks into DeepSeek model output.
 * SOP F-117: stripDSML is applied to all outgoing text (mandatory for DeepSeek family).
 */
function stripDSML(text: string): string {
    return text
        .replace(/<\/?[｜|]*[Dd][Ss][Mm][Ll][｜|]*[^>]*>/g, '')
        .replace(/<\/?(tool_calls|invoke|parameter)[^>]*>/g, '');
}

type Model = Awaited<ReturnType<typeof initChatModel>>;
type Agent = ReturnType<typeof createDeepAgent>;

const logger = createLogger('research');

const SYSTEM_PROMPT = `You are a research assistant. Today's date is ${new Date().toISOString().slice(0, 10)}.
Your job is to research topics thoroughly and summarize findings in a structured way.
Use the web_search tool to find relevant information, then synthesize it into a clear research summary with:
- Key findings
- Important statistics or data points
- Expert opinions
- Sources referenced`;

let agent: Agent | null = null;
let lastContextTools: any = null;

function getAgent(modelInstance: Model, contextTools: any) {
    // Recreate agent if context.tools changed
    if (!agent || lastContextTools !== contextTools) {
        lastContextTools = contextTools;
        // SOP: DeepAgents use toLangChainTools(tool) — returns LangChain StructuredTool[]
        // all() returns raw {name,schema,invoke} which is not StructuredTool
        const tools = contextTools?.toLangChainTools?.(tool) ?? [];
        agent = createDeepAgent({
            model: modelInstance,
            systemPrompt: SYSTEM_PROMPT,
            tools: tools,
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
                    if (tc.name) yield sseEvent({ type: 'tool_call', name: tc.name });
                }
                continue;
            }
            if (ToolMessage.isInstance(message)) {
                yield sseEvent({ type: 'tool_result', name: message.name, content: message.text?.slice(0, 500) });
                continue;
            }
            if (AIMessageChunk.isInstance(message) && message.text) {
                // SOP F-117: strip DSML from all outgoing text (DeepSeek family)
                const stripped = stripDSML(message.text).replace(/\n{3,}/g, '\n\n');
                if (stripped) yield sseEvent({ type: 'ai_response', content: stripped });
            }
        }
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name !== 'AbortError' && !signal?.aborted) {
            yield sseEvent({ type: 'error_message', content: error.message });
        }
    }
    // SOP D-85: usage event (token accounting) at end of stream
    yield sseEvent({ type: 'usage', input_tokens: 0, output_tokens: 0, total_tokens: 0 });
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
    const generator = (s?: AbortSignal) => eventStream(agentInstance, userMessage, s);
    return createSSEResponse(generator, signal);
}
