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

// 設定首頁路由
app.get("/", (req, res) => {
    res.send("サポちゃん大地に立つ!!");
});

// 啟動 Web 伺服器
app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
});

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

// 啟動 Discord Bot
client.once("ready", () => {
    console.log(`✅ 已登入為 ${client.user.tag}`);
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
    if (!interaction.isCommand()) return;

    if (interaction.commandName === "help") {
        await slashHelp(interaction);
    }
});

// 監聽 keywords
client.on("messageCreate", async (message) => {
    // 忽略 Bot 自己的訊息
    if (message.author.bot) return;

    const content = message.content;

    // 捕獲中止命令
    if (content.includes("!stopTheDiscordBot")) {
        await message.reply("おやすみなさい。");
        console.log("Bot 停止中...");
        client.destroy(); // 停止 Discord Bot
        process.exit(0); // 終止程式
    }

    // 處理符合關鍵字的命令
    await Promise.all([
        handleCommand(content, message, "!time", theTimestamp),
        handleCommand(content, message, "!dice", rollDice)
    ]);
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

client.login(process.env.DISCORD_TOKEN);
