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

const displayStatus = (lastSentId) => {
    console.clear();
    const now = new Date();
    const currentHour = now.getHours();

    const lastSentIndex = SCHEDULE_CONFIG.findIndex(s => s.id === lastSentId);

    SCHEDULE_CONFIG.forEach((task, index) => {
        let status;
        if (index <= lastSentIndex && lastSentId !== "") {
            status = `[COMPLETED]`.green;
        } else {
            status = `[PENDING]`.yellow;
        }
        console.log(`${status} ${task.label}`);
    });
    console.log(`\n[SYSTEM] Last Check: ${now.toLocaleTimeString()}`.grey);
};

const getChatData = (path) => {
    if (!fs.existsSync(path)) {
        console.log(`[WARNING] ${path} is missing.`.yellow);
        return [];
    }
    return fs.readFileSync(path, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '' && line.includes('#'))
        .map(line => {
            const [idPart, commentPart] = line.split('#');
            const [server, channel] = commentPart.split(',').map(s => s.trim());
            return {
                id: idPart.trim(),
                server: server || "Unknown Server",
                channel: channel || "Unknown Channel"
            };
        });
};

const getFileData = (path) => {
    if (!fs.existsSync(path)) {
        console.log(`[WARNING] ${path} is missing.`.yellow);
        return [];
    }
    return fs.readFileSync(path, 'utf8')
        .split('\n')
        .map(line => line.split('#')[0].trim())
        .filter(line => line !== '');
};

const LOCK_FILE = 'last_sent.txt';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getAgent(proxies) {
    if (!proxies || proxies.length === 0) return null;
    const proxy = proxies[0].trim();
    return proxy.startsWith('socks') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy);
}

async function sendMessage(token, agent, limitOne = false, currentTaskId = "") {
    const options = { headers: { 'Authorization': token.trim() } };
    if (agent) {
        options.httpsAgent = agent;
        options.httpAgent = agent;
    }

    const allChats = getChatData('chat_ids.txt');
    if (allChats.length === 0) return;

    if (!fs.existsSync('messages.yaml')) return;
    const messagesData = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    
    const targetChats = limitOne ? [allChats[0]] : allChats;
    const gmList = messagesData.filter(m => m.toLowerCase().includes('gm'));
    const gnList = messagesData.filter(m => m.toLowerCase().includes('gn'));
    const getRandom = (list) => list[Math.floor(Math.random() * list.length)];

    for (let i = 0; i < targetChats.length; i++) {
        const chat = targetChats[i];
        if (i > 0) {
            const delay = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
            await sleep(delay);
        }

        let text;
        const channelLower = chat.channel.toLowerCase();
        if (channelLower.includes('gm')) {
            text = getRandom(gmList.length > 0 ? gmList : messagesData);
        } else if (channelLower.includes('gn')) {
            text = getRandom(gnList.length > 0 ? gnList : messagesData);
        } else {
            text = getRandom(messagesData);
        }

        try {
            await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, { content: text }, options);
        } catch (err) {
            console.error(`[ERROR] ${chat.server} (${chat.channel}): ${err.response?.status || err.message}`.red);
        }
    }
    displayStatus(currentTaskId);
}

function getScheduledTask() {
    const now = new Date();
    const hour = now.getHours();
    return SCHEDULE_CONFIG.find(s => hour === s.hour) || null;
}

async function start() {
    const tokens = getFileData('token.txt');
    const proxies = getFileData('proxy.txt');
    
    if (tokens.length === 0) return;

    const token = tokens[0];
    const agent = getAgent(proxies);
    let lastSentWindow = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8').trim() : "";

    if (process.argv.includes('--test')) {
        await sendMessage(token, agent, true, "test");
        process.exit(0);
    }

    displayStatus(lastSentWindow);
    
    setInterval(async () => {
        const task = getScheduledTask();
        
        if (task && lastSentWindow !== task.id) {
            const now = new Date();
            const remaining = 59 - now.getMinutes();
            const delay = remaining > 1 ? Math.floor(Math.random() * (remaining - 1)) + 1 : 0;
            
            lastSentWindow = task.id; 
            fs.writeFileSync(LOCK_FILE, lastSentWindow);

            if (delay > 0) await sleep(delay * 60 * 1000);
            await sendMessage(token, agent, false, task.id);
        }

        if (!task && lastSentWindow !== "") {
            // Reset logic for next day or next window
            const hour = new Date().getHours();
            if (hour === 0) {
                lastSentWindow = "";
                fs.writeFileSync(LOCK_FILE, "");
                displayStatus("");
            }
        }
    }, 60000); 
}

start();
