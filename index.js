const fs = require('fs');
const axios = require('axios');
require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const yaml = require('js-yaml');

const WINDOWS = [
    { name: "Morning", start: 5, end: 9 },
    { name: "Lunch", start: 12, end: 14 },
    { name: "Afternoon", start: 17, end: 19 },
    { name: "Night", start: 22, end: 24 }
];

const STATE_FILE = 'state.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getTodayStr = () => new Date().toISOString().split('T')[0];

let scheduledTimes = [];
const tokenCooldowns = new Map();
const typingCooldown = new Map();

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        return { selfIds: {}, lastRun: { date: '', taskId: '' } };
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isTokenCoolingDown(token) {
    const until = tokenCooldowns.get(token);
    return until && Date.now() < until;
}

function setTokenCooldown(token, ms) {
    tokenCooldowns.set(token, Date.now() + ms);
}

function generateDailySchedule() {
    const times = [];
    WINDOWS.forEach(w => {
        const h = Math.min(
            Math.floor(Math.random() * (w.end - w.start)) + w.start,
            23
        );
        const m = Math.floor(Math.random() * 60);
        times.push({
            id: `${h}:${m}`,
            hour: h,
            minute: m,
            label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${w.name})`
        });
    });
    return times.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

const getFileData = path =>
    fs.existsSync(path)
        ? fs.readFileSync(path, 'utf8')
            .split('\n')
            .map(l => l.split('#')[0].trim())
            .filter(Boolean)
        : [];

const getChatData = path =>
    fs.existsSync(path)
        ? fs.readFileSync(path, 'utf8')
            .split('\n')
            .filter(l => l.includes('#'))
            .map(l => {
                const [id, rest] = l.split('#');
                const [server, channel] = rest.split(',').map(s => s.trim());
                return { id: id.trim(), server, channel };
            })
        : [];

function getAgent(proxies) {
    if (!proxies.length) return null;
    const p = proxies[Math.floor(Math.random() * proxies.length)];
    return p.startsWith('socks')
        ? new SocksProxyAgent(p)
        : new HttpsProxyAgent(p);
}

async function getSelfId(options) {
    const r = await axios.get('https://discord.com/api/v9/users/@me', options);
    return r.data.id;
}

async function sendTyping(channelId, options) {
    const last = typingCooldown.get(channelId) || 0;
    if (Date.now() - last < 10000) return;

    typingCooldown.set(channelId, Date.now());
    try {
        await axios.post(
            `https://discord.com/api/v9/channels/${channelId}/typing`,
            {},
            options
        );
    } catch {}
}

async function isLastMessageMe(channelId, selfId, options) {
    try {
        const r = await axios.get(
            `https://discord.com/api/v9/channels/${channelId}/messages?limit=1`,
            options
        );
        return r.data[0]?.author?.id === selfId;
    } catch {
        return false;
    }
}

function displayStatus() {
    console.clear();
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const today = getTodayStr();
    const state = loadState();

    console.log(`[INFO] Today's Schedule (${today})`.cyan);

    scheduledTimes.forEach(t => {
        const tMin = t.hour * 60 + t.minute;
        const done =
            (state.lastRun.date === today && state.lastRun.taskId === t.id) ||
            currentMin > tMin;

        const status = done ? `[COMPLETED]`.green : `[PENDING]`.yellow;
        console.log(`${status} ${t.label}`);
    });
}

async function sendMessage(token, agent) {
    if (isTokenCoolingDown(token)) {
        console.log(`[COOLDOWN] Token cooling down, skipped`.gray);
        return;
    }

    const options = {
        headers: { Authorization: token.trim() },
        timeout: 15000,
        ...(agent ? { httpsAgent: agent, httpAgent: agent } : {})
    };

    let state = loadState();
    let selfId = state.selfIds[token];

    if (!selfId) {
        try {
            selfId = await getSelfId(options);
            state.selfIds[token] = selfId;
            saveState(state);
        } catch {
            return;
        }
    }

    const chats = getChatData('chat_ids.txt');
    const yamlData = yaml.load(fs.readFileSync('messages.yaml', 'utf8')).messages;
    const hour = new Date().getHours();

    for (let i = 0; i < chats.length; i++) {
        const chat = chats[i];

        try {
            const isMe = await isLastMessageMe(chat.id, selfId, options);
            if (isMe) {
                console.log(`[SKIP] Already last sender in ${chat.server}`.yellow);
                await sleep(3000 + Math.random() * 2000);
                continue;
            }

            await sendTyping(chat.id, options);
            await sleep(3000 + Math.random() * 4000);

            let text;
            const label = chat.channel.toLowerCase();

            if (label === 'gm-gn') {
                let pool = yamlData.gmgn;
                if (hour < 12) pool = pool.filter(m => m.toLowerCase().includes('gm'));
                else if (hour >= 21) pool = pool.filter(m => m.toLowerCase().includes('gn'));
                text = pool[Math.floor(Math.random() * pool.length)];
            } else if (yamlData[label]) {
                text = yamlData[label][Math.floor(Math.random() * yamlData[label].length)];
            } else {
                text = yamlData.general[Math.floor(Math.random() * yamlData.general.length)];
            }

            await axios.post(
                `https://discord.com/api/v9/channels/${chat.id}/messages`,
                { content: text },
                options
            );

            console.log(`[SENT] ${chat.server}`.green);

        } catch (err) {
            if (err.response?.status === 429) {
                const wait = (err.response.data.retry_after || 60) * 1000;
                console.log(`[RATE LIMIT] Token cooldown ${Math.ceil(wait / 60000)}m`.yellow);
                setTokenCooldown(token, wait + 5 * 60 * 1000);
                break;
            }
        }

        await sleep(35000 + Math.random() * 20000);
    }
}

async function start() {
    const tokens = getFileData('token.txt');
    const proxies = getFileData('proxy.txt');

    scheduledTimes = generateDailySchedule();
    displayStatus();

    setInterval(async () => {
        const now = new Date();
        const today = getTodayStr();
        let state = loadState();

        if (now.getHours() === 0 && now.getMinutes() === 0) {
            scheduledTimes = generateDailySchedule();
            state.lastRun = { date: '', taskId: '' };
            saveState(state);
            displayStatus();
        }

        const task = scheduledTimes.find(
            t => t.hour === now.getHours() && t.minute === now.getMinutes()
        );

        if (!task) return;

        if (state.lastRun.date === today && state.lastRun.taskId === task.id) return;

        state.lastRun = { date: today, taskId: task.id };
        saveState(state);
        displayStatus();

        for (const token of tokens) {
            await sendMessage(token, getAgent(proxies));
        }
    }, 60000);
}

start();
