'use strict';

require('dotenv').config({ path: __dirname + '/.env' });

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
} = require('discord.js');

const { handle }  = require('./handlers/messageHandler');
const state       = require('./state/stateManager');

// ─── Validate required env vars ───────────────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,   // ← Privileged: enable in Dev Portal
    ],
});

// ─── Slash command definitions ────────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('rizz')
        .setDescription("Check a user's current rizz score and status")
        .addUserOption(opt =>
            opt.setName('user')
               .setDescription('The user to inspect')
               .setRequired(true)
        )
        .toJSON(),
];

// ─── Register slash commands on startup ───────────────────────────────────────
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('📡 Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered globally.');
    } catch (err) {
        console.error('❌ Failed to register commands:', err.message);
    }
}

// ─── Rizz status label helper ─────────────────────────────────────────────────
function getRizzLabel(score) {
    if (score >= 80) return '🔥 Certified Fuckboy/Fuckgirl';
    if (score >= 60) return '😬 Highly Suspicious';
    if (score >= 30) return '👀 Slightly Flirty';
    return '😇 Clean (for now)';
}

function getRizzColour(score) {
    if (score >= 80) return 0xFF0000;  // red
    if (score >= 60) return 0xFF8C00;  // orange
    if (score >= 30) return 0xFFFF00;  // yellow
    return 0x00CC44;                    // green
}

// ─── Bot ready ───────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`\n🤖 Rizzless is online as ${client.user.tag}`);
    console.log(`   Guilds: ${client.guilds.cache.size}`);
    await registerCommands();
});

// ─── Message events ───────────────────────────────────────────────────────────
client.on('messageCreate', message => {
    handle(message).catch(err => console.error('[messageCreate]', err));
});

// ─── Interaction events ───────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'rizz') {
        const target   = interaction.options.getUser('user');
        const userData = state.getUser(target.id);
        const score    = userData?.aggregateScore ?? 0;
        const label    = getRizzLabel(score);

        // Build a clean embed for readability
        const embed = new EmbedBuilder()
            .setTitle('📊 Rizzless Report')
            .setColor(getRizzColour(score))
            .addFields(
                { name: 'User',   value: `<@${target.id}>`,       inline: true },
                { name: 'Score',  value: `**${score} / 100**`,     inline: true },
                { name: 'Status', value: label,                     inline: true },
            )
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: 'Rizzless — Rizz Detection System' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
});

// ─── Error handling ───────────────────────────────────────────────────────────
client.on('error',   err => console.error('[Client error]',   err));
client.on('warn',    msg => console.warn( '[Client warning]', msg));
process.on('unhandledRejection', err => console.error('[Unhandled rejection]', err));

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
