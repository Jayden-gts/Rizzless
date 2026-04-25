require('dotenv').config();
const WebSocket = require('ws');
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const serverId = '1497405699339321414';
const userId   = '1497452336782508093';

let sessionId;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMembers,
    ] 
});

client.on('raw', packet => {
    if (packet.t === 'VOICE_STATE_UPDATE' && packet.d.user_id === userId) {
        sessionId = packet.d.session_id;
        console.log('Session ID:', sessionId);
    }
    if (packet.t === 'VOICE_SERVER_UPDATE') {
        const { token, endpoint } = packet.d;
        console.log('Voice server endpoint:', endpoint);

        const ws = new WebSocket('wss://' + endpoint + '/?v=4', { rejectUnauthorized: false });
        
        ws.on('open', () => console.log('Raw WS opened'));
        ws.on('message', d => {
            const msg = JSON.parse(d.toString());
            console.log('Received op:', msg.op, JSON.stringify(msg.d));
            if (msg.op === 8) {
                const identify = { 
                    op: 0, 
                    d: { 
                        server_id: serverId, 
                        user_id:   userId, 
                        session_id: sessionId, 
                        token 
                    } 
                };
                console.log('Sending identify with session:', sessionId);
                ws.send(JSON.stringify(identify));
            }
        });
        ws.on('close', (code, reason) => console.log('WS Closed:', code, reason.toString()));
        ws.on('error', e => console.log('WS Error:', e.message));
    }
});

client.once('ready', async () => {
    await new Promise(r => setTimeout(r, 2000));
    const guild = client.guilds.cache.get(serverId);
    await guild.members.fetch();
    
    const member = guild.members.cache.find(m => m.voice?.channel && !m.user.bot);
    console.log('Found in VC:', member?.user?.username);

    joinVoiceChannel({
        channelId:      member.voice.channel.id,
        guildId:        serverId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf:       false,
    });

    setTimeout(() => process.exit(), 10000);
});

client.login(process.env.DISCORD_TOKEN);
