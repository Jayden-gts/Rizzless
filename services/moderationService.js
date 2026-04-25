'use strict';

const state = require('../state/stateManager');
const { pickDmWarn, pickDmEscalate, pickCheat, pickTimeout } = require('../config/responses');

// ─── Thresholds & windows ─────────────────────────────────────────────────────
const DM_SCORE_MIN    = 70;
const DM_WINDOW_MS    = 60_000;    // 60 s window to accumulate DM-triggering messages
const DM_COUNT_NEEDED = 2;         // how many ≥70 messages needed within window

const CHEAT_SCORE_MIN    = 60;
const CHEAT_WINDOW_MS    = 120_000; // 2 min window for multi-target detection
const CHEAT_TARGET_COUNT = 2;       // unique targets needed to trigger

const TIMEOUT_SCORE_MIN    = 80;
const TIMEOUT_WINDOW_MS    = 120_000;
const TIMEOUT_COUNT_NEEDED = 3;

const TIMEOUT_DURATIONS = [30, 60, 120, 300]; // escalating durations (seconds)

// ─── DM escalation ────────────────────────────────────────────────────────────
/**
 * If a user has sent ≥ DM_COUNT_NEEDED high-score messages recently,
 * send them a private warning (with escalating tone and a cooldown).
 */
async function handleDMEscalation(message, score, userId) {
    if (score < DM_SCORE_MIN) return;

    const recentCount = state.getRecentHighScoreCount(userId, DM_SCORE_MIN, DM_WINDOW_MS);
    if (recentCount < DM_COUNT_NEEDED) return;
    if (!state.canSendDM(userId)) return;

    const dmCount = state.recordDM(userId);                   // increments & returns new count
    const isExhausted = dmCount > 3;                          // past the warn array
    const dmText = isExhausted
        ? pickDmEscalate()
        : pickDmWarn(dmCount - 1);

    try {
        await message.author.send(dmText);
        console.log(`[DM] Warning #${dmCount} sent to ${message.author.username}`);
    } catch (err) {
        // User may have DMs disabled — not fatal
        console.warn(`[DM] Could not DM ${message.author.username}: ${err.message}`);
    }
}

// ─── Cheating detection ───────────────────────────────────────────────────────
/**
 * If a user has sent ≥CHEAT_SCORE_MIN messages to ≥CHEAT_TARGET_COUNT distinct
 * users within the window, fire a public callout (once per cooldown).
 */
async function handleCheatDetection(message, score, userId) {
    if (score < CHEAT_SCORE_MIN) return;

    const targets = state.getUniqueTargetsInWindow(userId, CHEAT_SCORE_MIN, CHEAT_WINDOW_MS);
    if (targets.size < CHEAT_TARGET_COUNT) return;
    if (!state.canCalloutCheat(userId)) return;

    state.recordCheatCallout(userId);

    const template = pickCheat();
    const text     = template.replace('{user}', `<@${userId}>`);

    await message.channel.send(text);
    console.log(`[Cheat] Callout fired for ${message.author.username} (${targets.size} targets)`);
}

// ─── Timeout system ───────────────────────────────────────────────────────────
/**
 * If a user has sent ≥TIMEOUT_COUNT_NEEDED very-high-score messages recently,
 * apply an escalating Discord timeout (if the bot has permission).
 */
async function handleTimeout(message, score, userId) {
    if (score < TIMEOUT_SCORE_MIN) return;

    const recentCount = state.getRecentHighScoreCount(userId, TIMEOUT_SCORE_MIN, TIMEOUT_WINDOW_MS);
    if (recentCount < TIMEOUT_COUNT_NEEDED) return;

    const member = message.member;
    if (!member?.moderatable) return; // bot lacks permission or targeting an admin

    const timeoutCount   = state.incrementTimeout(userId);
    const durationIndex  = Math.min(timeoutCount - 1, TIMEOUT_DURATIONS.length - 1);
    const durationSecs   = TIMEOUT_DURATIONS[durationIndex];

    try {
        await member.timeout(durationSecs * 1_000, 'Excessive rizz — Rizzless bot');

        const announcement = pickTimeout()
            .replace('{user}',     `<@${userId}>`)
            .replace('{duration}', durationSecs);

        await message.channel.send(announcement);
        console.log(`[Timeout] ${message.author.username} timed out for ${durationSecs}s (offense #${timeoutCount})`);
    } catch (err) {
        console.error(`[Timeout] Failed to timeout ${message.author.username}:`, err.message);
    }
}

module.exports = { handleDMEscalation, handleCheatDetection, handleTimeout };
