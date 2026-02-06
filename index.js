const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const yaml = require('js-yaml');

const WINDOWS = [
    { name: "Morning", start: 6, end: 10 },
    { name: "Lunch", start: 12, end: 14 },
    { name: "Afternoon", start: 16, end: 17 },
    { name: "Evening", start: 19, end: 21 },
    { name: "Night", start: 22, end: 24 }
];

let scheduledTimes = [];
const LOCK_FILE = 'last_sent.txt';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateDailySchedule() {
    const times = [];
    
    WINDOWS.forEach(w => {
        const randomHour = Math.min(Math.floor(Math.random() * (w.end - w.start)) + w.start, 23);
        const randomMin = Math.floor(Math.random() * 60);
        
        times.push({ 
            id: `${randomHour}:${randomMin}`, 
            hour: randomHour, 
            minute: randomMin, 
            label: `${String(randomHour).padStart(2, '0')}:${String(randomMin).padStart(2, '0')} (${w.name})` 
        });
    });
    return times.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

const displayStatus = (lastSentId) => {
    console.clear();
    console.log(`[INFO] Today's Schedule`.cyan);
    
    scheduledTimes.forEach(task => {
        const isDone = task.completed || task.id === lastSentId;
        let status = isDone ? `[COMPLETED]`.green : `[PENDING]`.yellow;
        console.log(`${status} ${task.label}`);
    });
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

async function tryReply(chat, selfId, options, config) {
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${chat.id}/messages?limit=10`, options);
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
    } catch (err) { return false; }
    return false;
}

async function isLastMessageMe(channelId, selfId, options) {
    try {
        const res = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages?limit=1`, options);
        return res.data.length > 0 && res.data[0].author.id === selfId;
    } catch (err) { return false; }
}

async function sendMessage(token, agent, limitOne = false, currentTaskId = "") {
    const options = { headers: { 'Authorization': token.trim() }, timeout: 15000 };
    if (agent) { options.httpsAgent = agent; options.httpAgent = agent; }

    const selfId = await getSelfId(options);
    if (!selfId) return;

    const allChats = getChatData('chat_ids.txt');
    const yamlData = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    const currentHour = new Date().getHours();

    for (let i = 0; i < allChats.length; i++) {
        const chat = allChats[i];
        const channelLabel = chat.channel.toLowerCase();

        try {
            if (await isLastMessageMe(chat.id, selfId, options)) {
                console.log(`[SKIP] Already last sender in ${chat.server}`.cyan);
                continue;
            }

            await sendTyping(chat.id, options);
            await sleep(Math.floor(Math.random() * 3000) + 2000);

            let text;
            const specialKeys = ['gmega', 'ginfra', 'gfast'];
            
            if (channelLabel === 'gm-gn') {
                let pool = yamlData.gmgn;
                if (currentHour < 12) {
                    pool = pool.filter(m => m.toLowerCase().includes('gm'));
                } else if (currentHour >= 21) {
                    pool = pool.filter(m => m.toLowerCase().includes('gn'));
                }
                text = pool[Math.floor(Math.random() * pool.length)];
            } else if (specialKeys.includes(channelLabel)) {
                text = yamlData[channelLabel][Math.floor(Math.random() * yamlData[channelLabel].length)];
            } else {
                let sentReply = false;
                if (Math.random() < 0.3) sentReply = await tryReply(chat, selfId, options, yamlData);
                if (sentReply) continue;
                text = yamlData.general[Math.floor(Math.random() * yamlData.general.length)];
            }

            await axios.post(`https://discord.com/api/v9/channels/${chat.id}/messages`, { content: text }, options);
            console.log(`[SENT] "${text}" on ${chat.server}`.green);

        } catch (err) {
            if (err.response?.status === 429) {
                const retryAfter = (err.response.data.retry_after || 5) * 1000;
                await sleep(retryAfter);
                i--; continue;
            }
        }
        await sleep(Math.floor(Math.random() * 25000) + 20000);
    }
}

async function start() {
    const tokens = getFileData('token.txt');
    const proxies = getFileData('proxy.txt');
    
    scheduledTimes = generateDailySchedule();
    let lastSentId = fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, 'utf8').trim() : "";
    
    displayStatus(lastSentId);
    
    setInterval(async () => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();

        if (currentHour === 0 && currentMin === 0) {
            scheduledTimes = generateDailySchedule();
            lastSentId = "";
            fs.writeFileSync(LOCK_FILE, "");
        }

        const task = scheduledTimes.find(t => t.hour === currentHour && t.minute === currentMin);
        
        if (task && lastSentId !== task.id) {
            lastSentId = task.id; 
            fs.writeFileSync(LOCK_FILE, lastSentId);
            task.completed = true;

            console.log(`[ACTIVE] Starting scheduled session: ${task.label}`.magenta);

            for (const token of tokens) {
                const agent = getAgent(proxies);
                await sendMessage(token, agent, false, task.id);
            }
            displayStatus(lastSentId);
        }
    }, 60000); 
}

start();
