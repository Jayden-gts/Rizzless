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
const state  = require('../state/stateManager');

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const TTS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

// Request Opus (Ogg-wrapped) from ElevenLabs. Opus carries channel and
// sample-rate metadata in the bitstream, so Discord plays it at correct
// speed/pitch. Saves us the FFmpeg decode step entirely.
const TTS_OUTPUT_FORMAT = 'opus_48000_128';

const audioCache       = new Map();   // text → PCM buffer
const activeSessions   = new Set();   // guildId → in-flight playInVoice playback
const warmConnections  = new Map();   // guildId → { connection, channelId, player, idleTimer }

// Per-connection player cache for monitor-owned connections (voiceFlirtHandler).
// Keyed by the connection object itself so we don't tear down the monitor's player.
const connectionPlayers = new WeakMap(); // connection → player
const connectionLocks   = new WeakMap(); // connection → Promise (serialise plays)

const KEEPALIVE_MS = 60_000; // keep voice connection alive 60s after last play

// Warm sodium once at module load so it's never on the hot path.
sodium.ready.catch(err => console.error('[Voice] sodium init failed:', err.message));

// ─── TTS ──────────────────────────────────────────────────────────
async function fetchTTS(text) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
    if (audioCache.has(text)) return audioCache.get(text);

    const url = `${API_BASE}/${VOICE_ID}?output_format=${TTS_OUTPUT_FORMAT}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'xi-api-key':   apiKey,
            'Content-Type': 'application/json',
            'Accept':       'audio/ogg',
        },
        body: JSON.stringify({
            text,
            model_id: TTS_MODEL,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });

    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => '')}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    audioCache.set(text, buffer);
    return buffer;
}

function makeAudioResource(buffer) {
    const readable = Readable.from(buffer);
    return createAudioResource(readable, { inputType: StreamType.OggOpus });
}

// ─── Connection management (for join+leave path) ──────────────────
function clearIdleTimer(entry) {
    if (entry?.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
    }
}

function scheduleTeardown(guildId) {
    const entry = warmConnections.get(guildId);
    if (!entry) return;
    clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
        const current = warmConnections.get(guildId);
        if (!current) return;
        try { current.connection.destroy(); } catch (_) {}
        warmConnections.delete(guildId);
        console.log('[Voice] Idle teardown.');
    }, KEEPALIVE_MS);
}

/**
 * Get a warm connection we own, or create one. We only ever destroy/replace
 * a connection that lives in our own warmConnections map — never one owned
 * by another module (e.g. voiceFlirtHandler's monitoring connection).
 */
async function getOrJoinConnection(voiceChannel, guildId) {
    const existing = warmConnections.get(guildId);
    if (existing && existing.channelId === voiceChannel.id) {
        const status = existing.connection.state.status;
        if (status === VoiceConnectionStatus.Ready ||
            status === VoiceConnectionStatus.Signalling ||
            status === VoiceConnectionStatus.Connecting) {
            clearIdleTimer(existing);
            if (status !== VoiceConnectionStatus.Ready) {
                await entersState(existing.connection, VoiceConnectionStatus.Ready, 15_000);
            }
            return existing;
        }
        try { existing.connection.destroy(); } catch (_) {}
        warmConnections.delete(guildId);
    } else if (existing) {
        try { existing.connection.destroy(); } catch (_) {}
        warmConnections.delete(guildId);
    }

    // If discord.js is already tracking a connection for this guild and it
    // ISN'T ours, that's the monitor — leave it alone and just play through it.
    const orphan = getVoiceConnection(guildId);
    if (orphan) {
        // Caller should have used playOnConnection. Surface this so the bug
        // is loud rather than silently destroying the monitor.
        throw new Error(
            `Voice connection already exists for guild ${guildId} (likely owned by ` +
            `voiceFlirtHandler). Use playOnConnection / speakInGuild instead of playInVoice.`
        );
    }

    const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       false,
    });

    const player = createAudioPlayer();
    player.on('error', err => console.error('[Voice] Player error:', err.message));
    connection.subscribe(player);
    connectionPlayers.set(connection, player);

    connection.on(VoiceConnectionStatus.Disconnected, () => {
        const e = warmConnections.get(guildId);
        if (e?.connection === connection) warmConnections.delete(guildId);
    });

    const entry = { connection, channelId: voiceChannel.id, player, idleTimer: null };
    warmConnections.set(guildId, entry);

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    return entry;
}

// ─── Public: play on a pre-existing connection ────────────────────
/**
 * Speak `text` on an already-connected VoiceConnection without joining or
 * destroying it. Used by voiceFlirtHandler for its long-lived monitoring
 * connection. Plays are serialised per connection so back-to-back calls
 * don't clobber each other.
 *
 * Signature kept compatible with voiceFlirtHandler's call sites:
 *   playOnConnection(connection, guildId, text)
 */
async function playOnConnection(connection, guildId, text) {
    if (!connection) throw new Error('playOnConnection: connection is required');

    // Serialise plays on this connection so a fast-arriving second quip
    // doesn't interrupt the first one mid-sentence.
    const previous = connectionLocks.get(connection) || Promise.resolve();
    let release;
    const next = new Promise(res => { release = res; });
    connectionLocks.set(connection, previous.then(() => next));

    try {
        await previous;
        await sodium.ready;

        const [buffer] = await Promise.all([
            fetchTTS(text),
            connection.state.status === VoiceConnectionStatus.Ready
                ? Promise.resolve()
                : entersState(connection, VoiceConnectionStatus.Ready, 15_000),
        ]);

        // Reuse the connection's player if we have one, otherwise create + subscribe.
        let player = connectionPlayers.get(connection);
        if (!player) {
            player = createAudioPlayer();
            player.on('error', err => console.error('[Voice] Player error:', err.message));
            connection.subscribe(player);
            connectionPlayers.set(connection, player);
        }

        player.play(makeAudioResource(buffer));
        await entersState(player, AudioPlayerStatus.Idle, 60_000);
        return true;
    } catch (err) {
        console.error('[Voice] playOnConnection error:', err.message);
        return false;
    } finally {
        release();
    }
}

// ─── Public: text-channel triggered, join + speak + auto-teardown ─
async function playInVoice(member, text, guildId) {
    if (activeSessions.has(guildId))  { console.log('[Voice] Already active.'); return false; }
    if (!state.canJoinVoice(guildId)) { console.log('[Voice] Cooldown.');       return false; }

    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) { console.log('[Voice] Member not in VC.'); return false; }

    // If the monitor (voiceFlirtHandler) already owns a connection in this
    // guild, route through it instead of trying to take over.
    const existingConn = getVoiceConnection(guildId);
    const ownWarm = warmConnections.get(guildId);
    if (existingConn && existingConn !== ownWarm?.connection) {
        console.log('[Voice] Routing through monitor connection.');
        return playOnConnection(existingConn, guildId, text);
    }

    activeSessions.add(guildId);
    state.recordVoiceJoin(guildId);

    try {
        await sodium.ready;

        console.log(`[Voice] Fetching TTS + joining VC in parallel: "${text}"`);

        // Run TTS fetch and channel join CONCURRENTLY — biggest single win.
        const [buffer, entry] = await Promise.all([
            fetchTTS(text),
            getOrJoinConnection(voiceChannel, guildId),
        ]);

        console.log(`[Voice] Ready. Buffer: ${buffer.length} bytes. Playing.`);

        entry.player.play(makeAudioResource(buffer));
        await entersState(entry.player, AudioPlayerStatus.Idle, 60_000);
        console.log('[Voice] Playback done.');

        // Keep connection warm; tear down after KEEPALIVE_MS of inactivity.
        scheduleTeardown(guildId);
        return true;

    } catch (err) {
        console.error('[Voice] Error:', err.message);
        const entry = warmConnections.get(guildId);
        if (entry) {
            try { entry.connection.destroy(); } catch (_) {}
            warmConnections.delete(guildId);
        }
        return false;
    } finally {
        activeSessions.delete(guildId);
    }
}

module.exports = { playInVoice, playOnConnection };
