/**
 * Content Creation Agent — Lite Mode
 * Low-token alternative using direct bindTools loop.
 */
import { initChatModel, tool } from 'langchain';
import { HumanMessage, AIMessage, ToolMessage as LCToolMessage } from '@langchain/core/messages';
import { getAgentEnv, createModel, createLogger, sseEvent, createSSEResponse } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const logger = createLogger('create-lite');

/**
 * Strip DSML/tool-call markup that sometimes leaks into model output.
 * Handles both the standard XML variant and the ｜｜DSML｜｜ full-width-pipe variant.
 */
function stripDSML(text: string): string {
    return text
        // Full-width pipe variant: <｜｜DSML｜｜invoke>, </｜｜DSML｜｜tool_calls>, …
        .replace(/<\/?｜｜DSML｜｜[^>]*>/g, '')
        // ASCII pipe variant: <||DSML||invoke>
        .replace(/<\/?[|][|]DSML[|][|][^>]*>/g, '')
        // Standard XML DSML tags
        .replace(/<\/?(tool_calls|invoke|parameter)[^>]*>/g, '');
}

const SYSTEM_PROMPT = `You are a professional content creator. Today's date is ${new Date().toISOString().slice(0, 10)}.

WORKFLOW:
1. Use web_search ONCE to research the topic
2. Write the COMPLETE article directly in your response

RULES:
- Call web_search exactly ONCE, then write the full article as text
- Output in markdown format. Use this heading hierarchy:
  - # (H1) for the article title (first line only)
  - ## (H2) for main sections (e.g. Introduction, Conclusion, major topic sections)
  - ### (H3) for subsections within a main section
  - #### (H4) for detailed points within a subsection (use sparingly)
  Never use only H2 or only H3 throughout — vary the depth to match content structure.
- Write in the same language as the user's topic
- For Chinese: count by 汉字. For English: count by words.
- STRICTLY follow the target length:
  - "short" ≈ 1000 Chinese characters OR 800 English words, 4-5 sections
  - "medium" ≈ 2500 Chinese characters OR 2000 English words, 6-8 sections
  - "long" ≈ 5000 Chinese characters OR 4000 English words, 10-15 sections
- IMPORTANT: Do NOT write less than the target length.`;

async function* eventStream(modelInstance: Model, userMessage: string, contextTools: any, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // SOP: LangGraph/DeepAgents use toLangChainTools(toolFactory) to get LangChain StructuredTool[]
    // all() returns raw {name,schema,invoke} — needs LangChain tool() wrapper
    const tools: any[] = contextTools?.toLangChainTools?.(tool) ?? [];

    try {
        logger.log(`Starting: "${userMessage.slice(0, 80)}"`);
        const modelWithTools = modelInstance.bindTools(tools);
        const messages: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            new HumanMessage(userMessage),
        ];
        let searchDone = false;

        for (let i = 0; i < 4; i++) {
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
                    // Phase 1 (pre-search): never stream — content may be DSML/thinking text.
                    // Phase 2 (post-search): stream the actual article content.
                    if (searchDone) {
                        const cleaned = stripDSML(msg.text).replace(/\n{3,}/g, '\n\n');
                        if (cleaned) yield sseEvent({ type: 'ai_response', content: cleaned });
                    }
                }
            }

            if (fullContent && toolCalls.length === 0) {
                if (!searchDone) {
                    // Phase 1 produced text but no tool calls — could be DSML or the model
                    // skipped searching. Treat the full content as the article if it looks
                    // substantive; otherwise discard and retry without tools.
                    const hasDSML = fullContent.includes('<tool_calls>') || fullContent.includes('<invoke') || fullContent.includes('<parameter')
                        || fullContent.includes('｜｜DSML｜｜') || fullContent.includes('||DSML||');
                    if (hasDSML) {
                        // DSML detected: extract queries from XML and run the searches manually,
                        // then retry writing without tools (searchDone = true).
                        logger.log('DSML detected in Phase 1 — executing embedded searches');
                        searchDone = true;

                        // Extract <parameter name="query"> values from the DSML
                        const queryMatches = fullContent.matchAll(/<parameter[^>]*name="query"[^>]*>([^<]+)<\/parameter>/g);
                        const queries = [...queryMatches].map(m => m[1].trim()).filter(Boolean);
                        // Deduplicate, take first 3 to keep cost low
                        const uniqueQueries = [...new Set(queries)].slice(0, 3);
                        logger.log(`Found ${uniqueQueries.length} queries in DSML`);

                        const searchResults: string[] = [];
                        for (const q of uniqueQueries) {
                            yield sseEvent({ type: 'tool_call', name: 'web_search' });
                            const toolObj = tools.find((t: any) => t.name === 'web_search');
                            if (toolObj) {
                                const result = await toolObj.invoke({ query: q, maxResults: 5 });
                                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                                yield sseEvent({ type: 'tool_result', name: 'web_search', content: resultStr.slice(0, 500) });
                                searchResults.push(`Query: ${q}\n${resultStr}`);
                            }
                        }

                        // Rebuild messages with search results for the writing pass
                        if (searchResults.length > 0) {
                            const combinedResults = searchResults.join('\n\n---\n\n').slice(0, 4000);
                            // Replace the last HumanMessage with an augmented version
                            const lastHuman = messages[messages.length - 1];
                            const augmented = `${(lastHuman as any).content}\n\nSearch results:\n${combinedResults}`;
                            messages[messages.length - 1] = new HumanMessage(augmented);
                        }
                        continue;
                    }
                    // Model wrote the article without searching — stream it now
                    const cleaned = stripDSML(fullContent).replace(/\n{3,}/g, '\n\n');
                    if (cleaned) yield sseEvent({ type: 'ai_response', content: cleaned });
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
                    yield sseEvent({ type: 'tool_call', name: tc.name });

                    const toolObj = tools.find((t: any) => t.name === tc.name);
                    if (toolObj) {
                        const result = await toolObj.invoke(tc.args);
                        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                        yield sseEvent({ type: 'tool_result', name: tc.name, content: resultStr.slice(0, 500) });
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
            yield sseEvent({ type: 'error_message', content: error.message });
        }
    }

    yield sseEvent({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens });
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

    const generator = (s?: AbortSignal) => eventStream(modelInstance, userMessage, contextTools, s);
    return createSSEResponse(generator, signal);
}