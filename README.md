# Syncro 🚀
**The Human-Centric Discord Scheduler**

Syncro is a lightweight Node.js automation tool designed to maintain a natural presence on Discord. It monitors specific time windows and sends randomized "Gm", "Gn", or general messages to mimic genuine human activity.

✨ Features
- Typing Simulation: Shows "User is typing..." before sending.
- Anti-Spam: Automatically skips a channel if your message was the last one sent.
- Smart Filtering: Stays on topic—sends only greetings in "gm-gn" channels and general chat elsewhere.
- Contextual Replies: 30% chance to reply to other users instead of starting a new thread.

## 📌 Prerequisites
- Nodejs installed
- A Discord Account Token
- List Channel Id
- Proxies (Optional but recommended)

## ⚙️ Configuration
Before running the bot, you must create the following files in the root directory (these are ignored by git for security):

### 1. token.txt
Place your Discord account token inside this file. Only put one token per line.

```txt
your_discord_token_here
```

### 2. chat_ids.txt
List the channels you want to target. Use the # symbol to define the Server and Channel name for the logs. Format: ChannelID # Server Name, Channel Description

```txt
1234567890 # Other Server 1, gm-gn
0987654321 # Other Server 2, general
```

### 3. proxy.txt (Optional)
Add your proxy in http://user:pass@ip:port or socks5://... format. If you don't use a proxy, leave this file empty or do not create it.
```txt
[http://username:password@123.45.67.89:8080](http://username:password@123.45.67.89:8080)
```

## 🚀 Usage

### Normal Mode (Scheduled)
Runs based on the configured time windows (01:00, 05:00, 12:00, etc.):
```bash
node bot.js
```

### Test Mode
Immediately sends a message only to the first channel in your list to verify your token and proxy:
```bash
node bot.js --test
```

## ⚠️ Disclaimer
This tool is for educational purposes. Use of "self-bots" can violate Discord's Terms of Service. Use at your own risk.
