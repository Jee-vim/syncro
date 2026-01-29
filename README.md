# Syncro 🚀
**The Human-Centric Discord Scheduler**

Syncro is a lightweight Node.js automation tool designed to maintain a natural presence on Discord. It monitors specific time windows and sends randomized "Gm", "Gn", or general messages to mimic genuine human activity.

## 📌 Prerequisites

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

### 3. proxy.txt (Optional)
Add your proxy in http://user:pass@ip:port or socks5://... format. If you don't use a proxy, leave this file empty or do not create it.
```txt
[http://username:password@123.45.67.89:8080](http://username:password@123.45.67.89:8080)
```

```txt
1234567890 # MyServer, gm-gn
0987654321 # OtherServer, general-chat
```

## ⚠️ Disclaimer
This tool is for educational purposes. Use of "self-bots" can violate Discord's Terms of Service. Use at your own risk.
