/**
 * Content Creation Agent — Pure Lite Mode (No DeepAgent)
 *
 * 彻底移除 createDeepAgent，原因:
 * - 自动注入 14 个内置工具定义 → +30k input tokens 开销
 * - 内部规划逻辑覆盖 system prompt → 模型不听指令
 * - 多次搜索无法控制 → 51k tokens 吞掉无输出
 *
 * 新架构:
 * ┌─────────────────────────────────────────────────────────┐
 * │ 全部走 bindTools 手动循环:                                │
 * │ short/medium: 搜索1次 → 直接写                           │
 * │ long: 搜索1次 → 生成大纲 → 按大纲写全文                    │
 * │                                                         │
 * │ 搜索工具自带调用计数器：第2次起返回空，从根本上杜绝多搜        │
 * └─────────────────────────────────────────────────────────┘
 *
 * Token 预估:
 * - short: ~800-1200 tokens (1次模型调用，无搜索工具绑定)
 * - medium: ~1500-2500 tokens (2次调用: 搜索+写)
 * - long: ~3000-5000 tokens (3次调用: 搜索+大纲+写)
 */
import { initChatModel } from 'langchain';
import { tool } from 'langchain';
import { z } from 'zod';
import { HumanMessage, AIMessage, ToolMessage as LCToolMessage } from '@langchain/core/messages';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const logger = createLogger('create');

// ============================================================
// Memory Layer — via context.store (EdgeOne Pages 原生存储)
// ============================================================
interface UserMemory {
    userId: string;
    defaultStyle: string;
    defaultLength: string;
    defaultLanguage: string;
    recentTopics: string[];
    recentKeywords: string[];
    customInstructions: string;
    totalArticles: number;
    preferredStructure: string;
    avoidPatterns: string[];
    toneNotes: string;
}

async function loadUserMemory(store: any, userId: string): Promise<UserMemory | null> {
    if (!store) return null;
    try {
        const conversationId = `user-prefs-${userId}`;
        const messages = await store.getMessages({ conversationId, limit: 1, order: 'desc' });
        if (messages.length > 0 && messages[0].content) {
            const content = messages[0].content;
            return typeof content === 'string' ? JSON.parse(content) : content;
        }
        return null;
    } catch (e) {
        logger.error('Failed to load memory:', (e as Error).message);
        return null;
    }
}

async function recordUsage(store: any, userId: string, topic: string, keywords?: string, style?: string, length?: string) {
    if (!store) return;
    try {
        const conversationId = `user-prefs-${userId}`;
        let prefs: any = { userId, totalArticles: 0, recentTopics: [], recentKeywords: [] };
        try {
            const messages = await store.getMessages({ conversationId, limit: 1, order: 'desc' });
            if (messages.length > 0 && messages[0].content) {
                const content = messages[0].content;
                prefs = typeof content === 'string' ? JSON.parse(content) : content;
            }
        } catch {}

        if (topic) prefs.recentTopics = [topic, ...(prefs.recentTopics || []).filter((t: string) => t !== topic)].slice(0, 10);
        if (keywords) {
            const newKws = keywords.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
            prefs.recentKeywords = [...new Set([...newKws, ...(prefs.recentKeywords || [])])].slice(0, 20);
        }
        if (style) prefs.defaultStyle = style;
        if (length) prefs.defaultLength = length;
        prefs.totalArticles = (prefs.totalArticles || 0) + 1;
        prefs.lastActiveAt = new Date().toISOString();

        try { await store.clearMessages({ conversationId }); } catch {}
        await store.appendMessage({
            conversationId, userId, role: 'system',
            content: JSON.stringify(prefs),
            metadata: { type: 'preferences', updatedAt: prefs.lastActiveAt },
        });
        logger.log(`Recorded usage for ${userId} (total: ${prefs.totalArticles})`);
    } catch (e) {
        logger.error('Failed to record usage:', (e as Error).message);
    }
}

