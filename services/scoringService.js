'use strict';

const { GoogleGenAI } = require('@google/genai');

// Gemma 4 model names via Gemini API:
//   gemma-4-31b-it       — dense 31B (best quality, was the "27B" slot in Gemma 3)
//   gemma-4-26b-a4b-it   — 26B Mixture-of-Experts (faster, similar quality)
//   gemma-4-e4b-it       — edge 4B (lightweight)
const MODEL = process.env.GEMMA_MODEL || 'gemma-4-31b-it';

let genAI = null;
function getClient() {
    if (!genAI) {
        const key = process.env.GOOGLE_AI_API_KEY;
        if (!key) throw new Error('GOOGLE_AI_API_KEY not set');
        genAI = new GoogleGenAI({ apiKey: key });
    }
    return genAI;
}

// ─── System prompt ────────────────────────────────────────────────────────────
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

// ─── Main scoring function ────────────────────────────────────────────────────
/**
 * Score a message using Gemma 4. Falls back to 0 on API failure.
 * @param {string} content Raw message text
 * @returns {Promise<number>} Score 0–100
 */
async function scoreMessage(content) {
    if (!content?.trim()) return 0;

    try {
        const result = await getClient().models.generateContent({
            model: MODEL,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature:       0.1,   // low temp = consistent scores
                maxOutputTokens:   80,
            },
            contents: `Rate this message: "${content}"`,
        });
        const raw = result.text.trim();

        // Strip accidental markdown fences
        const clean  = raw.replace(/^```(?:json)?|```$/gm, '').trim();
        const parsed = JSON.parse(clean);

        const score = Math.min(100, Math.max(0, Math.round(Number(parsed.score))));
        console.log(`[Gemma] ${score}/100 — ${parsed.reason}`);
        return score;

    } catch (err) {
        console.error('[Gemma] Scoring error, returning 0:', err.message);
        return 0;
    }
}

// ─── Mention extractor (unchanged) ───────────────────────────────────────────
function extractTargetId(content) {
    const match = content.match(/<@!?(\d+)>/);
    return match ? match[1] : null;
}

module.exports = { scoreMessage, extractTargetId };
