const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const yaml = require('js-yaml');

const SCHEDULE_CONFIG = [
    { id: "morning_start", label: "08:00", hour: 8 },   // Wake up, check phone
    { id: "lunch_break", label: "12:00", hour: 12 },   // Mid-day activity
    { id: "afternoon_vibes", label: "15:00", hour: 15 },// Quick check-in
    { id: "evening_peak", label: "19:00", hour: 19 },  // Very active time
    { id: "night_wind_down", label: "22:00", hour: 22 },// Sending "gn"
    { id: "late_night", label: "01:00", hour: 1 }      // Occasional late night "gn"
];

const LOCK_FILE = 'last_sent.txt';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const displayStatus = (lastSentId) => {
    console.clear();
    const now = new Date();
    const lastSentIndex = SCHEDULE_CONFIG.findIndex(s => s.id === lastSentId);

    SCHEDULE_CONFIG.forEach((task, index) => {
        let status = (index <= lastSentIndex && lastSentId !== "") ? `[COMPLETED]`.green : `[PENDING]`.yellow;
        console.log(`${status} ${task.label}`);
    });
    console.log(`\n[SYSTEM] Last Check: ${now.toLocaleTimeString()}`.grey);
};

const getChatData = (path) => {
    if (!fs.existsSync(path)) return [];
    return fs.readFileSync(path, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '' && line.includes('#'))
        .map(line => {
            const [idPart, commentPart] = line.split('#');
            const [server, channel] = commentPart.split(',').map(s => s.trim());
            return { id: idPart.trim(), server, channel };
        });
};

const getFileData = (path) => {
    if (!fs.existsSync(path)) return [];
    return fs.readFileSync(path, 'utf8')
        .split('\n')
        .map(line => line.split('#')[0].trim())
        .filter(line => line !== '');
};

function getAgent(proxies) {
    if (!proxies || proxies.length === 0) return null;
    const proxy = proxies[Math.floor(Math.random() * proxies.length)].trim();
    return proxy.startsWith('socks') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy);
}

async function getSelfId(options) {
    try {
        const res = await axios.get('https://discord.com/api/v9/users/@me', options);
        return res.data.id;
    } catch (err) { 
        return null; 
    }
}

async function sendTyping(channelId, options) {
    try {
        await axios.post(`https://discord.com/api/v9/channels/${channelId}/typing`, {}, options);
    } catch (err) {}
}

async function tryReply(chat, selfId, options, config, isGmGnChannel) {
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${chat.id}/messages?limit=10`, options);
        
        // Only try to reply if it's NOT a gm-gn channel (replies in GM channels look bot-like)
        if (isGmGnChannel) return false;

        const target = res.data.find(m => 
            m.author.id !== selfId && 
            config.reply_target.some(t => m.content.toLowerCase().includes(t.toLowerCase()))
        );

        if (target) {
            const replyText = config.reply[Math.floor(Math.random() * config.reply.length)];

            await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, {
                content: replyText,
                message_reference: { channel_id: chat.id, message_id: target.id }
            }, options);
            
            console.log(`[REPLIED] "${replyText}" on ${chat.server}`.blue);
            return true;
        }
    } catch (err) { 
        return false; 
    }
    return false;
}

async function isLastMessageMe(channelId, selfId, options) {
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages?limit=1`, options);
        return res.data.length > 0 && res.data[0].author.id === selfId;
    } catch (err) {
        return false;
    }
}

async function sendMessage(token, agent, limitOne = false, currentTaskId = "") {
    const options = { headers: { 'Authorization': token.trim() }, timeout: 15000 };
    if (agent) { options.httpsAgent = agent; options.httpAgent = agent; }

    const selfId = await getSelfId(options);
    if (!selfId) return;

    const allChats = getChatData('chat_ids.txt');
    const yamlData = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    const filterKeywords = yamlData.gm_gn.map(kw => kw.toLowerCase());

    const chatsToProcess = limitOne ? [allChats[0]] : allChats;

    for (let i = 0; i < chatsToProcess.length; i++) {
        const chat = chatsToProcess[i];
        const channelLower = chat.channel.toLowerCase();
        
        // Determine if this is a GM/GN channel
        const isGmGnChannel = filterKeywords.some(kw => channelLower.includes(kw));

        try {
            if (await isLastMessageMe(chat.id, selfId, options)) {
                console.log(`[SKIP] Already last sender in ${chat.server}`.cyan);
                continue;
            }

            await sendTyping(chat.id, options);
            await sleep(Math.floor(Math.random() * 3000) + 2000);

            let text;
            if (isGmGnChannel) {
                // If it's a gm/gn channel, pick from the gm_gn list
                text = yamlData.gm_gn[Math.floor(Math.random() * yamlData.gm_gn.length)];
            } else {
                // Otherwise, try to reply or send a general message
                let sentReply = false;
                if (Math.random() < 0.3) {
                    sentReply = await tryReply(chat, selfId, options, yamlData);
                }
                if (sentReply) continue;
                text = yamlData.general[Math.floor(Math.random() * yamlData.general.length)];
            }

            await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, { content: text }, options);
            console.log(`[SENT] "${text}" on ${chat.server} (${chat.channel})`.green);

        } catch (err) {
            if (err.response?.status === 429) {
                const retryAfter = (err.response.data.retry_after || 5) * 1000;
                await sleep(retryAfter);
                i--; 
                continue;
            }
        }

        if (i < chatsToProcess.length - 1) {
            await sleep(Math.floor(Math.random() * 25000) + 20000);
        }
    }
    displayStatus(currentTaskId);
}

function getScheduledTask() {
    const hour = new Date().getHours();
    return SCHEDULE_CONFIG.find(s => hour === s.hour) || null;
}

async function start() {
    const tokens = getFileData('token.txt');
    const proxies = getFileData('proxy.txt');
    
    if (tokens.length === 0) {
        console.log("[ERROR] No tokens found in token.txt".red);
        return;
    }

    if (process.argv.includes('--test')) {
        console.log("[TEST MODE] Sending to the first valid chat ID only...".cyan);
        const token = tokens[0];
        const agent = getAgent(proxies);
        await sendMessage(token, agent, true, "test_run");
        process.exit(0);
    }

    let lastSentWindow = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8').trim() : "";
    displayStatus(lastSentWindow);
    
    setInterval(async () => {
        const task = getScheduledTask();
        if (task && lastSentWindow !== task.id) {
            lastSentWindow = task.id; 
            fs.writeFileSync(LOCK_FILE, lastSentWindow);

            const jitter = Math.floor(Math.random() * 20) + 1;
            console.log(`[JITTER] Waiting ${jitter}m...`.magenta);
            await sleep(jitter * 60 * 1000);

            for (const token of tokens) {
                const agent = getAgent(proxies);
                await sendMessage(token, agent, false, task.id);
            }
        }

        if (new Date().getHours() === 0 && lastSentWindow !== "") {
            lastSentWindow = "";
            fs.writeFileSync(LOCK_FILE, "");
            displayStatus("");
        }
    }, 60000); 
}

start();
