const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const yaml = require('js-yaml');

const SCHEDULE_CONFIG = [
    { id: "night_early", label: "01:00", hour: 1 },
    { id: "morning", label: "05:00", hour: 5 },
    { id: "afternoon", label: "12:00", hour: 12 },
    { id: "evening", label: "16:00", hour: 16 },
    { id: "night", label: "22:00", hour: 22 }
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
    } catch (err) { return null; }
}

async function sendTyping(channelId, options) {
    try {
        await axios.post(`https://discord.com/api/v9/channels/${channelId}/typing`, {}, options);
    } catch (err) {}
}

async function tryReply(chat, selfId, options, config, isGreetingChannel) {
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${chat.id}/messages?limit=10`, options);
        const target = res.data.find(m => 
            m.author.id !== selfId && 
            config.reply_target.some(t => m.content.toLowerCase().includes(t.toLowerCase()))
        );

        if (target) {
            let replyText;
            if (config.reply && config.reply.length > 0) {
                replyText = config.reply[Math.floor(Math.random() * config.reply.length)];
            } else {
                const list = isGreetingChannel ? config.gm_gn : config.general;
                replyText = list[Math.floor(Math.random() * list.length)];
            }

            await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, {
                content: replyText,
                message_reference: { channel_id: chat.id, message_id: target.id }
            }, options);
            
            console.log(`[REPLIED] "${replyText}" -> ${target.content.substring(0, 20)} on ${chat.server} (${chat.channel})`.blue);
            return true;
        }
    } catch (err) { return false; }
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
    const options = { headers: { 'Authorization': token.trim() } };
    if (agent) { options.httpsAgent = agent; options.httpAgent = agent; }

    const selfId = await getSelfId(options);
    const allChats = getChatData('chat_ids.txt');
    const config = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    const targetChats = limitOne ? [allChats[0]] : allChats;

    for (let i = 0; i < targetChats.length; i++) {
        const chat = targetChats[i];
        const channelLower = chat.channel.toLowerCase();
        const isGreetingChannel = channelLower.includes('gm') || channelLower.includes('gn');

        const lastIsMe = await isLastMessageMe(chat.id, selfId, options);
        if (lastIsMe) {
            console.log(`[SKIP] Already last sender in ${chat.server} (${chat.channel})`.cyan);
            continue;
        }

        await sendTyping(chat.id, options);
        await sleep(Math.floor(Math.random() * 3000) + 2000);

        let sent = false;

        if (!isGreetingChannel && Math.random() < 0.3) {
            const replyResult = await tryReply(chat, selfId, options, config, isGreetingChannel);
            if (replyResult) sent = true;
        }

        if (!sent) {
            const list = isGreetingChannel ? config.gm_gn : config.general;
            const text = list[Math.floor(Math.random() * list.length)];

            try {
                await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, { content: text }, options);
                console.log(`[SENT] "${text}" on ${chat.server} (${chat.channel})`.green);
            } catch (err) {
                console.error(`[ERR] ${chat.server}: ${err.response?.status}`.red);
            }
        }

        if (i < targetChats.length - 1) {
            const delay = Math.floor(Math.random() * (45000 - 20000 + 1)) + 20000;
            await sleep(delay);
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
        console.log("[TEST MODE] Sending to the first chat ID only...".cyan);
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

            const jitter = Math.floor(Math.random() * 10) + 1;
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