// ============================================================
// System Prompt — 精简中文，带结构模板
// ============================================================
function buildSystemPrompt(memory: UserMemory | null, articleLength: string): string {
    let prompt = `你是专业内容创作者。日期：${new Date().toISOString().slice(0, 10)}。

## 文章结构（必须严格遵守）

\`\`\`
# 标题

引言（2-3句，点题+文章价值）

## 章节一
导入语

### 子标题1.1
段落内容（3-5句，有论据/数据/案例）

### 子标题1.2
段落内容

## 章节二
...（同上结构）

## 总结与展望
结语段落
\`\`\`

每个 ## 下必须有 2-3 个 ### 子节。禁止全文只用 ## 平铺。

## 长度：${articleLength}
${articleLength === 'short' ? '~1000字，4-5个##，每##含2个###' : articleLength === 'long' ? '~5000字，10-12个##，每##含3-4个###' : '~2500字，6-8个##，每##含2-3个###'}

语言：与用户话题一致。中文按汉字计，必须达到目标字数。`;

    if (memory && memory.totalArticles > 0) {
        const parts: string[] = [];
        if (memory.defaultStyle && memory.defaultStyle !== 'informative') parts.push(`风格：${memory.defaultStyle}`);
        if (memory.toneNotes) parts.push(`语气：${memory.toneNotes}`);
        if (memory.customInstructions) parts.push(memory.customInstructions);
        if (memory.avoidPatterns?.length) parts.push(`避免：${memory.avoidPatterns.join('、')}`);
        if (parts.length > 0) prompt += `\n\n用户偏好：${parts.join('；')}`;
    }

    return prompt;
}

// ============================================================
// Search Tool — 带调用计数器，从根本上杜绝多次搜索
// ============================================================
function createSearchTool() {
    let callCount = 0;

    return tool(
        async ({ query }: { query: string }) => {
            callCount++;
            if (callCount > 1) {
                logger.log(`search_web blocked (call #${callCount}): "${query}"`);
                return '已搜索过，请直接使用已有信息写文章。';
            }
            logger.log(`search_web: "${query}"`);

            // TODO: 接入真实搜索 (DuckDuckGo / EdgeOne Search API)
            const results = [
                `[1] ${query}的最新研究：该领域最新研究进展与专家观点综合分析。`,
                `[2] ${query}全面指南：涵盖基础原理、最佳实践与进阶策略。`,
                `[3] ${query}深度解读：行业专家解读，包含趋势分析与未来预测。`,
            ];
            return results.join('\n');
        },
        {
            name: 'search_web',
            description: '搜索网络信息（仅限调用一次）',
            schema: z.object({ query: z.string().describe('搜索关键词') }),
        }
    );
}

