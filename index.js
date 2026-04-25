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

const { handle }      = require('./handlers/messageHandler');
const { joinAndMonitor, onMemberLeave } = require('./handlers/voiceFlirtHandler');
const state           = require('./state/stateManager');

const REQUIRED_ENV = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

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

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('📡 Registering slash commands...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Slash commands registered globally.');
    } catch (err) {
        console.error('❌ Failed to register commands:', err.message);
    }
}

function getRizzLabel(score) {
    if (score >= 80) return '🔥 Certified Fuckboy/Fuckgirl';
    if (score >= 60) return '😬 Highly Suspicious';
    if (score >= 30) return '👀 Slightly Flirty';
    return '😇 Clean (for now)';
}

function getRizzColour(score) {
    if (score >= 80) return 0xFF0000;
    if (score >= 60) return 0xFF8C00;
    if (score >= 30) return 0xFFFF00;
    return 0x00CC44;
}

// ─── Ready ────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`\n🤖 Rizzless is online as ${client.user.tag}`);
    console.log(`   Guilds: ${client.guilds.cache.size}`);
    await registerCommands();
});

// ─── Messages ─────────────────────────────────────────────────────
client.on('messageCreate', message => {
    handle(message).catch(err => console.error('[messageCreate]', err));
});

// ─── Slash commands ───────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'rizz') {
        const target   = interaction.options.getUser('user');
        const userData = state.getUser(target.id);
        const score    = userData?.aggregateScore ?? 0;
        const embed = new EmbedBuilder()
            .setTitle('📊 Rizzless Report')
            .setColor(getRizzColour(score))
            .addFields(
                { name: 'User',   value: `<@${target.id}>`,   inline: true },
                { name: 'Score',  value: `**${score} / 100**`, inline: true },
                { name: 'Status', value: getRizzLabel(score),   inline: true },
            )
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: 'Rizzless — Rizz Detection System' })
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    }
});

// ─── Voice state updates ──────────────────────────────────────────────────────
const voiceJoinLock = new Set();

client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const guildId = (newState.guild ?? oldState.guild).id;

    // ── Member left a channel ────────────────────────────────────────────────
    if (oldState.channelId && !newState.channelId) {
        onMemberLeave(oldState);
        return;
    }

    // ── Member moved between channels ────────────────────────────────────────
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        onMemberLeave(oldState); // may trigger leave-if-empty for old channel
        // fall through to handle as a fresh join in the new channel
    }

    // ── Fresh join ───────────────────────────────────────────────────────────
    if (!newState.channelId) return;

    if (voiceJoinLock.has(guildId)) return;
    voiceJoinLock.add(guildId);

    try {
        console.log(`[VC] ${member.user.username} joined voice`);
        await new Promise(r => setTimeout(r, 2000));

        const freshMember = await newState.guild.members.fetch(member.id);
        if (!freshMember.voice?.channelId) {
            console.log('[VC] Member already left, skipping.');
            return;
        }

        // Find the first text channel the bot can write to (for moderation messages)
        const textChannel = newState.guild.channels.cache.find(
            ch => ch.isTextBased() && ch.permissionsFor(newState.guild.members.me)?.has('SendMessages')
        ) ?? null;

        await joinAndMonitor(freshMember, guildId, textChannel);

    } finally {
        voiceJoinLock.delete(guildId);
    }
});

// ─── Errors ───────────────────────────────────────────────────────
client.on('error', err => console.error('[Client error]', err));
client.on('warn',  msg => console.warn('[Client warning]', msg));
process.on('unhandledRejection', err => console.error('[Unhandled rejection]', err));

// ─── Login ────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});