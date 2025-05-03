import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { slashHelp, rollDice } from "./misc.js";
import { theTimestamp } from "./timestamp.js";
import { slashAsk, MODEL_CHOICES } from "./askHandler.js";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

console.log("___________________________________");

//#region 環境初始化

// 建立 Discord client 實例
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 初始化 Express Web
const app = express();

// 中介處理
app.use((req, res, next) => {
    // !stopTheDiscordBot 則返回空響應，不處理請求
    if (isStoppingBot) {
        console.info("[INFO]已停止服務，拒絕請求");
        return res.status(204).end();
    }

    // 收到 cron-job 定時請求
    if (req.headers['the-cron-job'] === 'true') {
        console.info(`[INFO]收到請求：${req.method} cron-job.org`);
    } else {
        console.info(`[INFO]收到請求：${req.method} ${req.originalUrl}`);
    }
    next();
});

// 設定首頁 Router
app.get("/", (req, res) => {
    res.send("サポちゃん大地に立つ!!");
});

// 啟動 Web 伺服器
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.info(`[INFO]Web Server 正在埠 ${port} 運行`);
});

// 錯誤事件處理
app.on('error', (error) => {
    console.error('[ERROR]Express 伺服器錯誤：', error);
});
client.on('error', (error) => {
    console.error('[ERROR]Discord Client 發生錯誤：', error);
});

// 重寫 console.log，使其同時發送到 Discord
const overrideConsole = (type) => {
    const original = console[type];

    console[type] = async (...args) => {
        const now = new Date().toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Taipei',
        });

        const prefix = `\`[${now.replace(':', '')}]\``;
        let message = [prefix, ...args].join('');

        if (args.join('').includes('cron-job.org')) {
            message = `||${message}||`;
        } else {
            original(...args); // 保留原始行為
        }

        try {
            const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
            await channel.send(message);
        } catch (err) {
            original('[ERROR_SEND]', err);
        }
    };
};

// 初始化 REST 客戶端
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// 啟動 Discord Bot
client.once("ready", async () => {
    try {
        // 進行 console 方法的統一覆寫
        overrideConsole('log');
        overrideConsole('info');
        overrideConsole('warn');
        overrideConsole('error');

        // Slash Command 註冊開關
        if (process.env.REGISTER_COMMANDS === "true") {
            console.info("[INFO]刪除舊命令並註冊新命令...");

            // 拉取目前伺服器中的所有命令
            const existingCommands = await rest.get(
                Routes.applicationGuildCommands(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID,
                ),
            );

            // 刪除所有舊命令
            for (const command of existingCommands) {
                await rest.delete(
                    Routes.applicationGuildCommand(
                        process.env.CLIENT_ID,
                        process.env.GUILD_ID,
                        command.id,
                    ),
                );
                console.info("[INFO]刪除舊命令：" + command.id);
            }

            // 註冊新的命令
            console.info("[INFO]註冊新命令...");
            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID,
                ),
                {
                    body: theCommands,
                },
            );
            console.info("[INFO]Slash Commands 重新註冊成功");
        } else {
            console.info("[INFO]Slash Commands 已註冊");
        }
    } catch (error) {
        console.error("[ERROR]重註冊 Slash Command 發生例外：", error);
    }

    console.info(`[INFO]✅ 已登入為 ${client.user.tag}`);
});

// 監聽 SIGTERM 訊號（Render 停止服務時會發送此信號）
let isStoppingBot = false;
process.on('SIGTERM', async () => {
    // !stopTheDiscordBot 則跳過重啟
    if (isStoppingBot) return;

    console.info('[INFO]已收到 SIGTERM 訊號，正在開始重啟程序...');

    try {
        const response = await fetch(process.env.DEPLOY_HOOK_URL, {
            method: 'POST',  // HTTP 方法
            headers: { 'Content-Type': 'application/json' },  // 如果需要的話，可以添加 header
            body: JSON.stringify({ message: "Deploy triggered by SIGTERM" })  // 如果需要的話，可以傳送資料
        });

        if (response.ok) {
            console.info('[INFO]成功觸發部署');
        } else {
            console.error('[ERROR]觸發部署時出錯');
        }
    } catch (err) {
        console.error('[ERROR]無法觸發部署', err);
    }

    return;
});
//#endregion

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
                description: "請輸入要提問的內容；或是設定對話前提/清除前提與記憶",
                type: 3,  // 文字類型
                required: true,
                autocomplete: true,  // 加入提示
            },
            {
                name: "模型",
                description: "切換使用模型(選填)",
                type: 3,
                required: false,
                choices: MODEL_CHOICES  // 定義在 askHandler.js 內
            },
        ],
    },
];

// 監聽 Slash Command
client.on("interactionCreate", async (interaction) => {
    // !stopTheDiscordBot 後進入假眠
    if (isStoppingBot) return;

    // Autocomplete 提示邏輯
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused();
        const choices = [
            { name: "設定對話前提", value: "__setask__" },
            { name: "清除前提與記憶", value: "__clsask__" },
        ];
        const filtered = choices.filter(choice => choice.name.startsWith(focused));
        await interaction.respond(filtered);
        return;
    }

    // 不處理非指令互動
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

        const query = interaction.options.getString("提問");
        const selectedModel = interaction.options.getString("模型");

        // 確保 query 參數不為空
        if (!query) {
            return interaction.reply({
                content: "サポちゃん不會讀心！！ 請提問！！",
                flags: 64,  // 僅顯示給該用戶
            });
        }

        // 若為特殊選項
        if (query.startsWith("__setask__")) {
            const content = query.replace("__setask__", "").trim();
            console.log('content'+content);
            console.log('query'+query);
            return;
            //return await setAsk(interaction, content);  // 將內容傳入 setAsk()
        }
        if (query === "__setask__") return;  //// (await setAsk();
        if (query === "__clsask__") return;  //// (await clsAsk();

        //await slashAsk(interaction, query, selectedModel);
        return;
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
        console.info("[INFO]執行 !stopTheDiscordBot");
        await message.reply("おやすみなさい。");
        console.info("[INFO]🔴 theDiscordBot 停止中...");
        client.destroy(() => {
            console.info("[INFO]Discord 已離線");
        }); // 停止 Discord Bot

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
