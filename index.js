import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { slashHelp, rollDice } from "./misc.js";
import { theTimestamp } from "./timestamp.js";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

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
process.env.IS_STOPPING_BOT = 'false';

// 啟動 Web 伺服器
app.listen(port, () => {
    console.log(`[INFO]Web Server正在埠 ${port} 運行`);
});

// 錯誤事件處理
app.on('error', (error) => {
    console.error('[ERROR] Express 伺服器錯誤:', error);
});
client.on('error', (error) => {
    console.error('[ERROR] Discord Client 發生錯誤:', error);
});

// 設定首頁路由
app.get("/", (req, res) => {
    res.send("サポちゃん大地に立つ!!");
});

// 初始化 REST 客戶端
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// 註冊 Slash Command
(async () => {
    try {
        console.log("[INFO]刪除舊Slash Commands...");

        // 拉取目前伺服器中的所有命令
        const existingCommands = await rest.get(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID,
            ),
        );

        // 刪除所有舊的命令
        for (const command of existingCommands) {
            await rest.delete(
                Routes.applicationGuildCommand(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID,
                    command.id,
                ),
            );
            console.log("[INFO]刪除命令：" + command.name);
        }

        console.log("[INFO]重新註冊Slash Commands...");

        // 註冊新的命令
        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID,
            ),
            {
                body: theCommands, // 命令列表，更新 description 內容
            },
        );

        console.log("[INFO]Slash Commands 註冊成功!");
    } catch (error) {
        console.error(error);
    }
})();

// 啟動 Discord Bot
client.once("ready", () => {
    console.log(`[INFO]✅ 已登入為 ${client.user.tag}`);
});

// 監聽 SIGTERM 訊號（Render 停止服務時會發送此信號）
process.on('SIGTERM', async () => {
    // !stopTheDiscordBot 則跳過重啟
    if (process.env.IS_STOPPING_BOT) return;

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
];

// 監聽 Slash Command
client.on("interactionCreate", async (interaction) => {
    // !stopTheDiscordBot 後進入假眠
    if (process.env.IS_STOPPING_BOT) return;

    if (!interaction.isCommand()) return;

    if (interaction.commandName === "help") {
        await slashHelp(interaction);
    }
});

// 監聽 keywords
client.on("messageCreate", async (message) => {
    // !stopTheDiscordBot 後進入假眠
    if (process.env.IS_STOPPING_BOT) return;

    // 忽略 Bot 自己的訊息
    if (message.author.bot) return;

    const content = message.content;

    // 捕獲中止命令 !stopTheDiscordBot
    if (content.includes("!stopTheDiscordBot") && message.member.roles.cache.has(process.env.ADMIN_ROLE_ID)) {
        process.env.IS_STOPPING_BOT = 'true'; // 設置環境變數標誌
        await message.reply("おやすみなさい。");
        console.log("[INFO]theDiscordBot 停止中...");
        client.destroy(); // 停止 Discord Bot
        app.close(() => {
            console.log("[INFO]Web Server 已關閉");
        });
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
            console.log(`[${keyword}]${result}`);
        }
    }
}

client.login(process.env.DISCORD_TOKEN);
