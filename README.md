# Rizzless 🚨

> Real-time Discord bot that detects, scores, and brutally calls out flirty behaviour.

---

## Features

| Feature | Details |
|---|---|
| **Rizz Scoring** | 0–100 hybrid score (keywords, emojis, mention targeting, frequency) |
| **Escalating chat responses** | Mild → Strong → Aggressive callouts |
| **Meme reactions** | GIF/image posted at score ≥ 60 (cooldown: 20 s) |
| **Voice callout** | Joins voice channel, speaks via ElevenLabs TTS at score ≥ 80 |
| **DM escalation** | Private warnings after repeated high-score messages |
| **Cheating detection** | Calls out users targeting multiple people within 2 minutes |
| **Timeout system** | Escalating timeouts (30 s → 5 min) for repeat offenders |
| **`/rizz` command** | Check any user's aggregate rizz score and status |

---

## Setup

### 1. Discord Developer Portal

1. Go to https://discord.com/developers/applications and create a new application.
2. Navigate to **Bot** → copy your **Token**.
3. On the same page, enable these **Privileged Gateway Intents**:
   - ✅ Message Content Intent
   - ✅ Server Members Intent (for timeouts)
4. Navigate to **General Information** → copy your **Application ID** (= Client ID).
5. Invite the bot to your server using OAuth2 → URL Generator with scopes:
   - `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Read Messages/View Channels`,
     `Moderate Members`, `Connect`, `Speak`, `Send TTS Messages`

### 2. ElevenLabs API Key (for voice)

1. Sign up at https://elevenlabs.io (free tier works for demos).
2. Go to **Profile → API Key** and copy your key.
3. Optionally browse https://elevenlabs.io/voice-library to pick a different voice ID.

### 3. Local setup

```bash
# Clone / copy the project
cd rizzless

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
# → Edit .env with your DISCORD_TOKEN, CLIENT_ID, ELEVENLABS_API_KEY

# Start the bot
npm start
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from Discord Dev Portal |
| `CLIENT_ID` | ✅ | Application ID for slash command registration |
| `ELEVENLABS_API_KEY` | ✅ | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | ❌ | Voice to use (default: Bella) |

---

## Demo Script

Run through this sequence to demonstrate all features:

1. **Mild flirt** — send `hey cutie 😉` → bot replies with mild callout
2. **Strong flirt** — send `omg you're so gorgeous babe 💕` → stronger response + GIF
3. **Max rizz** — send `i love you marry me xoxo 💘💋❤️ come over` → aggressive callout + bot joins voice and speaks
4. **DM escalation** — repeat step 3 within 60 s → bot DMs the user a warning
5. **Cheating** — ping two different users with flirty messages within 2 minutes → public cheat callout fires
6. **`/rizz` command** — run `/rizz @user` to see the score embed

---

## Project Structure

```
rizzless/
├── index.js                  # Bot entry, slash commands, event routing
├── handlers/
│   └── messageHandler.js     # Orchestrates per-message logic
├── services/
│   ├── scoringService.js     # Hybrid 0–100 rizz scoring
│   ├── voiceService.js       # ElevenLabs TTS + @discordjs/voice playback
│   └── moderationService.js  # DM escalation, cheat detection, timeouts
├── state/
│   └── stateManager.js       # In-memory state (users, cooldowns)
├── config/
│   └── responses.js          # All response strings and meme URLs
├── .env.example
└── package.json
```

---

## Cooldown Reference

| Action | Cooldown |
|---|---|
| Voice join (per guild) | 30 s |
| Meme post (per channel) | 20 s |
| DM warning (per user) | 60 s |
| Cheat callout (per user) | 90 s |

---

## Notes

- All state is **in-memory** — restarting the bot resets scores.
- Slash commands are registered **globally** — allow up to 1 hour to propagate on first run (use guild commands for instant updates during dev).
- Voice requires **ffmpeg** — handled automatically via `ffmpeg-static`.
- The bot needs to be **higher in the role hierarchy** than users it timeouts.
