'use strict';

const state                             = require('../state/stateManager');
const { scoreMessage, extractTargetId } = require('../services/scoringService');
const { analyzeImage, getImageUrls }    = require('../services/visionService');
const { speakInGuild }                  = require('./voiceFlirtHandler');
const { generateAdaptiveQuip }          = require('../services/adaptiveQuipService');
const { handleDMEscalation, handleCheatDetection, handleTimeout } = require('../services/moderationService');
const { pickMild, pickStrong, pickAggressive, pickVoice, pickMeme } = require('../config/responses');

const voiceCooldown    = new Map();
const responseCooldown = new Map();

const THRESH_MILD       = 30;
const THRESH_STRONG     = 60;
const THRESH_AGGRESSIVE = 80;
const THRESH_VOICE      = 80;
const THRESH_MEME       = 60;

function combineScores(textScore, imageScore) {
    if (imageScore === 0) return textScore;
    const base = textScore === 0 ? Math.min(imageScore, 40) : textScore;
    return Math.min(100, base + Math.round(imageScore * 0.5));
}

async function handle(message) {
    if (message.author.bot) return;
    if (!message.guild)     return;

    const userId   = message.author.id;
    const targetId = extractTargetId(message.content);
    const imageUrls = getImageUrls(message);

    // 1. Score everything
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

    // 5. Chat response
    try {
        let reply;
        if (score >= THRESH_AGGRESSIVE) {
            // Generate a quip that references what they actually said
            reply = await generateAdaptiveQuip(message.content, score, message.author.username)
                 ?? pickAggressive();
        } else if (score >= THRESH_STRONG) {
            reply = await generateAdaptiveQuip(message.content, score, message.author.username)
                 ?? pickStrong();
        } else {
            reply = pickMild();
        }

        if (imageScore >= 20) reply += '\n📸 *And the image makes it worse.*';
        await message.channel.send(reply);
    } catch (err) {
        console.error('[Handler] Chat response error:', err.message);
    }

    // 6. Meme
    if (score >= THRESH_MEME && state.canPostMeme(message.channel.id)) {
        state.recordMeme(message.channel.id);
        try { await message.channel.send(pickMeme()); }
        catch (err) { console.error('[Handler] Meme error:', err.message); }
    }

    // 7. Voice
    if (score >= THRESH_VOICE) {
        const voiceKey = `${message.guild.id}-${userId}`;
        const lastVoice = voiceCooldown.get(voiceKey);
        if (!lastVoice || Date.now() - lastVoice >= 60000) {
            voiceCooldown.set(voiceKey, Date.now());
            // Generate an adaptive voice quip referencing what they said
            const voiceText = await generateAdaptiveQuip(
                message.content, score, message.author.username, true
            ) ?? pickVoice().replace('{user}', message.author.username);
            speakInGuild(message.member, voiceText, message.guild.id)
                .catch(err => console.error('[Handler] Voice error:', err.message));
        }
    }

    // 8. Moderation
    handleDMEscalation(message, score, userId).catch(err => console.error('[Handler] DM error:', err.message));
    handleCheatDetection(message, score, userId).catch(err => console.error('[Handler] Cheat error:', err.message));
    handleTimeout(message, score, userId).catch(err => console.error('[Handler] Timeout error:', err.message));
}

module.exports = { handle };