'use strict';

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const { Readable } = require('stream');
const state = require('../state/stateManager');

// ─── Config ───────────────────────────────────────────────────────────────────
const VOICE_ID   = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Bella
const API_BASE   = 'https://api.elevenlabs.io/v1/text-to-speech';
const MAX_PLAY_MS = 30_000; // safety timeout for playback

// ─── Simple in-process audio cache (text → Buffer) ───────────────────────────
const audioCache = new Map();

// ─── ElevenLabs TTS fetch ─────────────────────────────────────────────────────
async function fetchTTS(text) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

    if (audioCache.has(text)) return audioCache.get(text);

    const res = await fetch(`${API_BASE}/${VOICE_ID}`, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ElevenLabs ${res.status}: ${body}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    audioCache.set(text, buffer);   // cache for reuse
    return buffer;
}

// ─── Main voice playback function ─────────────────────────────────────────────
/**
 * Join the voice channel the guild member is in, speak `text`, then disconnect.
 *
 * @param {import('discord.js').GuildMember} member  The offending member
 * @param {string}                           text    TTS text to speak
 * @param {string}                           guildId Discord guild ID
 * @returns {Promise<boolean>} true if playback completed
 */
async function playInVoice(member, text, guildId) {
    // ── Cooldown guard ──
    if (!state.canJoinVoice(guildId)) {
        console.log('[Voice] Cooldown active, skipping join.');
        return false;
    }

    // ── Voice channel guard ──
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
        console.log(`[Voice] ${member.user.username} is not in a voice channel.`);
        return false;
    }

    state.recordVoiceJoin(guildId);
    let connection;

    try {
        // ── Fetch TTS audio ──
        console.log(`[Voice] Fetching TTS: "${text}"`);
        const buffer = await fetchTTS(text);

        // ── Join voice channel ──
        connection = joinVoiceChannel({
            channelId:       voiceChannel.id,
            guildId,
            adapterCreator:  voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:        false,
        });

        // Wait until ready (max 5 s)
        await entersState(connection, VoiceConnectionStatus.Ready, 5_000);

        // ── Build audio resource from buffer ──
        const readable = Readable.from(buffer);
        const resource = createAudioResource(readable, { inputType: StreamType.Arbitrary });
        const player   = createAudioPlayer();

        connection.subscribe(player);
        player.play(resource);

        // ── Await playback completion ──
        await Promise.race([
            new Promise(resolve => player.once(AudioPlayerStatus.Idle, resolve)),
            new Promise(resolve => player.once('error', resolve)),
            new Promise(resolve => setTimeout(resolve, MAX_PLAY_MS)),
        ]);

        console.log('[Voice] Playback complete, disconnecting.');
        connection.destroy();
        return true;

    } catch (err) {
        console.error('[Voice] Error during playback:', err.message);
        try { connection?.destroy(); } catch (_) { /* ignore */ }
        return false;
    }
}

module.exports = { playInVoice };
