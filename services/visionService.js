'use strict';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

// Labels that suggest romantic/flirtatious image content
const ROMANTIC_LABELS = new Set([
    'heart', 'kiss', 'romance', 'love', 'couple', 'wedding',
    'valentine', 'hug', 'flirt', 'intimacy', 'affection',
    'flower', 'rose', 'lingerie', 'embrace', 'passion',
    'desire', 'seduction', 'relationship',
]);

// Maps Vision API likelihood strings → score contribution
const LIKELIHOOD_PTS = {
    VERY_LIKELY:    35,
    LIKELY:         20,
    POSSIBLE:       10,
    UNLIKELY:        0,
    VERY_UNLIKELY:   0,
    UNKNOWN:         0,
};

/**
 * Analyse a single image URL via Google Cloud Vision API.
 * Returns a { score: 0–100, reason: string } object.
 *
 * @param {string} imageUrl Publicly accessible image URL
 * @returns {Promise<{ score: number, reason: string }>}
 */
async function analyzeImage(imageUrl) {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
        console.warn('[Vision] GOOGLE_CLOUD_API_KEY not set — skipping image analysis');
        return { score: 0, reason: 'Vision API not configured' };
    }

    try {
        const res = await fetch(`${VISION_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { source: { imageUri: imageUrl } },
                    features: [
                        { type: 'SAFE_SEARCH_DETECTION'          },
                        { type: 'LABEL_DETECTION', maxResults: 20 },
                        { type: 'FACE_DETECTION',  maxResults: 5  },
                    ],
                }],
            }),
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Vision API ${res.status}: ${body}`);
        }

        const data     = await res.json();
        const response = data.responses?.[0];
        if (!response) return { score: 0, reason: 'Empty Vision response' };

        let score   = 0;
        const hits  = [];

        // ── SafeSearch (adult / racy content) ────────────────────────────────
        const safe = response.safeSearchAnnotation;
        if (safe) {
            const adultPts = LIKELIHOOD_PTS[safe.adult]  ?? 0;
            const racyPts  = LIKELIHOOD_PTS[safe.racy]   ?? 0;
            if (adultPts > 0) { score += adultPts; hits.push(`adult content (${safe.adult})`);  }
            if (racyPts  > 0) { score += racyPts;  hits.push(`racy content (${safe.racy})`);    }
        }

        // ── Romantic label detection ─────────────────────────────────────────
        const labels = response.labelAnnotations ?? [];
        for (const label of labels) {
            if (ROMANTIC_LABELS.has(label.description.toLowerCase())) {
                const pts = Math.round(label.score * 25); // confidence × 25 max
                score += pts;
                hits.push(`"${label.description}" (${Math.round(label.score * 100)}% confidence)`);
            }
        }

        // ── Face emotion boost ────────────────────────────────────────────────
        const faces = response.faceAnnotations ?? [];
        for (const face of faces) {
            if (face.joyLikelihood === 'VERY_LIKELY' || face.joyLikelihood === 'LIKELY') {
                score += 5;
            }
        }

        score = Math.min(100, score);
        const reason = hits.length > 0
            ? hits.join(', ')
            : 'No romantic content detected in image';

        console.log(`[Vision] ${score}/100 — ${reason}`);
        return { score, reason };

    } catch (err) {
        console.error('[Vision] Error:', err.message);
        return { score: 0, reason: 'Vision API error' };
    }
}

/**
 * Extract image attachment URLs from a Discord message.
 * Filters to known image content types only.
 *
 * @param {import('discord.js').Message} message
 * @returns {string[]} Array of image URLs
 */
function getImageUrls(message) {
    const urls = [];

    // Attachments (uploaded files)
    for (const att of message.attachments.values()) {
        if (att.contentType?.startsWith('image/')) {
            urls.push(att.url);
        }
    }

    // Embeds with image thumbnails or images
    for (const embed of message.embeds) {
        if (embed.image?.url)     urls.push(embed.image.url);
        if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
    }

    return urls;
}

module.exports = { analyzeImage, getImageUrls };
