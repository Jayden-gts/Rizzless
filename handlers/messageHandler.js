'use strict';

const state                             = require('../state/stateManager');
const { scoreMessage, extractTargetId } = require('../services/scoringService');
const { analyzeImage, getImageUrls }    = require('../services/visionService');
const { playInVoice }                   = require('../services/voiceService');
const { generateAdaptiveQuip }          = require('../services/adaptiveQuipService');
const { handleDMEscalation, handleCheatDetection, handleTimeout } = require('../services/moderationService');
const { pickMild, pickStrong, pickAggressive, pickVoice, pickMeme } = require('../config/responses');

const voiceCooldown    = new Map();
const responseCooldown = new Map();

const THRESH_MILD       = 30;
const THRESH_STRONG     = 60;
const THRESH_AGGRESSIVE = 80;
const THRESH_VOICE      = Number(process.env.THRESH_VOICE) || 60;
const THRESH_MEME       = 60;

function combineScores(textScore, imageScore) {
    if (imageScore === 0) return textScore;
    const base = textScore === 0 ? Math.min(imageScore, 40) : textScore;
    return Math.min(100, base + Math.round(imageScore * 0.5));
}

function staticChatFallback(score) {
    if (score >= THRESH_AGGRESSIVE) return pickAggressive();
    if (score >= THRESH_STRONG)     return pickStrong();
    return pickMild();
}

async function handle(message) {
    if (message.author.bot) return;
    if (!message.guild)     return;

    const userId   = message.author.id;
    const targetId = extractTargetId(message.content);
    const imageUrls = getImageUrls(message);

    // 1. Score message + analyze images in parallel.
    //    NOTE: we *don't* kick off quip generation here yet — we don't know
    //    the score, and most messages will be below threshold. Generating
    //    quips for every message would be wasteful and rate-limit-prone.
    const [textScore, ...imageResults] = await Promise.all([
        scoreMessage(message.content),
        ...imageUrls.map(url => analyzeImage(url)),
    ]);

    // 2. Combine scores
    const imageScore = imageResults.reduce((max, r) => Math.max(max, r.score), 0);
    const score      = combineScores(textScore, imageScore);

    // 3. Persist + log
    state.ensureUser(userId);
    state.recordMessage(userId, message.content, score, targetId);

    const imagePart = imageScore > 0 ? ` | image: ${imageScore}` : '';
    console.log(
        `[Score] ${message.author.username.padEnd(20)} | ` +
        `text: ${String(textScore).padStart(3)}${imagePart} | final: ${score} | ` +
        `"${message.content.slice(0, 50).replace(/\n/g, ' ')}"`
    );

    if (score < THRESH_MILD) return;

    // 4. Per-user response cooldown (prevents spam)
    const responseKey = `${message.guild.id}-${userId}`;
    const lastResponse = responseCooldown.get(responseKey);
    if (lastResponse && Date.now() - lastResponse < 15000) return;
    responseCooldown.set(responseKey, Date.now());

    // 5. Kick off adaptive quip generation NOW, in parallel with everything
    //    that follows. It runs once and feeds both the chat reply and the
    //    voice line — same content, two surfaces.
    //
    //    We also start a "voice-flavoured" quip in parallel ONLY if the score
    //    crosses the voice threshold. The two prompts can produce slightly
    //    different phrasings (text quips can use emojis, voice quips can't).
    const username = message.author.username;
    const chatQuipPromise  = generateAdaptiveQuip(message.content, score, username, false);
    const voiceQuipPromise = score >= THRESH_VOICE
        ? generateAdaptiveQuip(message.content, score, username, true)
        : null;

    // 6. Voice — wait for the adaptive quip to finish, then play it.
    //    No timeout: a generic line is worse than a slightly delayed real one.
    //    Static fallback fires only if the LLM call actually fails (returns null).
    if (voiceQuipPromise) {
        const voiceKey = `${message.guild.id}-${userId}`;
        const lastVoice = voiceCooldown.get(voiceKey);
        if (!lastVoice || Date.now() - lastVoice >= 60000) {
            voiceCooldown.set(voiceKey, Date.now());
            (async () => {
                let adaptive = null;
                try { adaptive = await voiceQuipPromise; }
                catch (err) { console.error('[Handler] Voice quip error:', err.message); }
                const voiceText = adaptive || pickVoice().replace('{user}', username);
                if (!adaptive) console.log('[Handler] Voice quip returned null, using static line.');
                return playInVoice(message.member, voiceText, message.guild.id);
            })().catch(err => console.error('[Handler] Voice error:', err.message));
        }
    }

    // 7. Chat response — same: wait for the real quip, fall back only on failure.
    const chatTextPromise = (async () => {
        let adaptive = null;
        try { adaptive = await chatQuipPromise; }
        catch (err) { console.error('[Handler] Chat quip error:', err.message); }
        let reply = adaptive || staticChatFallback(score);
        if (!adaptive) console.log('[Handler] Chat quip returned null, using static line.');
        if (imageScore >= 20) reply += '\n📸 *And the image makes it worse.*';
        return reply;
    })();

    const chatPromise = chatTextPromise
        .then(reply => message.channel.send(reply))
        .catch(err => console.error('[Handler] Chat response error:', err.message));

    // 8. Meme — wait for chat reply to land first so ordering is sane,
    //    but don't block moderation handlers below.
    if (score >= THRESH_MEME && state.canPostMeme(message.channel.id)) {
        state.recordMeme(message.channel.id);
        Promise.resolve(chatPromise)
            .then(() => message.channel.send(pickMeme()))
            .catch(err => console.error('[Handler] Meme error:', err.message));
    }

    // 9. Moderation
    handleDMEscalation(message, score, userId).catch(err => console.error('[Handler] DM error:', err.message));
    handleCheatDetection(message, score, userId).catch(err => console.error('[Handler] Cheat error:', err.message));
    handleTimeout(message, score, userId).catch(err => console.error('[Handler] Timeout error:', err.message));
}

module.exports = { handle };
