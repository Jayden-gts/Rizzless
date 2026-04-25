'use strict';

const state                  = require('../state/stateManager');
const { scoreMessage, extractTargetId } = require('../services/scoringService');
const { analyzeImage, getImageUrls }    = require('../services/visionService');
const { playInVoice }        = require('../services/voiceService');
const {
    handleDMEscalation,
    handleCheatDetection,
    handleTimeout,
}                            = require('../services/moderationService');
const {
    pickMild,
    pickStrong,
    pickAggressive,
    pickVoice,
    pickMeme,
}                            = require('../config/responses');

// ─── Thresholds ───────────────────────────────────────────────────────────────
const THRESH_MILD       = 30;
const THRESH_STRONG     = 60;
const THRESH_AGGRESSIVE = 80;
const THRESH_VOICE      = 80;
const THRESH_MEME       = 60;

/**
 * Combine text score and image score into a final score.
 * Image score is additive but cannot push text-only 0 above 40
 * (avoids false positives from neutral images with romantic labels).
 */
function combineScores(textScore, imageScore) {
    if (imageScore === 0) return textScore;
    // If text was completely neutral, cap image-only contribution
    const base = textScore === 0 ? Math.min(imageScore, 40) : textScore;
    return Math.min(100, base + Math.round(imageScore * 0.5));
}

/**
 * Main message handler — called for every non-bot guild message.
 * @param {import('discord.js').Message} message
 */
async function handle(message) {
    if (message.author.bot) return;
    if (!message.guild)     return;

    const userId   = message.author.id;
    const userData = state.ensureUser(userId);
    const targetId = extractTargetId(message.content);

    // ── Score text and images in parallel ─────────────────────────────────────
    const imageUrls = getImageUrls(message);

    const [textScore, ...imageResults] = await Promise.all([
        scoreMessage(message.content),
        ...imageUrls.map(url => analyzeImage(url)),
    ]);

    // Use the highest image score found (if any)
    const imageScore = imageResults.reduce((max, r) => Math.max(max, r.score), 0);
    const score      = combineScores(textScore, imageScore);

    // ── Persist to state ──────────────────────────────────────────────────────
    state.recordMessage(userId, message.content, score, targetId);

    // ── Logging ───────────────────────────────────────────────────────────────
    const imagePart = imageScore > 0 ? ` | image: ${imageScore}` : '';
    console.log(
        `[Score] ${message.author.username.padEnd(20)} | ` +
        `text: ${String(textScore).padStart(3)}${imagePart} | final: ${score} | ` +
        `"${message.content.slice(0, 50).replace(/\n/g, ' ')}"`
    );

    if (score < THRESH_MILD) return;

    // ── Escalating chat response ──────────────────────────────────────────────
    try {
        let reply;
        if      (score >= THRESH_AGGRESSIVE) reply = pickAggressive();
        else if (score >= THRESH_STRONG)     reply = pickStrong();
        else                                 reply = pickMild();

        // Append image callout if the image contributed meaningfully
        if (imageScore >= 20) {
            reply += '\n📸 *And the image makes it worse.*';
        }

        await message.channel.send(reply);
    } catch (err) {
        console.error('[Handler] Chat response error:', err.message);
    }

    // ── Meme reaction ─────────────────────────────────────────────────────────
    if (score >= THRESH_MEME && state.canPostMeme(message.channel.id)) {
        state.recordMeme(message.channel.id);
        try {
            await message.channel.send(pickMeme());
        } catch (err) {
            console.error('[Handler] Meme error:', err.message);
        }
    }

    // ── Voice callout (fire-and-forget) ───────────────────────────────────────
    if (score >= THRESH_VOICE) {
        const voiceText = pickVoice().replace('{user}', message.author.username);
        playInVoice(message.member, voiceText, message.guild.id)
            .catch(err => console.error('[Handler] Voice error:', err.message));
    }

    // ── Moderation (all parallel, non-blocking) ───────────────────────────────
    handleDMEscalation(message, score, userId)
        .catch(err => console.error('[Handler] DM error:', err.message));

    handleCheatDetection(message, score, userId)
        .catch(err => console.error('[Handler] Cheat error:', err.message));

    handleTimeout(message, score, userId)
        .catch(err => console.error('[Handler] Timeout error:', err.message));
}

module.exports = { handle };
