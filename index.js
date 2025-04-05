import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { theTimestamp } from "./timestamp.js"; // 從 timestamp.js 拉入 theTimestamp 函式
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

        // 轉換為時間戳格式 <t:xxxxx:F>
        const timestamp = Math.floor(now.valueOf() / 1000); // 取得 Unix 時間戳

        // 回應訊息
        const reply = [
            `**!time** - 顯示當前時間`,
            `**!time__+2h__ / !time__-30m__ / !time__+1.5h__** - 計算時間，未輸入單位預設為h`,
            `**!time+3h__F__ / !time-1d__R__** - F 顯示完整時間，R 顯示倒數時間`,
            `**!time${formattedTime}T** - 轉換台灣時區時間（T=台灣, J=日本, S=瑞典）`,
        ].join("\n");
        await interaction.reply(reply);
    }
});

// 監聽 keywords
client.on("messageCreate", async (message) => {
    if (message.author.bot) return; // 忽略 Bot 自己的訊息

    const content = message.content;

    //!time...
    if (content.includes("!time")) {
        const result = theTimestamp(content); // 將訊息傳入 theTimestamp 函式處理
        if (result) {
            await message.reply(result); // 回應處理結果
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
