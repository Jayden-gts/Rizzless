'use strict';

// ─── Cooldown constants ────────────────────────────────────────────────────────
const VOICE_COOLDOWN    = 30_000;   // 30s between voice joins per guild
const MEME_COOLDOWN     = 20_000;   // 20s between meme posts per channel
const DM_COOLDOWN       = 60_000;   // 60s between DMs per user
const CHEAT_COOLDOWN    = 90_000;   // 90s between cheat callouts per user

// ─── Per-user shape ────────────────────────────────────────────────────────────
function makeUser() {
    return {
        messages:         [],   // { content, score, timestamp, targetId }
        aggregateScore:   0,
        dmCount:          0,
        lastDm:           0,
        timeoutCount:     0,
        lastCheatCallout: 0,
    };
}

// ─── State stores ──────────────────────────────────────────────────────────────
const users          = new Map();   // userId  → UserState
const voiceCooldowns = new Map();   // guildId → timestamp
const memeCooldowns  = new Map();   // channelId → timestamp

// ─── User helpers ──────────────────────────────────────────────────────────────
function getUser(userId) {
    return users.get(userId) ?? null;
}

function ensureUser(userId) {
    if (!users.has(userId)) users.set(userId, makeUser());
    return users.get(userId);
}

function recordMessage(userId, content, score, targetId) {
    const user = ensureUser(userId);
    const now  = Date.now();

    user.messages.push({ content, score, timestamp: now, targetId: targetId ?? null });
    if (user.messages.length > 100) user.messages.shift();

    // Rolling average aggregate score
    user.aggregateScore = Math.min(
        100,
        Math.round(user.messages.reduce((s, m) => s + m.score, 0) / user.messages.length)
    );
}

// ─── DM helpers ───────────────────────────────────────────────────────────────
function canSendDM(userId) {
    return Date.now() - (ensureUser(userId).lastDm) > DM_COOLDOWN;
}

function recordDM(userId) {
    const user   = ensureUser(userId);
    user.lastDm  = Date.now();
    user.dmCount += 1;
    return user.dmCount;
}

// ─── Meme helpers ─────────────────────────────────────────────────────────────
function canPostMeme(channelId) {
    return Date.now() - (memeCooldowns.get(channelId) ?? 0) > MEME_COOLDOWN;
}

function recordMeme(channelId) {
    memeCooldowns.set(channelId, Date.now());
}

// ─── Voice helpers ────────────────────────────────────────────────────────────
function canJoinVoice(guildId) {
    return Date.now() - (voiceCooldowns.get(guildId) ?? 0) > VOICE_COOLDOWN;
}

function recordVoiceJoin(guildId) {
    voiceCooldowns.set(guildId, Date.now());
}

// ─── Window query helpers ─────────────────────────────────────────────────────
function getRecentHighScoreCount(userId, minScore, windowMs) {
    const user   = ensureUser(userId);
    const cutoff = Date.now() - windowMs;
    return user.messages.filter(m => m.timestamp > cutoff && m.score >= minScore).length;
}

function getUniqueTargetsInWindow(userId, minScore, windowMs) {
    const user   = ensureUser(userId);
    const cutoff = Date.now() - windowMs;
    const recent = user.messages.filter(m => m.timestamp > cutoff && m.score >= minScore && m.targetId);
    return new Set(recent.map(m => m.targetId));
}

// ─── Cheat callout ────────────────────────────────────────────────────────────
function canCalloutCheat(userId) {
    return Date.now() - (ensureUser(userId).lastCheatCallout) > CHEAT_COOLDOWN;
}

function recordCheatCallout(userId) {
    ensureUser(userId).lastCheatCallout = Date.now();
}

// ─── Timeout tracking ─────────────────────────────────────────────────────────
function incrementTimeout(userId) {
    const user = ensureUser(userId);
    user.timeoutCount += 1;
    return user.timeoutCount;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
    getUser,
    ensureUser,
    recordMessage,
    canSendDM,
    recordDM,
    canPostMeme,
    recordMeme,
    canJoinVoice,
    recordVoiceJoin,
    getRecentHighScoreCount,
    getUniqueTargetsInWindow,
    canCalloutCheat,
    recordCheatCallout,
    incrementTimeout,
};
