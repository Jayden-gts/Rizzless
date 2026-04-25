require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { playInVoice } = require('./services/voiceService');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ]
});

client.on('raw', packet => {
    if (packet.t === 'VOICE_SERVER_UPDATE') {
        console.log('[RAW] VOICE_SERVER_UPDATE:', JSON.stringify(packet.d));
    }
    if (packet.t === 'VOICE_STATE_UPDATE') {
        console.log('[RAW] VOICE_STATE_UPDATE channel:', packet.d.channel_id);
    }
});

client.once('ready', async () => {
    await new Promise(r => setTimeout(r, 3000));
    
    const guild = client.guilds.cache.get('1497405699339321414');
    await guild.members.fetch();
    
    const voiceMember = guild.members.cache.find(m => m.voice?.channel && !m.user.bot);
    console.log('Found in VC:', voiceMember?.user?.username, '| ID:', voiceMember?.id);
    
    if (!voiceMember) {
        console.log('Nobody in VC');
        process.exit(1);
    }

    const result = await playInVoice(voiceMember, 'This is a test.', guild.id);
    console.log('Result:', result);
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
