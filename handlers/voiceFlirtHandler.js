'use strict';

const sodium = require('libsodium-wrappers');
const {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');

const { scoreMessage }          = require('../services/scoringService');
const { subscribeToUtterance }  = require('../services/transcriptionService');
const { generateAdaptiveQuip }  = require('../services/adaptiveQuipService');
const { playOnConnection, playInVoice } = require('../services/voiceService');
const { pickVoice }             = require('../config/responses');
const state                     = require('../state/stateManager');
const { handleDMEscalation, handleCheatDetection, handleTimeout } = require('../services/moderationService');

// ─── Thresholds ───────────────────────────────────────────────────────────────
const VOICE_FLIRT_THRESHOLD = 35; // lower than text — transcription loses nuance
const VOICE_STRONG_THRESHOLD = 60;

// ─── Per-guild state ──────────────────────────────────────────────────────────
// guildId → Set<userId> — tracks users we've already subscribed to this utterance
const subscribedUsers = new Map();

// guildId → { connection, guild, textChannel }
const activeMonitors = new Map();

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Set up the speaking listener loop on a live connection.
 * Whenever a user starts speaking, subscribe to that utterance, transcribe it,
 * score it, and fire an adaptive voice quip if it crosses the threshold.
 */
function setupSpeakingListener(connection, guild, guildId) {
    const receiver = connection.receiver;

    if (!subscribedUsers.has(guildId)) subscribedUsers.set(guildId, new Set());
    const activeUsers = subscribedUsers.get(guildId);

    receiver.speaking.on('start', (userId) => {
        // Skip bots and double-subscriptions
        if (activeUsers.has(userId)) return;
        const member = guild.members.cache.get(userId);
        if (!member || member.user.bot) return;

        activeUsers.add(userId);
        console.log(`[VoiceFlirt] Listening to ${member.user.username}...`);

        subscribeToUtterance(receiver, userId, async (transcript) => {
            activeUsers.delete(userId); // ready for re-subscription on next utterance

            // Score the transcribed speech
            state.ensureUser(userId);
            const score = await scoreMessage(transcript);

            state.recordMessage(userId, `[VC] ${transcript}`, score, null);
            console.log(`[VoiceFlirt] ${member.user.username.padEnd(20)} | score: ${score} | "${transcript}"`);

            if (score < VOICE_FLIRT_THRESHOLD) return;

            // Generate an adaptive quip that references what they actually said
            const quip = await generateAdaptiveQuip(transcript, score, member.user.username, true)
                      ?? pickVoice().replace('{user}', member.user.username);

            // Play the callout back in the voice channel
            const activeConn = getVoiceConnection(guildId);
            if (activeConn) {
                await playOnConnection(activeConn, guildId, quip);
            }

            // Run the same moderation chain as text messages for severe cases
            if (score >= VOICE_STRONG_THRESHOLD && activeMonitors.has(guildId)) {
                const { textChannel } = activeMonitors.get(guildId);
                if (textChannel) {
                    // Synthesize a fake message-like object for the moderation handlers
                    const pseudoMessage = {
                        author:  member.user,
                        member,
                        channel: textChannel,
                        guild,
                        content: `[Voice] ${transcript}`,
                    };
                    handleDMEscalation(pseudoMessage, score, userId).catch(err =>
                        console.error('[VoiceFlirt] DM error:', err.message));
                    handleCheatDetection(pseudoMessage, score, userId).catch(err =>
                        console.error('[VoiceFlirt] Cheat error:', err.message));
                    handleTimeout(pseudoMessage, score, userId).catch(err =>
                        console.error('[VoiceFlirt] Timeout error:', err.message));
                }
            }
        });

        // If the stream errors, un-block re-subscription
        activeUsers.delete = activeUsers.delete.bind(activeUsers);
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Join a voice channel, play the arrival announcement, then stay and monitor
 * all speech for flirtatious content.
 *
 * @param {import('discord.js').GuildMember} member     - The member who joined (determines channel)
 * @param {string}                           guildId
 * @param {import('discord.js').TextChannel} textChannel - Used for moderation messages on voice detections
 */
async function joinAndMonitor(member, guildId, textChannel = null) {
    await sodium.ready;

    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
        console.log('[VoiceFlirt] Member not in a voice channel.');
        return;
    }

    // Destroy any stale connection so we get a fresh one
    const existing = getVoiceConnection(guildId);
    if (existing) {
        console.log('[VoiceFlirt] Destroying stale connection before re-joining...');
        existing.destroy();
        await new Promise(r => setTimeout(r, 800));
    }

    const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       false,
    });

    connection.on('stateChange', (oldSt, newSt) => {
        console.log(`[VoiceFlirt] Connection ${oldSt.status} → ${newSt.status}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.log(`[VoiceFlirt] Disconnected from guild ${guildId}.`);
        subscribedUsers.delete(guildId);
        activeMonitors.delete(guildId);
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
        console.error('[VoiceFlirt] Failed to connect:', err.message);
        connection.destroy();
        return;
    }

    // Store monitor metadata
    activeMonitors.set(guildId, { connection, guild: voiceChannel.guild, textChannel });
    subscribedUsers.set(guildId, new Set());

    // Play the arrival announcement
    await playOnConnection(connection, guildId,
        'Attention. You have entered a monitored voice session.');

    // Start the speaking listener loop — this persists until the bot leaves
    setupSpeakingListener(connection, voiceChannel.guild, guildId);
    console.log(`[VoiceFlirt] Now monitoring voice channel "${voiceChannel.name}" in guild ${guildId}`);
}

/**
 * Leave the voice channel for a guild and clean up state.
 */
function leaveChannel(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
        console.log(`[VoiceFlirt] Left voice in guild ${guildId}`);
    }
    subscribedUsers.delete(guildId);
    activeMonitors.delete(guildId);
}

/**
 * Call this from voiceStateUpdate when a member leaves a channel.
 * If the bot's channel is now empty (only the bot remains), it leaves too.
 */
function onMemberLeave(oldState) {
    const guildId = oldState.guild.id;
    if (!activeMonitors.has(guildId)) return;

    const { connection } = activeMonitors.get(guildId);
    if (!connection) return;

    // Find the channel the bot is currently in
    const botMember = oldState.guild.members.me;
    const botChannel = botMember?.voice?.channel;
    if (!botChannel) return;

    // Count non-bot members still in the channel
    const remaining = botChannel.members.filter(m => !m.user.bot).size;
    if (remaining === 0) {
        console.log('[VoiceFlirt] Channel is empty — leaving.');
        leaveChannel(guildId);
    }
}

/**
 * Speak a TTS line in the guild's active voice channel (if the bot is there),
 * or fall back to joining temporarily to deliver the line.
 * Use this in place of playInVoice for all text-channel-triggered voice quips.
 */
async function speakInGuild(member, text, guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection && activeMonitors.has(guildId)) {
        return playOnConnection(connection, guildId, text);
    }
    // Bot isn't in a VC yet — join, speak, leave (original behaviour)
    return playInVoice(member, text, guildId);
}

module.exports = { joinAndMonitor, leaveChannel, onMemberLeave, speakInGuild };
