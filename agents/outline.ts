/**
 * Outline Generation Agent (Human-in-the-Loop)
 *
 * Generates a structured article outline that the user can review,
 * edit, and confirm before proceeding to full article generation.
 * This implements the "human-in-the-loop" pattern from deepagents:
 * the agent proposes a plan, the human approves/modifies it.
 */
import { initChatModel } from 'langchain';
import { HumanMessage } from '@langchain/core/messages';
import { getAgentEnv, createModel, createLogger } from './_shared';

type Model = Awaited<ReturnType<typeof initChatModel>>;

const logger = createLogger('outline');

const SYSTEM_PROMPT = `You are an article outline planner. Given a topic and preferences, generate a structured outline.

OUTPUT FORMAT (strict JSON):
{
  "title": "Article title",
  "summary": "One-line summary of the article's angle",
  "sections": [
    {
      "heading": "Section heading",
      "keyPoints": ["point 1", "point 2"],
      "estimatedWords": 200
    }
  ],
  "estimatedTotalWords": 1000,
  "tone": "informative|persuasive|technical|casual"
}

RULES:
- Generate 4-15 sections based on requested length
- Each section should have 2-4 key points
- Headings should be specific and engaging
- The outline should tell a coherent story
- Match the tone to the requested style
- Target word counts: short=1000 Chinese chars/800 English words, medium=2500 Chinese chars/2000 English words, long=5000 Chinese chars/4000 English words
- Output ONLY valid JSON, no markdown fences or extra text`;

export async function onRequest(context: any) {
    const { request, env } = context;
    const { topic, keywords, style, length } = request?.body ?? {};

    if (!topic) {
        return new Response(JSON.stringify({ error: 'Missing topic' }), {
            status: 400, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }

    try {
        const envVars = getAgentEnv(env);
        const modelInstance = await createModel(envVars, { timeout: 60_000 });

        const userMessage = [
            `Topic: "${topic}"`,
            keywords ? `Keywords: ${keywords}` : '',
            `Style: ${style || 'informative'}`,
            `Target length: ${length || 'medium'} (short=500w, medium=1000w, long=2000w)`,
            `Language: Write in the same language as the topic`,
        ].filter(Boolean).join('\n');

        logger.log(`Generating outline for: "${topic}"`);

        const response = await modelInstance.invoke([
            { role: 'system', content: SYSTEM_PROMPT },
            new HumanMessage(userMessage),
        ]);

        const text = (response as any).text || (response as any).content || '';
        logger.log('Raw outline response:', text.slice(0, 200));

        // Parse JSON from response (handle potential markdown fences)
        let outline: any;
        try {
            const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            outline = JSON.parse(jsonStr);
        } catch {
            // If JSON parse fails, return raw text for frontend to handle
            logger.error('Failed to parse outline JSON, returning raw');
            outline = {
                title: topic,
                summary: 'Auto-generated outline',
                sections: [{ heading: 'Introduction', keyPoints: ['Overview'], estimatedWords: 200 }],
                estimatedTotalWords: 500,
                tone: style || 'informative',
                raw: text,
            };
        }

        // Track usage
        const usage = (response as any).usage_metadata || (response as any).response_metadata?.usage || {};
        const tokenUsage = {
            input_tokens: usage.input_tokens || usage.prompt_tokens || 0,
            output_tokens: usage.output_tokens || usage.completion_tokens || 0,
        };

        return new Response(JSON.stringify({ outline, usage: tokenUsage }), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    } catch (e) {
        const msg = (e as Error).message;
        logger.error(msg);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500, headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }
}
