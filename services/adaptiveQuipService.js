'use strict';

const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';

let genAI = null;
function getClient() {
    if (!genAI) {
        const key = process.env.GOOGLE_AI_API_KEY;
        if (!key) throw new Error('GOOGLE_AI_API_KEY not set');
        genAI = new GoogleGenAI({ apiKey: key });
    }
    return genAI;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const TEXT_QUIP_SYSTEM = `You are "Rizzless", a brutally sarcastic Discord moderation bot that publicly calls out flirtatious messages in real time.

Write a SHORT public callout for the flirty message you are given. Rules:
- Reference something SPECIFIC from what they said — quote or closely paraphrase a key phrase so it's obvious you read it
- Dry, unimpressed, and mocking — like a bored hall monitor who has seen it all
- 1–2 sentences MAX, no more
- Discord-casual language; one emoji is fine if it lands naturally
- Do NOT open with generic lines like "Rizz detected", "Flirting alert", or "Someone's feeling flirty"
- The tone should be embarrassing for the sender, not encouraging

Respond with ONLY the callout text — no quotes around it, no explanation.`;

const VOICE_QUIP_SYSTEM = `You are "Rizzless", a brutally sarcastic Discord moderation bot that calls people out live in voice chat via text-to-speech.

Write a SHORT spoken callout for the flirty thing the user just said. Rules:
- Reference something SPECIFIC from what they said — paraphrase a key phrase so it's clear you were listening
- Dry, deadpan delivery — like a stern announcer reading from a cringe log
- 1–2 sentences MAX
- No emojis (this is spoken aloud via TTS — they render badly)
- Do NOT say "flirting detected", "rizz alert", or other generic openers
- Make it embarrassing, not encouraging

Respond with ONLY the callout text — no quotes, no preamble.`;

// ─── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate a context-aware quip referencing what the user actually said.
 *
 * @param {string}  content   - The flirty message or transcribed speech
 * @param {number}  score     - Flirt score 0–100
 * @param {string}  username  - Discord username (for logging)
 * @param {boolean} isVoice   - true = no emojis, spoken cadence
 * @returns {Promise<string|null>} - Quip text, or null on failure (caller should use static fallback)
 */
async function generateAdaptiveQuip(content, score, username, isVoice = false) {
    if (!content?.trim()) return null;

    try {
        const system = isVoice ? VOICE_QUIP_SYSTEM : TEXT_QUIP_SYSTEM;
        const result = await getClient().models.generateContent({
            model: MODEL,
            config: {
                systemInstruction: system,  // Gemma 4 native system prompt support
                temperature:       0.88,
                maxOutputTokens:   120,
            },
            contents: `User "${username}" said: "${content}"\nFlirt intensity: ${score}/100\n\nCallout:`,
        });

        const quip = result.text?.trim();
        if (!quip) throw new Error('Empty response from model');

        console.log(`[AdaptiveQuip] ${isVoice ? '🎤' : '💬'} "${content.slice(0, 50)}" → "${quip}"`);
        return quip;

    } catch (err) {
        console.error('[AdaptiveQuip] Generation failed, caller should use static fallback:', err.message);
        return null;
    }
}

module.exports = { generateAdaptiveQuip };
