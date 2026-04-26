# Rizzless 🚨

> Real-time Discord bot that detects, scores, and brutally roasts flirty behaviour in text, voice, and images — with AI-generated comebacks tailored to whatever you actually said.

---

## What it does

| Surface | Behaviour |
|---|---|
| **Text messages** | Every message scored 0–100 by Gemma 4. Flirty messages get a content-aware AI roast referencing what you actually said. |
| **Voice chat** | Bot joins your VC, transcribes everyone's speech via Groq Whisper, scores it, and roasts you out loud through ElevenLabs TTS. |
| **Images** | Google Cloud Vision flags hearts, kisses, racy/adult content, and joyful faces. The bot weaves what it saw into the roast. |
| **DM escalation** | Private warnings for repeat offenders. |
| **Cheating detection** | Public callout when you flirt at multiple people within 2 minutes. |
| **Discord timeouts** | Automatic mutes for severe repeat offenders. |
| **`/rizz` command** | Look up any user's aggregate rizz score. |

---

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org))
- **A Discord server** you have admin permissions on
- **API accounts** at the following providers (all have free tiers, except Vision which uses Google Cloud credit):
  - Discord Developer Portal
  - Google AI Studio (for Gemma 4 LLM)
  - Groq (for voice transcription)
  - ElevenLabs (for TTS voice output)
  - Google Cloud (for image moderation)

---

## Setup

### 1. Discord bot

1. Go to https://discord.com/developers/applications → **New Application**
2. Navigate to **Bot** in the left sidebar → copy your **Token**
3. On the same page, scroll to **Privileged Gateway Intents** and enable:
   - ✅ **Message Content Intent**
   - ✅ **Server Members Intent**
4. Navigate to **General Information** → copy your **Application ID** (this is your `CLIENT_ID`)
5. Navigate to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Read Messages/View Channels`, `Moderate Members`, `Connect`, `Speak`
6. Open the generated URL and invite the bot to your server

### 2. Google AI Studio (Gemma 4)

1. Go to https://aistudio.google.com/apikey
2. Click **Create API key** → choose any project (or create new)
3. Copy the key — this is your `GOOGLE_AI_API_KEY`
4. Free tier gives 1,500 requests/day — plenty for personal use

### 3. Groq (voice transcription)

1. Go to https://console.groq.com/keys
2. Create an API key → copy it — this is your `GROQ_API_KEY`
3. Free tier with no credit card required

### 4. ElevenLabs (TTS)

1. Sign up at https://elevenlabs.io
2. Go to **Profile → API Key** → copy it — this is your `ELEVENLABS_API_KEY`
3. (Optional) Browse https://elevenlabs.io/voice-library to pick a voice → copy its ID for `ELEVENLABS_VOICE_ID`

### 5. Google Cloud Vision (image moderation)

This is the most involved setup since Vision requires service account auth.

1. Go to https://console.cloud.google.com → create a new project (or pick one with billing enabled)
2. Enable Vision API: https://console.cloud.google.com/apis/library/vision.googleapis.com → click **Enable**
3. Create a service account:
   - Go to https://console.cloud.google.com/iam-admin/serviceaccounts
   - Click **+ Create Service Account**
   - Name it `rizzless-vision`
   - Grant role: **Editor** (or **Cloud Vision API User** if visible)
   - Click **Done**
4. Generate a JSON key:
   - Click into the new service account → **Keys** tab
   - **Add Key → Create new key → JSON**
   - A `.json` file downloads
5. Move the key into your project:
   ```bash
   mv ~/Downloads/your-project-*.json ./google-vision-key.json
   echo "google-vision-key.json" >> .gitignore
   ```
6. Set up billing (required even for free-tier usage):
   - https://console.cloud.google.com/billing → add a payment method to your project
   - Optional but recommended: set a $5 budget alert at https://console.cloud.google.com/billing/budgets

> ⚠️ **Never commit `google-vision-key.json` to git.** Anyone with this file can call Vision API on your billing account.

### 6. Install and configure

```bash
# Clone the project
git clone <repo-url> rizzless
cd rizzless

# Install dependencies
npm install

# Create the .env file
touch .env
```

Open `.env` in any text editor and paste this template, replacing each `<...>` with your actual values:

```bash
# Discord
DISCORD_TOKEN=<your bot token>
CLIENT_ID=<your application id>

# Gemma 4 LLM (scoring + adaptive quips)
GOOGLE_AI_API_KEY=<your AI Studio API key>
GEMMA_MODEL=gemma-4-31b-it

# Groq (voice transcription)
GROQ_API_KEY=<your Groq key>

# ElevenLabs (TTS)
ELEVENLABS_API_KEY=<your ElevenLabs key>
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL=eleven_flash_v2_5

# Google Cloud Vision (image moderation)
GOOGLE_APPLICATION_CREDENTIALS=./google-vision-key.json
GOOGLE_CLOUD_PROJECT_ID=<your GCP project id, e.g. gen-lang-client-0420871328>

