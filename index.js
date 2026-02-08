const fs = require('fs');
const axios = require('axios');
require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const yaml = require('js-yaml');

const WINDOWS = [
    { name: "Morning", start: 6, end: 10 },
    { name: "Lunch", start: 12, end: 14 },
    { name: "Afternoon", start: 17, end: 19 },
    { name: "Night", start: 22, end: 24 }
];

const LOCK_FILE = 'last_sent.txt';
const SELF_ID_CACHE = 'self_ids.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getTodayStr = () => new Date().toISOString().split('T')[0];

let scheduledTimes = [];

// Used to back off entire tokens after a 429
const tokenCooldowns = new Map();

// Prevents spamming typing events on the same channel
const typingCooldown = new Map();

function isTokenCoolingDown(token) {
    const until = tokenCooldowns.get(token);
    return until && Date.now() < until;
}

function setTokenCooldown(token, ms) {
    tokenCooldowns.set(token, Date.now() + ms);
}

// Cache self IDs so we don’t hit /users/@me every run
function loadSelfIds() {
    if (!fs.existsSync(SELF_ID_CACHE)) return {};
    return JSON.parse(fs.readFileSync(SELF_ID_CACHE, 'utf8'));
}

function saveSelfIds(data) {
    fs.writeFileSync(SELF_ID_CACHE, JSON.stringify(data, null, 2));
}

// One random send time per window, regenerated daily
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

// Rate-limited manually to avoid pointless penalties
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

    const lock = fs.existsSync(LOCK_FILE)
        ? fs.readFileSync(LOCK_FILE, 'utf8').trim()
        : '';
    const [lockDate, lockId] = lock.split('|');

    console.log(`[INFO] Today's Schedule (${today})`.cyan);

    scheduledTimes.forEach(t => {
        const tMin = t.hour * 60 + t.minute;
        const done =
            (lockDate === today && lockId === t.id) ||
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

    const selfIds = loadSelfIds();
    let selfId = selfIds[token];

    if (!selfId) {
        try {
            selfId = await getSelfId(options);
            selfIds[token] = selfId;
            saveSelfIds(selfIds);
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
            // Only read message history sometimes to save API calls
            const wantsReply = Math.random() < 0.3;
            if (wantsReply && await isLastMessageMe(chat.id, selfId, options)) {
                continue;
            }

            await sendTyping(chat.id, options);
            await sleep(2000 + Math.random() * 3000);

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

        // Slow down as we move through channels
        await sleep(20000 + Math.random() * 15000 + i * 2000);
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

        if (now.getHours() === 0 && now.getMinutes() === 0) {
            scheduledTimes = generateDailySchedule();
            fs.writeFileSync(LOCK_FILE, '');
        }

        const task = scheduledTimes.find(
            t => t.hour === now.getHours() && t.minute === now.getMinutes()
        );

        if (!task) return;

        const lock = fs.existsSync(LOCK_FILE)
            ? fs.readFileSync(LOCK_FILE, 'utf8').trim()
            : '';

        if (lock === `${today}|${task.id}`) return;

        fs.writeFileSync(LOCK_FILE, `${today}|${task.id}`);

        for (const token of tokens) {
            await sendMessage(token, getAgent(proxies));
        }
    }, 60000);
}

start();
