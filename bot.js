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
    } catch (err) {
        return null;
    }
}

async function isLastMessageMe(channelId, selfId, options) {
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages?limit=1`, options);
        return res.data.length > 0 && res.data[0].author.id === selfId;
    } catch (err) {
        return false;
    }
}

async function sendTyping(channelId, options) {
    try {
        await axios.post(`https://discord.com/api/v9/channels/${channelId}/typing`, {}, options);
    } catch (err) {}
}

async function sendMessage(token, agent, limitOne = false, currentTaskId = "") {
    const options = { headers: { 'Authorization': token.trim() } };
    if (agent) { options.httpsAgent = agent; options.httpAgent = agent; }

    const selfId = await getSelfId(options);
    const allChats = getChatData('chat_ids.txt');
    const messagesData = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    const targetChats = limitOne ? [allChats[0]] : allChats;

    for (let i = 0; i < targetChats.length; i++) {
        const chat = targetChats[i];

        if (await isLastMessageMe(chat.id, selfId, options)) {
            console.log(`[SKIP] Already last sender in ${chat.server}`.cyan);
            continue;
        }

        await sendTyping(chat.id, options);
        await sleep(Math.floor(Math.random() * 3000) + 2000);

        const text = messagesData[Math.floor(Math.random() * messagesData.length)];

        try {
            await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, { content: text }, options);
            console.log(`[SENT] ${chat.server}`.green);
        } catch (err) {
            console.error(`[ERR] ${chat.server}: ${err.response?.status}`.red);
        }

        if (i < targetChats.length - 1) {
            const delay = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
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
    if (tokens.length === 0) return;

    let lastSentWindow = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8').trim() : "";
    displayStatus(lastSentWindow);
    
    setInterval(async () => {
        const task = getScheduledTask();
        
        if (task && lastSentWindow !== task.id) {
            lastSentWindow = task.id; 
            fs.writeFileSync(LOCK_FILE, lastSentWindow);

            const jitter = Math.floor(Math.random() * (15 - 1 + 1)) + 1;
            console.log(`[JITTER] Waiting ${jitter} minutes before starting...`.magenta);
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
