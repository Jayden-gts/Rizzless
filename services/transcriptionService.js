'use strict';

const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');

// 0.6 seconds of 48 kHz stereo 16-bit PCM — minimum worth transcribing
const MIN_PCM_BYTES = 48_000 * 2 * 2 * 0.6;

// ─── WAV helper ───────────────────────────────────────────────────────────────

function pcmToWav(pcmBuffer, sampleRate = 48_000, channels = 2) {
    const byteRate   = sampleRate * channels * 2;
    const blockAlign = channels * 2;
    const header     = Buffer.alloc(44);

    header.write('RIFF',  0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE',  8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);       // chunk size
    header.writeUInt16LE(1,  20);       // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate,   28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);       // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);

    return Buffer.concat([header, pcmBuffer]);
}

// ─── Whisper transcription ────────────────────────────────────────────────────

async function transcribeBuffer(pcmBuffer) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set — add it to .env to enable voice flirt detection');

    const wav  = pcmToWav(pcmBuffer);
    const form = new FormData();
    form.append('file',  new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body:    form,
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Groq Whisper HTTP ${res.status}: ${body}`);
    }

    const data = await res.json();
    return (data.text ?? '').trim();
}

// ─── Subscribe helper ─────────────────────────────────────────────────────────

/**
 * Subscribe to ONE utterance from a user.
 * Auto-closes when silence is detected; calls onTranscript(text) with the result.
 * The caller is responsible for re-subscribing (e.g. on the next 'speaking' event).
 *
 * @param {import('@discordjs/voice').VoiceReceiver} receiver
 * @param {string}   userId
 * @param {function} onTranscript  - async (text: string) => void
 */
function subscribeToUtterance(receiver, userId, onTranscript) {
    const audioStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1_200 },
    });

    // Opus → raw PCM via prism's Opus decoder
    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48_000 });
    const chunks  = [];

    audioStream.pipe(decoder);
    decoder.on('data', chunk => chunks.push(chunk));

    decoder.on('end', async () => {
        const pcm = Buffer.concat(chunks);
        if (pcm.length < MIN_PCM_BYTES) {
            console.log('[Transcription] Utterance too short, skipping.');
            try { await onTranscript(null); } catch (_) {}
            return;
        }

        let text = null;
        try {
            text = await transcribeBuffer(pcm);
            if (text) {
                console.log(`[Transcription] Captured: "${text}"`);
            }
        } catch (err) {
            console.error('[Transcription] Error:', err.message);
        }

        // Always invoke callback so the caller can release any per-user
        // locks. text is null when nothing usable was captured.
        try { await onTranscript(text || null); } catch (cbErr) {
            console.error('[Transcription] Callback error:', cbErr.message);
        }
    });

    audioStream.on('error', err => console.error('[Transcription] Stream error:', err.message));

    return audioStream;
}

module.exports = { subscribeToUtterance };
