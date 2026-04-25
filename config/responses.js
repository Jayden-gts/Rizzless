'use strict';

// ─── Chat responses by threshold ──────────────────────────────────────────────
const RESPONSES = {
    // score 30–59
    mild: [
        "👀 Someone's feeling a little flirty today...",
        "Oof, the rizz is leaking 🫠",
        "Easy there, Romeo 👀",
        "Bold strategy, let's see how it plays out 👁️",
        "A little forward, don't you think? 😶",
    ],

    // score 60–79
    strong: [
        "🚨 **RIZZ ALERT** 🚨 Someone call the simp police",
        "Bro really said that with his whole chest 💀",
        "The audacity. The **AUDACITY**. 😭",
        "Sir, this is a Discord server, not a dating app 💀",
        "Yikes. That was a lot. We all saw that. 😬",
    ],

    // score 80–100
    aggressive: [
        "🚨🚨🚨 **MAXIMUM RIZZ DETECTED** — activating cringe containment protocol",
        "We got a CODE RED fuckboy situation in chat 🆘",
        "Someone escort this man out of the server immediately 😭🙏",
        "The flirt levels are **off the charts**. Deploying emergency simp countermeasures. 🚨",
        "💀 I have NEVER seen something this embarrassing in my entire life.",
    ],

    // DM warnings (indexed by dm count)
    dm_warn: [
        "⚠️ **Rizzless Warning #1** — Dial it back before I go public. You've been flagged for excessive rizz.",
        "🛑 **Rizzless Warning #2** — You didn't listen. One more and the whole server finds out.",
        "🚨 **Final Warning** — Your flirt score is dangerously high. This is your last chance to chill.",
    ],

    // DM escalation (after warnings exhausted)
    dm_escalate: [
        "🔥 You've been warned repeatedly. The whole server now knows. Embarrassing.",
        "💀 You had three chances. You blew them all. Clean it up. 🧹",
    ],

    // Cheating detection — use {user} placeholder
    cheat: [
        "👀 **CHEATING DETECTED** — {user} is playing the field! Multiple targets in 2 minutes. Disgusting. 📸",
        "🚨 {user} is distributing rizz to multiple people simultaneously. Caught in 4K. 📸",
        "💀 **PLAYER ALERT**: {user} has been flirting with multiple people at once. The audacity. 😭",
    ],

    // Voice TTS lines — use {user} placeholder
    voice: [
        "Hey {user}, this is your official rizz intervention. Please seek help immediately.",
        "{user}, the Discord server has reported you for excessive flirting. Touch grass.",
        "Attention {user}: your flirt score has exceeded all acceptable limits. This is embarrassing.",
        "{user}, nobody here is interested. Log off and reflect on your choices.",
    ],

    // Timeout announcement — use {user} and {duration} placeholders
    timeout: [
        "⏰ **{user} has been timed out for {duration} seconds** due to excessive rizz. Learn some self-control.",
    ],
};

// ─── Meme / reaction GIF URLs ─────────────────────────────────────────────────
const MEME_URLS = [
    'https://media.giphy.com/media/WRQBXSCnEFJIuxktnw/giphy.gif',
    'https://media.giphy.com/media/Qz4jwODCZJZbG3V7PO/giphy.gif',
    'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdzNua3RidXVxYjVsNGVwZXZvaGo2NHh1OW1seGNueHVzeW94cTdmaSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/PGy6B6TqbBKQHmPxKm/giphy.gif'
];

// ─── Rotating index pickers (deterministic, no true randomness) ───────────────
const counters = {};

function pick(key, arr) {
    if (!counters[key]) counters[key] = 0;
    const item = arr[counters[key] % arr.length];
    counters[key]++;
    return item;
}

function pickMild()       { return pick('mild',       RESPONSES.mild);       }
function pickStrong()     { return pick('strong',     RESPONSES.strong);     }
function pickAggressive() { return pick('aggressive', RESPONSES.aggressive); }
function pickDmWarn(idx)  { return RESPONSES.dm_warn[Math.min(idx, RESPONSES.dm_warn.length - 1)]; }
function pickDmEscalate() { return pick('dm_escalate', RESPONSES.dm_escalate); }
function pickCheat()      { return pick('cheat',      RESPONSES.cheat);      }
function pickVoice()      { return pick('voice',      RESPONSES.voice);      }
function pickMeme()       { return pick('meme',       MEME_URLS);            }
function pickTimeout()    { return RESPONSES.timeout[0];                      }

module.exports = {
    RESPONSES,
    MEME_URLS,
    pickMild,
    pickStrong,
    pickAggressive,
    pickDmWarn,
    pickDmEscalate,
    pickCheat,
    pickVoice,
    pickMeme,
    pickTimeout,
};
