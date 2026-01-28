const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const yaml = require('js-yaml');

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

async function sendMessage(token, agent, limitOne = false) {
    const options = { headers: { 'Authorization': token.trim() } };
    if (agent) {
        options.httpsAgent = agent;
        options.httpAgent = agent;
    }

    const allChats = getChatData('chat_ids.txt');
    if (allChats.length === 0) return console.log("[ERROR] No channels found in chat_ids.txt".red);

    if (!fs.existsSync('messages.yaml')) return console.log("[ERROR] messages.yaml is missing!".red);
    const messagesData = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    
    const targetChats = limitOne ? [allChats[0]] : allChats;

    const gmList = messagesData.filter(m => m.toLowerCase().includes('gm'));
    const gnList = messagesData.filter(m => m.toLowerCase().includes('gn'));
    const getRandom = (list) => list[Math.floor(Math.random() * list.length)];

    for (let i = 0; i < targetChats.length; i++) {
        const chat = targetChats[i];

        if (i > 0) {
            const delay = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
            console.log(`[INFO] Waiting ${delay / 1000}s before next message...`.grey);
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
            console.log(`[SUCCESS] Sent "${text}" to "${chat.server}" channel "${chat.channel}"`.green);
        } catch (err) {
            console.error(`[ERROR] ${chat.server} (${chat.channel}): ${err.response?.status || err.message}`.red);
        }
    }
}

function getScheduledTask() {
    const now = new Date();
    const hour = now.getHours();

    if (hour >= 1 && hour < 2) return { id: "night_early" };
    if (hour >= 5 && hour < 6) return { id: "morning" };
    if (hour >= 12 && hour < 13) return { id: "afternoon" };
    if (hour >= 16 && hour < 17) return { id: "evening" };
    if (hour >= 21 && hour < 22) return { id: "night" };

    return null;
}

async function start() {
    const tokens = getFileData('token.txt');
    const proxies = getFileData('proxy.txt');
    
    if (tokens.length === 0) {
        console.log("[CRITICAL] Cannot start: token.txt is missing or empty.".red);
        return;
    }

    const token = tokens[0];
    const agent = getAgent(proxies);
    let lastSentWindow = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8').trim() : "";

    if (process.argv.includes('--test')) {
        console.log("[INFO] TEST mode: Sending to first channel...".magenta);
        await sendMessage(token, agent, true);
        process.exit(0);
    }

    console.log("[INFO] Scheduler active. Waiting for windows...".cyan);
    if (proxies.length === 0) console.log("[INFO] Running without a proxy.".grey);
    
    setInterval(async () => {
        const task = getScheduledTask();
        
        if (task && lastSentWindow !== task.id) {
            const now = new Date();
            const remaining = 59 - now.getMinutes();
            const delay = remaining > 1 ? Math.floor(Math.random() * (remaining - 1)) + 1 : 0;
            
            console.log(`[INFO] Window ${task.id} hit! Scheduled delay: ${delay}m`.yellow);
            
            lastSentWindow = task.id; 
            fs.writeFileSync(LOCK_FILE, lastSentWindow);

            if (delay > 0) await sleep(delay * 60 * 1000);
            await sendMessage(token, agent);
        }

        if (!task && lastSentWindow !== "") {
            lastSentWindow = "";
            fs.writeFileSync(LOCK_FILE, "");
        }
    }, 60000); 
}

start();
