import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { theTimestamp } from "./timestamp.js";
import { rollDice } from "./misc.js";
import moment from "moment-timezone";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 定義命令列表
const theCommands = [
    {
        name: "help",
        description: "サポちゃん的支援說明！！",
    },
];

// 初始化 REST 客戶端
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// 註冊 Slash Command
(async () => {
    try {
        console.log("刪除舊Slash Commands...");

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
            console.log("刪除命令：" + command.name);
        }

        console.log("重新註冊Slash Commands...");

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

        console.log("Slash Commands 註冊成功!");
    } catch (error) {
        console.error(error);
    }
})();

// 啟動 Express Web 伺服器
const app = express();
const port = process.env.PORT || 3000; // Replit 通常會使用 PORT

// 設定首頁路由
app.get("/", (req, res) => {
    res.send("サポちゃん大地に立つ!!");
});

// 啟動 Web 伺服器
app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
});

// 啟動 Discord Bot
client.once("ready", () => {
    console.log(`✅ 已登入為 ${client.user.tag}`);
});

// 監聽 Slash Command '/help'
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === "help") {
        // 取得當前時間並格式化為 YYYYMMDDHHMM 格式
        const now = moment();
        const formattedTime = now.format("YYYYMMDDHHmm");

        // 回應訊息
        const reply = `
**___!time___**
> **!time** - 顯示當前時間
> **!time__+2h__ / !time__-30m__ / !time__+1.5h__** - 計算時間，未輸入單位預設為h
> **!time+3h__F__ / !time-1d__R__** - F 顯示完整時間，R 顯示倒數時間
> **!time__T__** - 顯示指定時區時間（T=台灣, J=日本, S=瑞典
> **!time__${formattedTime}__T** - 轉換指定時區時間
> **!time...__!__** - 顯示時間戳
**___!dice___**
> **!dice__3d6__ / !dice__1d100__** - 擲骰
`;

        await interaction.reply(reply);
    }
});

// 通用回覆處理函式
async function handleCommand(content, message, keyword, commandHandler) {
    // 排除處理反引號包裹的指令
    const regex = new RegExp(`\\\`[^\\\`]*${keyword}[^\\\`]*\\\``);
    if (regex.test(content)) return;

    if (content.includes(keyword)) {
        const result = commandHandler(content);
        if (result) await message.reply(result);
    }
}

// 監聽 keywords
client.on("messageCreate", async (message) => {
    // 忽略 Bot 自己的訊息
    if (message.author.bot) return;

    const content = message.content;

    // 處理符合關鍵字的命令
    await Promise.all([
        handleCommand(content, message, "!time", theTimestamp),
        handleCommand(content, message, "!dice", rollDice)
    ]);
});

client.login(process.env.DISCORD_TOKEN);
