/**
 * Outline Generation Agent
 * Generates a structured article outline for user review before writing.
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
            `Target length: ${length || 'medium'} (short=1000字/800words, medium=2500字/2000words, long=5000字/4000words)`,
            `Language: Write in the same language as the topic`,
        ].filter(Boolean).join('\n');

        logger.log(`Generating outline for: "${topic}"`);

        const response = await modelInstance.invoke([
            { role: 'system', content: SYSTEM_PROMPT },
            new HumanMessage(userMessage),
        ]);

        const rawContent = (response as any).content;
        const text = typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
                ? rawContent.map((c: any) => typeof c === 'string' ? c : c.text || '').join('')
                : String(rawContent || '');
        logger.log('Raw outline response:', text.slice(0, 200));

        // Parse JSON from response (handle markdown fences, leading/trailing text)
        let outline: any;
        try {
            // Strategy 1: strip markdown fences and parse directly
            const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            outline = JSON.parse(jsonStr);
        } catch {
            // Strategy 2: extract the first JSON object from the text
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    outline = JSON.parse(jsonMatch[0]);
                }
            } catch {}
        }

        // Validate parsed outline has required structure
        if (!outline || !Array.isArray(outline.sections) || outline.sections.length === 0) {
            logger.error('Failed to parse outline JSON or invalid structure, returning raw');
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
