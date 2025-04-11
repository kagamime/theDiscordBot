import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { slashHelp, rollDice } from "./misc.js";
import { theTimestamp } from "./timestamp.js";
import { slashAsk } from "./askHandler.js";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

console.log("___________________________________");

// 建立 Discord client 實例
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 啟動 Express Web 伺服器
const app = express();
const port = process.env.PORT || 3000;

// 啟動 Web 伺服器
const server = app.listen(port, () => {
    console.log(`[INFO]Web Server 正在埠 ${port} 運行`);
});

// 錯誤事件處理
app.on('error', (error) => {
    console.error('[ERROR]Express 伺服器錯誤：', error);
});
client.on('error', (error) => {
    console.error('[ERROR]Discord Client 發生錯誤：', error);
});

// !stopTheDiscordBot 則返回空響應
app.use((req, res, next) => {
    if (isStoppingBot) {
        console.log("[INFO]已停止服務，拒絕請求");
        return res.status(204).end(); // 直接返回空響應，不處理請求
    }
    console.log(`[INFO]收到請求：${req.method} ${req.originalUrl}`);
    next();
});

// 設定首頁 Router
app.get("/", (req, res) => {
    res.send("サポちゃん大地に立つ!!");
});

// 初始化 REST 客戶端
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// 註冊 Slash Command
(async () => {
    try {
        console.log("[INFO]檢查現有 Slash Commands...");

        // 拉取目前伺服器中的所有命令
        const existingCommands = await rest.get(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID,
            ),
        );

        // 比對現有命令與新命令，若有差異才進行刪除與註冊
        const commandsToDelete = [];
        const commandsToRegister = [];

        for (const command of theCommands) {
            // 檢查命令是否已存在
            const existingCommand = existingCommands.find(
                (existing) => existing.name === command.name
            );

            if (!existingCommand) {
                // 若命令不存在，準備註冊
                commandsToRegister.push(command);
            } else {
                // 若命令存在，檢查是否有變動，若有變動則標記刪除並註冊
                const isCommandUpdated = existingCommand.description !== command.description;
                if (isCommandUpdated) {
                    commandsToDelete.push(existingCommand.id);
                    commandsToRegister.push(command);
                }
            }
        }

        // 刪除舊命令
        for (const commandId of commandsToDelete) {
            await rest.delete(
                Routes.applicationGuildCommand(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID,
                    commandId,
                ),
            );
            console.log("[INFO]刪除舊命令：" + commandId);
        }

        // 註冊新的命令
        if (commandsToRegister.length > 0) {
            console.log("[INFO]註冊新命令...");
            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID,
                ),
                {
                    body: commandsToRegister,
                },
            );
            console.log("[INFO]Slash Commands 重新註冊成功");
        } else {
            console.log("[INFO]Slash Commands 已註冊");
        }
    } catch (error) {
        console.error(error);
    }
})();

// 啟動 Discord Bot
client.once("ready", () => {
    console.log(`[INFO]✅ 已登入為 ${client.user.tag}`);
});

// 重寫 console.log，使其同時發送到 Discord
const originalLog = console.log;
console.log = async (...args) => {
    const now = new Date().toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Taipei',
    });

    const prefix = `\`[${now.replace(':', '')}]\``;
    const message = [prefix, ...args].join('');

    try {
        const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
        await channel.send(message);
    } catch (err) {
        originalLog('[LOG ERROR]', err);
    }
    
    // 保留原本的 console.log 行為
    originalLog(...args);
};

// 監聽 SIGTERM 訊號（Render 停止服務時會發送此信號）
let isStoppingBot = false;
process.on('SIGTERM', async () => {
    // !stopTheDiscordBot 則跳過重啟
    if (isStoppingBot) return;

    console.log('[INFO]已收到 SIGTERM 訊號，正在開始重啟程序...');

    try {
        const response = await fetch(process.env.DEPLOY_HOOK_URL, {
            method: 'POST',  // HTTP 方法
            headers: { 'Content-Type': 'application/json' },  // 如果需要的話，可以添加 header
            body: JSON.stringify({ message: "Deploy triggered by SIGTERM" })  // 如果需要的話，可以傳送資料
        });

        if (response.ok) {
            console.log('[INFO]成功觸發部署');
        } else {
            console.error('[ERROR]觸發部署時出錯');
        }
    } catch (err) {
        console.error('[ERROR]無法觸發部署', err);
    }

    return;
});

// 定義 Slash 命令列表
const theCommands = [
    {
        name: "help",
        description: "サポちゃん的支援說明！！",
    },
    {
        name: "ask",
        description: "提問！！ サポちゃん會想辦法回答！！",
        type: 1,  // 類型為 1，代表是常規命令
        options: [
            {
                name: "提問",
                description: "要提問的內容",
                type: 3,  // 文字類型
                required: true,
            },
        ],
    },
];

// 監聽 Slash Command
client.on("interactionCreate", async (interaction) => {
    // !stopTheDiscordBot 後進入假眠
    if (isStoppingBot) return;

    if (!interaction.isCommand()) return;

    // /help
    if (interaction.commandName === "help") {
        console.log(`[REPLY]${interaction.user.tag}> 觸發了 /help`);
        await slashHelp(interaction);
    }

    // /ask
    if (interaction.commandName === "ask") {
        // 限定使用頻道
        const allowedChannels = [process.env.ASK_CHANNEL_ID, process.env.NOTEPAD_CHANNEL_ID];
        if (!allowedChannels.includes(interaction.channelId)) {
            return interaction.reply({
                content: `抱歉，提問請在 <#${process.env.ASK_CHANNEL_ID}> 進行。`,
                flags: 64,
            });
        }

        // 確保 query 參數不為空
        const query = interaction.options.getString("提問");
        if (!query) {
            return interaction.reply({
                content: "サポちゃん不會讀心！！ 請提問！！",
                flags: 64,  // 僅顯示給該用戶
            });
        }

        console.log(`[REPLY]${interaction.user.tag}> /ask ${query}`);
        await slashAsk(interaction, query);
    }
});

// 監聽 Keywords
client.on("messageCreate", async (message) => {
    // !stopTheDiscordBot 後進入假眠
    if (isStoppingBot) return;

    // 忽略 Bot 自己的訊息
    if (message.author.bot) return;

    const content = message.content;

    // 捕獲中止命令 !stopTheDiscordBot
    if (content.includes("!stopTheDiscordBot") && message.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
        isStoppingBot = 'true';
        console.log("[INFO]執行 !stopTheDiscordBot");
        await message.reply("おやすみなさい。");
        console.log("[INFO]theDiscordBot 停止中...");
        client.destroy(() => {
            console.log("[INFO]Discord 已離線");
        }); // 停止 Discord Bot

        //// server.close 不能用，之後再考慮如何關閉 Router

        return; // 不用 process.exit(0) 會被render重啟
    }

    // 處理符合關鍵字的命令
    await Promise.all([
        handleCommand(content, message, "!time", theTimestamp),
        handleCommand(content, message, "!dice", rollDice)
    ]);
});

// 通用 keywords 回覆處理函式
async function handleCommand(content, message, keyword, commandHandler) {
    // 排除處理反引號包裹的指令
    const regex = new RegExp(`\\\`[^\\\`]*${keyword}[^\\\`]*\\\``);
    if (regex.test(content)) return;

    if (content.includes(keyword)) {
        const result = commandHandler(content);
        if (result) {
            await message.reply(result);
            console.log(`[REPLY]${message.author.tag}> ${result}`);
        }
    }
}

client.login(process.env.DISCORD_TOKEN);