# Optional tuning
THRESH_VOICE=60
VOICE_CALLOUT_COOLDOWN_MS=15000
```

### 7. Start the bot

```bash
npm start
```

You should see:

```
[Gemma] Using model: gemma-4-31b-it
✅ Slash commands registered globally.
🤖 Rizzless is online as YourBotName#1234
```

If anything errors at startup, the log line tells you which env var is missing or which API rejected your key.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Bot token from Discord Dev Portal |
| `CLIENT_ID` | ✅ | — | Application ID for slash command registration |
| `GOOGLE_AI_API_KEY` | ✅ | — | AI Studio API key for Gemma 4 |
| `GEMMA_MODEL` | ❌ | `gemma-4-26b-a4b-it` | Model name (e.g. `gemma-4-31b-it`, `gemini-2.5-flash`) |
| `GROQ_API_KEY` | ✅ | — | Groq API key for Whisper transcription |
| `ELEVENLABS_API_KEY` | ✅ | — | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | ❌ | Bella | Voice ID from ElevenLabs library |
| `ELEVENLABS_MODEL` | ❌ | `eleven_flash_v2_5` | TTS model |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ | — | Path to Vision API service account JSON. Omit to disable image scoring. |
| `GOOGLE_CLOUD_PROJECT_ID` | ❌ | `gen-lang-client-0420871328` | GCP project ID Vision API bills to |
| `THRESH_VOICE` | ❌ | `60` | Score threshold for voice callouts |
| `VOICE_CALLOUT_COOLDOWN_MS` | ❌ | `15000` | Per-user voice callout cooldown |

---

## How to test

After `npm start` succeeds, run through this in your Discord server:

1. **Mild flirt** — send `hey cutie 😉` → bot replies with a mild callout
2. **Strong flirt** — send `omg you're literally so perfect, I love you so much` → stronger response + meme reaction
3. **Voice flirt** — join a voice channel, then have the bot join via `voiceStateUpdate`, then say something cringey out loud. Bot transcribes, scores, and speaks back a roast.
4. **Image moderation** — post a picture with a heart, kiss, or racy content. Vision flags it and the bot's response references the image.
5. **Cheating detection** — within 2 minutes, send two flirty messages that `@mention` two different users. Bot fires a public cheat callout.
6. **`/rizz` command** — run `/rizz @user` to see their aggregate score embed.

---

## Project Structure

```
rizzless/
├── index.js                       # Bot entry, slash commands, event routing
├── handlers/
│   ├── messageHandler.js          # Orchestrates per-message logic (text + image)
│   └── voiceFlirtHandler.js       # VC monitoring, transcription, callouts
├── services/
│   ├── scoringService.js          # Gemma 4 flirt scoring (0–100)
│   ├── adaptiveQuipService.js     # Gemma 4 content-aware roast generation
│   ├── transcriptionService.js    # Groq Whisper voice transcription
│   ├── voiceService.js            # ElevenLabs TTS + Discord voice playback
│   ├── visionService.js           # Google Cloud Vision image analysis
│   └── moderationService.js       # DM escalation, cheat detection, timeouts
├── state/
│   └── stateManager.js            # In-memory user state and cooldowns
├── config/
│   └── responses.js               # Static fallback response templates
├── google-vision-key.json         # Vision service account (DO NOT COMMIT)
├── .env                           # Secrets (DO NOT COMMIT)
└── package.json
```

---

## Cooldowns & limits

| Action | Cooldown / Limit |
|---|---|
| Per-user text response | 15 seconds |
| Per-user voice callout | 15 seconds (configurable) |
| Voice channel join (per guild) | 30 seconds |
| Meme post (per channel) | 20 seconds |
| DM warning (per user) | 60 seconds |
| Cheat callout (per user) | 90 seconds |

---

## Cost notes

All services have free tiers that cover normal personal/hobby use:

| Service | Free tier | What you'd burn through it with |
|---|---|---|
| Gemma 4 (Gemini API) | 1,500 requests/day | ~750 flirty messages/day |
| Groq Whisper | 2,000 requests/day | A LOT of voice activity |
| ElevenLabs | 10K characters/month | Roughly 200 voice callouts |
| Google Vision | 1,000 units/feature/month free, then ~$1.50/1k | ~500 free images/month |

---

## Notes

- **All user state is in-memory** — restarting the bot wipes scores, warnings, and cooldowns.
- Slash commands register globally on first launch — first-time propagation can take up to an hour. Use guild-scoped registration during dev for instant updates.
- The bot must be **higher in the role hierarchy** than the users it tries to timeout.
- Voice playback uses Opus directly — no FFmpeg required.
- The `voiceFlirtHandler` listener cleans up per-user state on every utterance end (success, too-short, or error). Don't add early-return paths without freeing the lock.

---

## Troubleshooting

**`Used disallowed intents`** — you didn't enable the Privileged Gateway Intents in the Discord Dev Portal (step 1.3).

**`Your prepayment credits are depleted`** — your Gemma API key is on a billing account whose credits ran out. Generate a new key from a different project or top up.

**`Vision API has not been used in project XXX`** — either the API isn't enabled on the project your service account belongs to, *or* an unset `GOOGLE_APPLICATION_CREDENTIALS` is causing the auth library to fall back to a different project. Verify with:
```bash
cat google-vision-key.json | grep project_id
grep GOOGLE_APPLICATION_CREDENTIALS .env
```

**Voice replies are sped up like a chipmunk** — your `voiceService.js` is using `StreamType.Raw` with mono PCM. Use `StreamType.OggOpus` with ElevenLabs' `opus_48000_128` output format instead.

**Bot doesn't respond to voice at all** — check that the bot member isn't server-deafened, that `GuildMembers` intent is enabled, and that you're talking for at least ~1 second per utterance (shorter than that gets dropped as too-short).

**Adaptive quips return null** — check the `[AdaptiveQuip]` log line. If it says "Generation failed", the LLM call errored. Usually means an expired API key, a depleted credit balance, or an invalid model name in `GEMMA_MODEL`.
