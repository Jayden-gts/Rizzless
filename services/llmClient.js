'use strict';

/**
 * Shared LLM client. Points at Ollama's OpenAI-compatible endpoint by default
 * (http://localhost:11434/v1) so we can run Gemma 4 locally with no API key
 * and no rate limits.
 *
 * Override via env vars if you ever want to swap providers without changing
 * the call sites:
 *   LLM_BASE_URL  — e.g. https://api.openai.com/v1, https://api.groq.com/openai/v1
 *   LLM_API_KEY   — required by hosted providers, ignored by Ollama
 *   LLM_MODEL     — default model name; per-call overrides take precedence
 */

const BASE_URL = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '');
const API_KEY  = process.env.LLM_API_KEY  || 'ollama'; // Ollama ignores this but the header must exist
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gemma4:26b';

console.log(`[LLM] Using ${BASE_URL} model=${DEFAULT_MODEL}`);

/**
 * Chat-completion call. Returns the assistant text only.
 *
 * @param {object} opts
 * @param {string} [opts.model]       Override DEFAULT_MODEL
 * @param {string} [opts.system]      System prompt (Gemma 4 supports this natively)
 * @param {string} opts.prompt        User message
 * @param {number} [opts.temperature] 0.0–1.0, default 0.7
 * @param {number} [opts.maxTokens]   Max output tokens, default 500
 * @returns {Promise<string>}
 */
async function chat({ model, system, prompt, temperature = 0.7, maxTokens = 500 }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
            model:       model || DEFAULT_MODEL,
            messages,
            temperature,
            max_tokens:  maxTokens,
            stream:      false,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}: ${body}`);
    }

    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? '').trim();
}

module.exports = { chat };
