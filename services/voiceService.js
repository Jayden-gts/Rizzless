'use strict';

require('dotenv').config();

const sodium = require('libsodium-wrappers');

const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');

const { Readable } = require('stream');
const prism  = require('prism-media');
const state  = require('../state/stateManager');

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

const audioCache     = new Map();
const activeSessions = new Set();

// ─── TTS ──────────────────────────────────────────────────────────
async function fetchTTS(text) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
    if (audioCache.has(text)) return audioCache.get(text);

    const res = await fetch(`${API_BASE}/${VOICE_ID}`, {
        method: 'POST',
        headers: {
            'xi-api-key':   apiKey,
            'Content-Type': 'application/json',
            'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });

    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => '')}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    audioCache.set(text, buffer);
    return buffer;
}

// ─── Main ─────────────────────────────────────────────────────────
async function playInVoice(member, text, guildId) {
    if (activeSessions.has(guildId))  { console.log('[Voice] Already active.'); return false; }
    if (!state.canJoinVoice(guildId)) { console.log('[Voice] Cooldown.');       return false; }

    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) { console.log('[Voice] Member not in VC.'); return false; }

    activeSessions.add(guildId);
    state.recordVoiceJoin(guildId);

    let connection;
    try {
        await sodium.ready;

        console.log(`[Voice] Fetching TTS: "${text}"`);
        const buffer = await fetchTTS(text);
        console.log(`[Voice] Buffer size: ${buffer.length} bytes`);

        // Destroy any stale connection
        const existing = getVoiceConnection(guildId);
        if (existing) {
            console.log('[Voice] Destroying stale connection...');
            existing.destroy();
            await new Promise(r => setTimeout(r, 1000));
        }

        // Join voice channel
        connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:       false,
            debug:          true,
        });
        
        connection.on('debug', msg => console.log('[VoiceDebug]', msg));

        connection.on('stateChange', (oldSt, newSt) => {
            console.log(`[VoiceState] ${oldSt.status} → ${newSt.status}`);
        });

        console.log('[Voice] Waiting for Ready...');
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        console.log('[Voice] Connected! Playing audio...');

        // MP3 → PCM via FFmpeg
        const readable = new Readable();
        readable.push(buffer);
        readable.push(null);

        const ffmpeg = new prism.FFmpeg({
            args: ['-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2'],
        });

        const resource = createAudioResource(readable.pipe(ffmpeg), {
            inputType: StreamType.Raw,
        });

        const player = createAudioPlayer();
        player.on('error', err => console.error('[Voice] Player error:', err.message));

        connection.subscribe(player);
        player.play(resource);

        await entersState(player, AudioPlayerStatus.Idle, 60_000);
        console.log('[Voice] Playback done.');

        connection.destroy();
        return true;

    } catch (err) {
        console.error('[Voice] Error:', err.message);
        try { connection?.destroy(); } catch (_) {}
        return false;
    } finally {
        activeSessions.delete(guildId);
    }
}

module.exports = { playInVoice };