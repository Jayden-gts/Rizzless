'use strict';

const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
console.log(`[Gemma] Using model: ${MODEL}`);

let genAI = null;
function getClient() {
    if (!genAI) {
        const key = process.env.GOOGLE_AI_API_KEY;
        if (!key) throw new Error('GOOGLE_AI_API_KEY not set');
        genAI = new GoogleGenAI({ apiKey: key });
    }
    return genAI;
}

const SYSTEM_PROMPT = `You are a flirt detection system for a Discord moderation bot.
Analyze messages for flirtatious, romantic, or e-dating behaviour and rate them 0–100.

Scoring guide:
  0–20  : Completely neutral, no romantic intent
  21–40 : Slightly warm, could just be friendly
  41–60 : Noticeably flirty or affectionate
  61–80 : Clearly flirtatious, romantic intent obvious
  81–100: Extremely flirtatious, overtly romantic or suggestive

Consider full context, subtext, tone, implication, and emotional language — not just keywords.
A message like "you're literally all I need rn" is very high even without classic flirt words.

Respond with ONLY valid JSON, no markdown, no explanation:
{"score": <integer 0-100>, "reason": "<one short sentence>"}`;

async function scoreMessage(content) {
    if (!content?.trim()) return 0;

    try {
        const result = await getClient().models.generateContent({
            model: MODEL,
            config: {
                systemInstruction: SYSTEM_PROMPT,  // Gemma 4 native system prompt support
                temperature:       0.1,
                maxOutputTokens:   500,
            },
            contents: `Rate this message: "${content}"`,
        });

        const raw = result.text?.trim();
        if (!raw) { console.error('[Gemma] Empty response'); return 0; }

        console.log('[Gemma] Raw:', raw);

        // Extract score even from truncated/malformed JSON
        const scoreMatch = raw.match(/"score"\s*:\s*(\d+)/);
        if (!scoreMatch) { console.error('[Gemma] No score found:', raw); return 0; }

        const score = Math.min(100, Math.max(0, Math.round(Number(scoreMatch[1]))));
        const reasonMatch = raw.match(/"reason"\s*:\s*"([^"]+)"/);
        console.log(`[Gemma] ${score}/100 — ${reasonMatch?.[1] ?? 'no reason'}`);
        return score;

    } catch (err) {
        console.error('[Gemma] Scoring error, returning 0:', err.message);
        return 0;
    }
}

function extractTargetId(content) {
    const match = content.match(/<@!?(\d+)>/);
    return match ? match[1] : null;
}

module.exports = { scoreMessage, extractTargetId };
