'use strict';

const { GoogleAuth } = require('google-auth-library');

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

// Explicit project ID — overrides any stale fallback project the auth library
// might otherwise pick up. This is what Google bills for the call.
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || 'gen-lang-client-0420871328';

// Service account auth. Reads GOOGLE_APPLICATION_CREDENTIALS (path to JSON key
// file) from env. Tokens are cached and auto-refreshed by GoogleAuth, so this
// is essentially free after the first call.
const auth = new GoogleAuth({
    scopes:         ['https://www.googleapis.com/auth/cloud-platform'],
    projectId:      PROJECT_ID,
});

let cachedClient = null;
async function getAuthClient() {
    if (!cachedClient) {
        cachedClient = await auth.getClient();
        // Force the quota project so the API bills the right project,
        // even if the credential file doesn't carry one.
        cachedClient.quotaProjectId = PROJECT_ID;
    }
    return cachedClient;
}

// Labels that suggest romantic/flirtatious image content
const ROMANTIC_LABELS = new Set([
    'heart', 'kiss', 'romance', 'love', 'couple', 'wedding',
    'valentine', 'hug', 'flirt', 'intimacy', 'affection',
    'flower', 'rose', 'lingerie', 'embrace', 'passion',
    'desire', 'seduction', 'relationship',
]);

const LIKELIHOOD_PTS = {
    VERY_LIKELY:    35,
    LIKELY:         20,
    POSSIBLE:       10,
    UNLIKELY:        0,
    VERY_UNLIKELY:   0,
    UNKNOWN:         0,
};

async function analyzeImage(imageUrl) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.warn('[Vision] GOOGLE_APPLICATION_CREDENTIALS not set — skipping image analysis');
        return { score: 0, reason: 'Vision API not configured' };
    }

    try {
        const client = await getAuthClient();
        const res = await client.request({
            url:    VISION_URL,
            method: 'POST',
            data: {
                requests: [{
                    image: { source: { imageUri: imageUrl } },
                    features: [
                        { type: 'SAFE_SEARCH_DETECTION'          },
                        { type: 'LABEL_DETECTION', maxResults: 20 },
                        { type: 'FACE_DETECTION',  maxResults: 5  },
                    ],
                }],
            },
        });

        const data     = res.data;
        const response = data.responses?.[0];
        if (!response) return { score: 0, reason: 'Empty Vision response' };

        let score   = 0;
        const hits  = [];

        const safe = response.safeSearchAnnotation;
        if (safe) {
            const adultPts = LIKELIHOOD_PTS[safe.adult]  ?? 0;
            const racyPts  = LIKELIHOOD_PTS[safe.racy]   ?? 0;
            if (adultPts > 0) { score += adultPts; hits.push(`adult content (${safe.adult})`);  }
            if (racyPts  > 0) { score += racyPts;  hits.push(`racy content (${safe.racy})`);    }
        }

        const labels = response.labelAnnotations ?? [];
        for (const label of labels) {
            if (ROMANTIC_LABELS.has(label.description.toLowerCase())) {
                const pts = Math.round(label.score * 25);
                score += pts;
                hits.push(`"${label.description}" (${Math.round(label.score * 100)}% confidence)`);
            }
        }

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

function getImageUrls(message) {
    const urls = [];
    for (const att of message.attachments.values()) {
        if (att.contentType?.startsWith('image/')) {
            urls.push(att.url);
        }
    }
    for (const embed of message.embeds) {
        if (embed.image?.url)     urls.push(embed.image.url);
        if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
    }
    return urls;
}

module.exports = { analyzeImage, getImageUrls };
