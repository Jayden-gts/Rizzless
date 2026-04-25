'use strict';

// ─── Weighted keyword table ────────────────────────────────────────────────────
// Keys are lowercase substrings; values are score points added per match.
const KEYWORDS = {
    // Tier 3 – strong (8-10 pts)
    'i love you':                   10,
    'marry me':                     10,
    "can't stop thinking about you": 10,
    'netflix and chill':             9,
    'you\'re beautiful':             9,
    'you\'re gorgeous':              9,
    'dream about you':               9,
    'date me':                       9,
    'fall for you':                  9,
    'be mine':                       8,

    // Tier 2 – medium (5-7 pts)
    'sexy':        7,
    'babe':        7,
    'baby':        7,
    'come over':   7,
    'gorgeous':    6,
    'beautiful':   6,
    'stunning':    6,
    'attractive':  6,
    'honey':       6,
    'darling':     6,
    'crush':       6,
    'slide into':  6,
    'miss you':    6,
    'thinking of you': 6,
    'sweetie':     6,
    'hot':         5,
    'cute':        5,
    'handsome':    5,
    'adorable':    5,
    'flirt':       5,
    'wanna hang':  5,
    'dm me':       5,
    'hey beautiful': 5,

    // Tier 1 – mild (1-4 pts)
    'xoxo':   5,
    'xo':     4,
    ';)':     4,
    'hi cutie': 4,
    'uwu':    3,
    'owo':    3,
    'hey there': 2,
    ':)':     2,
    'haha':   1,
    'lol':    1,
};

// ─── Flirty emoji weights ─────────────────────────────────────────────────────
const EMOJI_WEIGHTS = {
    '💘': 9, '💝': 9, '💋': 9, '💏': 9, '💑': 9,
    '❤️': 8, '💕': 8, '💓': 8, '💗': 8, '🥰': 8, '😘': 8,
    '👫': 7, '💞': 7, '💖': 7,
    '😍': 7,
    '😏': 5, '😉': 5,
    '🔥': 4, '🤭': 4,
};

// ─── Mention pattern ──────────────────────────────────────────────────────────
const MENTION_RE = /<@!?(\d+)>/g;

/**
 * Score a single message content string.
 * @param {string}   content       Raw message content
 * @param {object[]} recentHistory Array of { timestamp } for the same user
 * @returns {number} Score 0–100
 */
function scoreMessage(content, recentHistory = []) {
    let score = 0;
    const lower = content.toLowerCase();

    // 1. Keyword matching
    for (const [kw, pts] of Object.entries(KEYWORDS)) {
        if (lower.includes(kw)) score += pts;
    }

    // 2. Emoji matching (count occurrences)
    for (const [emoji, pts] of Object.entries(EMOJI_WEIGHTS)) {
        const escaped = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const count   = (content.match(new RegExp(escaped, 'g')) ?? []).length;
        if (count > 0) score += count * pts;
    }

    // 3. Mentions in the message (targeting specific users)
    const mentions = [...content.matchAll(MENTION_RE)].length;
    if (mentions > 0) score += 5 * Math.min(mentions, 3);

    // 4. Rapid message frequency (messages in last 30 s)
    const now     = Date.now();
    const recent  = recentHistory.filter(m => now - m.timestamp < 30_000).length;
    if (recent >= 5) score += 20;
    else if (recent >= 3) score += 10;

    // 5. Excessive exclamation marks (excitement)
    const exclamations = (content.match(/!/g) ?? []).length;
    if (exclamations >= 3) score += 5;

    // 6. ALL CAPS shouting (> 60 % uppercase, min length 5)
    if (content.length >= 5) {
        const upperRatio = (content.match(/[A-Z]/g) ?? []).length / content.length;
        if (upperRatio > 0.6) score += 5;
    }

    return Math.min(100, Math.max(0, score));
}

/**
 * Extract the first mentioned user ID from a message, if any.
 * @param {string} content
 * @returns {string|null}
 */
function extractTargetId(content) {
    const match = content.match(/<@!?(\d+)>/);
    return match ? match[1] : null;
}

module.exports = { scoreMessage, extractTargetId };