// ============================================================
// Core Stream — 统一的手动循环（取代 createDeepAgent）
// ============================================================
async function* generateStream(modelInstance: Model, userMessage: string, systemPrompt: string, signal?: AbortSignal): AsyncGenerator<string> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // 每次请求创建新的 search tool 实例（重置计数器）
    const searchTool = createSearchTool();
    const tools = [searchTool];
    const toolMap: Record<string, typeof searchTool> = { search_web: searchTool };

    try {
        logger.log(`Starting: "${userMessage.slice(0, 80)}"`);
        const modelWithTools = modelInstance.bindTools(tools);
        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            new HumanMessage(userMessage),
        ];
        let searchDone = false;

        // 最多 3 轮: [搜索] → [写文章] → [兜底]
        for (let i = 0; i < 3; i++) {
            if (signal?.aborted) break;

            // 搜索完成后解绑工具 → 模型只能输出文本
            const activeModel = searchDone ? modelInstance : modelWithTools;
            const stream = await activeModel.stream(messages);
            let fullContent = '';
            let toolCalls: any[] = [];

            for await (const chunk of stream) {
                if (signal?.aborted) break;
                const msg = chunk as any;

                // Token 统计
                if (msg?.usage_metadata) {
                    totalInputTokens += msg.usage_metadata.input_tokens || 0;
                    totalOutputTokens += msg.usage_metadata.output_tokens || 0;
                }
                if (msg?.response_metadata?.usage) {
                    totalInputTokens += msg.response_metadata.usage.prompt_tokens || 0;
                    totalOutputTokens += msg.response_metadata.usage.completion_tokens || 0;
                }

                // 工具调用
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

                // 文本输出 → 直接流式返回
                if (msg?.text) {
                    fullContent += msg.text;
                    const cleaned = msg.text.replace(/\n{3,}/g, '\n\n');
                    if (cleaned) yield `data: ${JSON.stringify({ type: 'ai_response', content: cleaned })}\n\n`;
                }
            }

            // 有文本且无工具调用 → 完成
            if (fullContent && toolCalls.length === 0) break;

            // 处理工具调用
            if (toolCalls.length > 0) {
                const validCalls = toolCalls.filter(tc => tc.name);
                const aiMsg = new AIMessage({
                    content: fullContent || '',
                    tool_calls: validCalls.map(tc => ({
                        name: tc.name,
                        args: JSON.parse(tc.args || '{}'),
                        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    })),
                });
                messages.push(aiMsg);

                // 只执行第一个调用，其余返回空
                for (let j = 0; j < aiMsg.tool_calls!.length; j++) {
                    const tc = aiMsg.tool_calls![j];
                    if (j === 0) {
                        yield `data: ${JSON.stringify({ type: 'tool_call', name: tc.name })}\n\n`;
                        const toolFn = toolMap[tc.name];
                        if (toolFn) {
                            const result = await (toolFn as any).invoke(tc.args);
                            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                            yield `data: ${JSON.stringify({ type: 'tool_result', name: tc.name, content: resultStr })}\n\n`;
                            messages.push(new LCToolMessage({ content: resultStr, tool_call_id: tc.id || '' }));
                        }
                    } else {
                        messages.push(new LCToolMessage({ content: '已搜索过，请直接写文章。', tool_call_id: tc.id || '' }));
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
            // 正常中断
        } else if (error.message?.includes('terminated')) {
            logger.log('Stream terminated by runtime');
        } else {
            logger.error('Error:', error.message);
            yield `data: ${JSON.stringify({ type: 'error_message', content: error.message })}\n\n`;
        }
    }

    logger.log(`Tokens — input: ${totalInputTokens}, output: ${totalOutputTokens}, total: ${totalInputTokens + totalOutputTokens}`);
    yield `data: ${JSON.stringify({ type: 'usage', input_tokens: totalInputTokens, output_tokens: totalOutputTokens, total_tokens: totalInputTokens + totalOutputTokens })}\n\n`;
    yield "data: [DONE]\n\n";
}

// ============================================================
// Request Handler
// ============================================================
export async function onRequest(context: any) {
    const { request, env, store } = context;
    const { message, topic, keywords, style, length = 'medium', outline, userId = 'default' } = request?.body ?? {};

    let userMessage = message || '';
    if (topic) {
        userMessage = `写一篇关于「${topic}」的文章`;
        if (keywords) userMessage += `\n关键词：${keywords}`;
        if (style) userMessage += `\n风格：${style}`;
        if (length) userMessage += `\n长度：${length}`;
        if (outline?.sections) {
            userMessage += `\n\n按以下大纲写作：`;
            userMessage += `\n标题：${outline.title}`;
            for (const section of outline.sections) {
                userMessage += `\n- ${section.heading}：${(section.keyPoints || []).join('、')}`;
            }
        }
    }

    if (!userMessage) return new Response('Missing message or topic', { status: 400 });

    const signal = request?.signal as AbortSignal | undefined;

    // 1. 加载用户记忆
    const memory = await loadUserMemory(store, userId);
    if (memory) logger.log(`Memory loaded: ${userId}, ${memory.totalArticles} articles`);

    // 2. 构建 prompt
    const systemPrompt = buildSystemPrompt(memory, length);
    logger.log(`Prompt: ${systemPrompt.length} chars`);

    // 3. 初始化模型
    let modelInstance: Model;
    try {
        modelInstance = await createModel(getAgentEnv(env));
    } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }

    // 4. 流式生成
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
        async start(controller) {
            const heartbeat = setInterval(() => {
                try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`)); } catch {}
            }, 5_000);
            try {
                for await (const chunk of generateStream(modelInstance, userMessage, systemPrompt, signal)) {
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

            // 5. 异步记录使用（不阻塞响应）
            recordUsage(store, userId, topic || message?.slice(0, 50), keywords, style, length).catch(() => {});
        },
        cancel() { logger.log('Client disconnected'); },
    });

    return new Response(readable, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
}
