'use strict';

const state              = require('../state/stateManager');
const { scoreMessage, extractTargetId } = require('../services/scoringService');
const { playInVoice }    = require('../services/voiceService');
const {
    handleDMEscalation,
    handleCheatDetection,
    handleTimeout,
}                        = require('../services/moderationService');
const {
    pickMild,
    pickStrong,
    pickAggressive,
    pickVoice,
    pickMeme,
}                        = require('../config/responses');

// ─── Score thresholds ─────────────────────────────────────────────────────────
const THRESH_MILD       = 30;
const THRESH_STRONG     = 60;
const THRESH_AGGRESSIVE = 80;
const THRESH_VOICE      = 80;
const THRESH_MEME       = 60;

/**
 * Main message handler — called for every non-bot guild message.
 * @param {import('discord.js').Message} message
 */
async function handle(message) {
    // ── Guards ──────────────────────────────────────────────────────────────────
    if (message.author.bot) return;
    if (!message.guild)     return;   // ignore DM channel messages

    const userId   = message.author.id;
    const userData = state.ensureUser(userId);
    const targetId = extractTargetId(message.content);
    const score    = scoreMessage(message.content, userData.messages);

    // Persist to state before anything else
    state.recordMessage(userId, message.content, score, targetId);

    console.log(
        `[Score] ${message.author.username.padEnd(20)} | score: ${String(score).padStart(3)} | ` +
        `"${message.content.slice(0, 60).replace(/\n/g, ' ')}"`
    );

    if (score < THRESH_MILD) return; // Nothing to do

    // ── Escalating chat response ──────────────────────────────────────────────
    try {
        let reply;
        if      (score >= THRESH_AGGRESSIVE) reply = pickAggressive();
        else if (score >= THRESH_STRONG)     reply = pickStrong();
        else                                 reply = pickMild();

        await message.channel.send(reply);
    } catch (err) {
        console.error('[Handler] Failed to send chat response:', err.message);
    }

    // ── Meme reaction (high-score only, cooldown enforced) ────────────────────
    if (score >= THRESH_MEME && state.canPostMeme(message.channel.id)) {
        state.recordMeme(message.channel.id);
        try {
            await message.channel.send(pickMeme());
        } catch (err) {
            console.error('[Handler] Failed to send meme:', err.message);
        }
    }

    // ── Voice callout (fire-and-forget, non-blocking) ─────────────────────────
    if (score >= THRESH_VOICE) {
        const voiceText = pickVoice().replace('{user}', message.author.username);
        playInVoice(message.member, voiceText, message.guild.id)
            .catch(err => console.error('[Handler] Voice error:', err.message));
    }

    // ── Moderation (all fire-and-forget so they don't block each other) ───────
    handleDMEscalation(message, score, userId)
        .catch(err => console.error('[Handler] DM error:', err.message));

    handleCheatDetection(message, score, userId)
        .catch(err => console.error('[Handler] Cheat error:', err.message));

    handleTimeout(message, score, userId)
        .catch(err => console.error('[Handler] Timeout error:', err.message));
}

module.exports = { handle };
