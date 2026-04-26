'use strict';

const { EmbedBuilder } = require('discord.js');

const TIERS = [
    { name: '💀 Rizzless Hall of Shame', minScore: 90, color: 0x8e44ad },
    { name: '🚨 Certified Simp',         minScore: 80, color: 0xe74c3c },
    { name: '😬 Caught in 4K',           minScore: 60, color: 0xe67e22 },
];

const CHANNEL_NAME = 'rizzless-leaderboard';
const leaderboardCache = new Map();
const activeOffenders  = new Map();

function getTierForScore(score) {
    return TIERS.find(t => score >= t.minScore) ?? null;
}

async function setupLeaderboard(guild) {
    const existing = await guild.roles.fetch();
    for (const tier of TIERS) {
        if (!existing.find(r => r.name === tier.name)) {
            await guild.roles.create({
                name:   tier.name,
                color:  tier.color,
                reason: 'Rizzless tier role',
            });
            console.log(`[Roles] Created role: ${tier.name}`);
        }
    }

    let channel = guild.channels.cache.find(c => c.name === CHANNEL_NAME);
    if (!channel) {
        channel = await guild.channels.create({
            name:   CHANNEL_NAME,
            reason: 'Rizzless leaderboard channel',
        });
        console.log(`[Leaderboard] Created channel #${CHANNEL_NAME}`);
    }

    // Repopulate activeOffenders from existing role assignments
    activeOffenders.set(guild.id, new Map());
    const offenders = activeOffenders.get(guild.id);
    const members   = await guild.members.fetch();

    for (const member of members.values()) {
        if (member.user.bot) continue;
        for (const tier of TIERS) {
            const hasRole = member.roles.cache.find(r => r.name === tier.name);
            if (hasRole) {
                offenders.set(member.id, {
                    userId:   member.id,
                    username: member.user.username,
                    score:    tier.minScore,
                    tier:     tier.name,
                });
                console.log(`[Leaderboard] Restored ${member.user.username} — ${tier.name}`);
                break;
            }
        }
    }

    // Delete all old leaderboard messages and pins to avoid clutter
    const oldPins = await channel.messages.fetchPinned();
    for (const pin of oldPins.values()) {
        if (pin.author.bot && pin.embeds[0]?.title?.includes('Rizzless Leaderboard')) {
            await pin.unpin().catch(() => {});
            await pin.delete().catch(() => {});
        }
    }

    // Post a fresh single message and pin it
    const msg = await channel.send({ embeds: [buildEmbed(guild.id)] });
    await msg.pin().catch(() => {});

    leaderboardCache.set(guild.id, { channelId: channel.id, messageId: msg.id });
    console.log(`[Leaderboard] Ready in #${CHANNEL_NAME}`);
}

function buildEmbed(guildId) {
    const offenders = activeOffenders.get(guildId) ?? new Map();

    const embed = new EmbedBuilder()
        .setTitle('🏆 Rizzless Leaderboard — Current Offenders')
        .setColor(0x8e44ad)
        .setTimestamp()
        .setFooter({ text: 'Say something normal to get off this list.' });

    if (offenders.size === 0) {
        embed.setDescription('✅ No active offenders. The server is clean... for now.');
        return embed;
    }

    const lines = [...offenders.values()]
        .sort((a, b) => b.score - a.score)
        .map((o, i) => `${i + 1}. @${o.username} — **${o.tier}** (score: ${o.score})`);

    embed.setDescription(lines.join('\n'));
    return embed;
}

async function refreshLeaderboard(guild) {
    const cache = leaderboardCache.get(guild.id);
    if (!cache) return;

    try {
        const channel = await guild.channels.fetch(cache.channelId);
        const message = await channel.messages.fetch(cache.messageId);
        await message.edit({ embeds: [buildEmbed(guild.id)] });
    } catch (err) {
        console.error('[Leaderboard] Failed to refresh:', err.message);
    }
}

async function flagUser(member, score) {
    const tier = getTierForScore(score);
    if (!tier) return;

    const guild    = member.guild;
    const allRoles = await guild.roles.fetch();

    const tierRoleObjs = TIERS
        .map(t => allRoles.find(r => r.name === t.name))
        .filter(Boolean);
    const toRemove = member.roles.cache.filter(r => tierRoleObjs.some(tr => tr.id === r.id));
    if (toRemove.size > 0) await member.roles.remove(toRemove);

    const newRole = allRoles.find(r => r.name === tier.name);
    if (newRole) await member.roles.add(newRole);

    const offenders = activeOffenders.get(guild.id) ?? new Map();
    offenders.set(member.id, {
        userId:   member.id,
        username: member.user.username,
        score,
        tier:     tier.name,
    });
    activeOffenders.set(guild.id, offenders);

    console.log(`[Leaderboard] Flagged ${member.user.username} — ${tier.name} (score: ${score})`);
    await refreshLeaderboard(guild);
}

async function clearUser(member) {
    const guild    = member.guild;
    const allRoles = await guild.roles.fetch();

    const tierRoleObjs = TIERS
        .map(t => allRoles.find(r => r.name === t.name))
        .filter(Boolean);
    const toRemove = member.roles.cache.filter(r => tierRoleObjs.some(tr => tr.id === r.id));
    if (toRemove.size > 0) await member.roles.remove(toRemove);

    const offenders = activeOffenders.get(guild.id);
    if (offenders?.has(member.id)) {
        offenders.delete(member.id);
        console.log(`[Leaderboard] Cleared ${member.user.username} from leaderboard`);
        await refreshLeaderboard(guild);
    }
}

module.exports = { setupLeaderboard, flagUser, clearUser };