'use strict';

const { EmbedBuilder }                  = require('discord.js');
const state                             = require('../state/stateManager');
const { scoreMessage, extractTargetId } = require('../services/scoringService');
const { analyzeImage, getImageUrls }    = require('../services/visionService');
const { playInVoice }                   = require('../services/voiceService');
const { generateAdaptiveQuip }          = require('../services/adaptiveQuipService');
const { flagUser, clearUser }           = require('../services/roleService');
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

    const userId    = message.author.id;
    const targetId  = extractTargetId(message.content);
    const imageUrls = getImageUrls(message);

    const [textScore, ...imageResults] = await Promise.all([
        scoreMessage(message.content),
        ...imageUrls.map(url => analyzeImage(url)),
    ]);

    const imageScore = imageResults.reduce((max, r) => Math.max(max, r.score), 0);
    const topImage = imageResults.reduce(
        (best, r) => (r.score > (best?.score ?? -1) ? r : best),
        null,
    );
    const imageReason = topImage && topImage.score > 0 ? topImage.reason : null;
    const score = combineScores(textScore, imageScore);

    state.ensureUser(userId);
    state.recordMessage(userId, message.content, score, targetId);

    const imagePart = imageScore > 0 ? ` | image: ${imageScore}` : '';
    console.log(
        `[Score] ${message.author.username.padEnd(20)} | ` +
        `text: ${String(textScore).padStart(3)}${imagePart} | final: ${score} | ` +
        `"${message.content.slice(0, 50).replace(/\n/g, ' ')}"`
    );

    // Flag or clear leaderboard based on score
    if (score >= 60) {
        flagUser(message.member, score)
            .catch(err => console.error('[Handler] Flag error:', err.message));
    } else if (score < 30) {
        clearUser(message.member)
            .catch(err => console.error('[Handler] Clear error:', err.message));
    }

    if (score < THRESH_MILD) return;

    const responseKey  = `${message.guild.id}-${userId}`;
    const lastResponse = responseCooldown.get(responseKey);
    if (lastResponse && Date.now() - lastResponse < 15000) return;
    responseCooldown.set(responseKey, Date.now());

    const username         = message.author.username;
    const chatQuipPromise  = generateAdaptiveQuip(message.content, score, username, false, imageReason);
    const voiceQuipPromise = score >= THRESH_VOICE
        ? generateAdaptiveQuip(message.content, score, username, true, imageReason)
        : null;

    if (voiceQuipPromise) {
        const voiceKey  = `${message.guild.id}-${userId}`;
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
        .then(reply => message.channel.send({
            content: `<@${userId}> ${reply}`,
            allowedMentions: { users: [userId] },
        }))
        .catch(err => console.error('[Handler] Chat response error:', err.message));

    if (score >= THRESH_MEME && state.canPostMeme(message.channel.id)) {
        state.recordMeme(message.channel.id);
        Promise.resolve(chatPromise)
            .then(() => message.channel.send({
                embeds: [new EmbedBuilder().setImage(pickMeme())]
            }))
            .catch(err => console.error('[Handler] Meme error:', err.message));
    }

    handleDMEscalation(message, score, userId).catch(err => console.error('[Handler] DM error:', err.message));
    handleCheatDetection(message, score, userId).catch(err => console.error('[Handler] Cheat error:', err.message));
    handleTimeout(message, score, userId).catch(err => console.error('[Handler] Timeout error:', err.message));
}

module.exports = { handle };