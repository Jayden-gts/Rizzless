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

Write a SHORT public callout for the flirty message and/or image you are given. Rules:
- Reference something SPECIFIC from what they said or what's in the image — quote a key phrase, or call out the image content directly so it's obvious you noticed
- If both text and image are flirty, work both into the burn naturally
- If the image flag mentions "adult" or "racy" content, lean into that — they posted something they shouldn't have
- Dry, unimpressed, and mocking — like a bored hall monitor who has seen it all
- 1–2 sentences MAX, no more
- Discord-casual language; one emoji is fine if it lands naturally
- Do NOT open with generic lines like "Rizz detected", "Flirting alert", or "Someone's feeling flirty"
- The tone should be embarrassing for the sender, not encouraging

Respond with ONLY the callout text — no quotes around it, no explanation.`;

const VOICE_QUIP_SYSTEM = `You are "Rizzless", a brutally sarcastic Discord moderation bot that calls people out live in voice chat via text-to-speech.

Write a SHORT spoken callout for the flirty thing the user just said and/or the image they posted. Rules:
- Reference something SPECIFIC from what they said or what's in the image — paraphrase a key phrase, or call out what's in the image directly so it's clear you noticed
- If both text and image are flirty, work both into the burn naturally
- If the image flag mentions "adult" or "racy" content, lean into that — they posted something they shouldn't have
- Dry, deadpan delivery — like a stern announcer reading from a cringe log
- 1–2 sentences MAX
- No emojis (this is spoken aloud via TTS — they render badly)
- Do NOT say "flirting detected", "rizz alert", or other generic openers
- Make it embarrassing, not encouraging

Respond with ONLY the callout text — no quotes, no preamble.`;

// ─── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate a context-aware quip referencing what the user actually said
 * and/or what was in their image.
 *
 * @param {string}      content      - The flirty message or transcribed speech
 * @param {number}      score        - Flirt score 0–100
 * @param {string}      username     - Discord username (for logging)
 * @param {boolean}     isVoice      - true = no emojis, spoken cadence
 * @param {string|null} imageReason  - Vision API findings for the attached image
 *                                     (e.g. 'adult content (LIKELY)', '"kiss" (87% confidence)')
 *                                     Set when the message included a flagged image.
 * @returns {Promise<string|null>}   - Quip text, or null on failure (caller should use static fallback)
 */
async function generateAdaptiveQuip(content, score, username, isVoice = false, imageReason = null) {
    const hasContent = !!content?.trim();
    const hasImage   = !!imageReason;
    if (!hasContent && !hasImage) return null;

    try {
        const system = isVoice ? VOICE_QUIP_SYSTEM : TEXT_QUIP_SYSTEM;

        // Build the user prompt with whatever context is available.
        // The LLM should weave both signals into one cohesive callout.
        let promptBody = `User "${username}"`;
        if (hasContent) promptBody += ` said: "${content}"`;
        if (hasImage)   promptBody += `${hasContent ? ' and posted' : ' posted'} an image flagged for: ${imageReason}`;
        promptBody += `\nFlirt intensity: ${score}/100\n\nCallout:`;

        const result = await getClient().models.generateContent({
            model: MODEL,
            config: {
                systemInstruction: system,
                temperature:       0.88,
                maxOutputTokens:   120,
            },
            contents: promptBody,
        });

        const quip = result.text?.trim();
        if (!quip) throw new Error('Empty response from model');

        const previewSrc = hasContent ? content : `[image: ${imageReason}]`;
        console.log(`[AdaptiveQuip] ${isVoice ? '🎤' : '💬'} "${previewSrc.slice(0, 50)}" → "${quip}"`);
        return quip;

    } catch (err) {
        console.error('[AdaptiveQuip] Generation failed, caller should use static fallback:', err.message);
        return null;
    }
}

module.exports = { generateAdaptiveQuip };
