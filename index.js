import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { MODEL_OPTIONS, setAsk, clsAsk, slashAsk, replyAsk, replyMemory, handleMsgOwner } from "./askHandler.js";
import { theTimestamp } from "./timestamp.js";
import { theRollDice } from "./rolldice.js";
import { slashHelp } from "./misc.js";
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
        if (process.env.DEBUG_CRONJOB_CONNECT === "true") {
            console.info(`[INFO]收到請求：${req.method} cron-job.org`);
        }
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
    console.error('[ERROR]Discord Client 發生錯誤：', error); ////send log 長度問題??
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

            const guildIds = process.env.GUILD_IDS.split(',').map(id => id.trim());
            for (const guildId of guildIds) {
                // 拉取目前伺服器中的所有命令
                const existingCommands = await rest.get(
                    Routes.applicationGuildCommands(
                        process.env.CLIENT_ID,
                        guildId,
                    ),
                );

                // 刪除所有舊命令
                for (const command of existingCommands) {
                    await rest.delete(
                        Routes.applicationGuildCommand(
                            process.env.CLIENT_ID,
                            guildId,
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
                        guildId,
                    ),
                    {
                        body: theCommands,
                    },
                );
            }
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

//#region Slash Command

// 定義 Slash 命令列表
const theCommands = [
    {
        name: "control",
        description: "⚙️ 管理員控制面板",
        default_member_permissions: "0",  // 預設所有人不可見
        dm_permission: false,  // 非私訊
        type: 1,  // 類型為 1，代表是常規命令
        options: [
            {
                name: "options",
                description: "管理設定",
                type: 3,  // 文字類型
                required: true,  // 必填欄位
                autocomplete: true,  // 加入提示
            },
        ]
    },
    {
        name: "help",
        description: "サポちゃん的支援說明！！",
        dm_permission: false,
    },
    {
        name: "ask",
        description: "提問！！ サポちゃん會想辦法回答！！",
        dm_permission: false,
        type: 1,
        options: [
            {
                name: "提問",
                description: "請直接輸入要詢問的內容；或選擇「設定對話前提」與「清除前提與記憶」功能",
                type: 3,
                required: true,
                autocomplete: true,
            },
            {
                name: "追記",
                description: "可切換使用的模型（選填）；或在「設定對話前提」時輸入內容",
                type: 3,
                required: false,
                autocomplete: true,
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
        const focusedOption = interaction.options.getFocused(true);

        if (interaction.commandName === "control" && focusedOption.name === "options") {
            const choices = [
                { name: "調試記憶體內容", value: "__replymemory__" },
                {
                    name: process.env.DEBUG_CRONJOB_CONNECT === "false" ? "開啟 Cron-Job 連線 Log" : "關閉 Cron-Job 連線 Log",
                    value: "__cronjobconnectlog__"
                },
                {
                    name: process.env.DEBUG_FULLPROMPT === "false" ? "開啟上下文 Debug Log" : "關閉上下文 Debug Log",
                    value: "__fullpromptlog__"
                },
                { name: "終止執行 theDiscordBot", value: "__stopthediscordbot__" },
            ];
            const filtered = choices.filter(choice => choice.name.startsWith(focused));
            await interaction.respond(filtered);
            return;
        }

        if (interaction.commandName === "ask") {
            if (focusedOption.name === "提問") {
                const choices = [
                    { name: "查詢或設定前提 → 可於後方追記欄輸入對話前提", value: "__setask__" },
                    { name: "清除前提與記憶", value: "__clsask__" },
                ];
                const filtered = choices.filter(choice => choice.name.startsWith(focused));
                await interaction.respond(filtered);
                return;
            }

            if (focusedOption.name === "追記") {
                const query = interaction.options._hoistedOptions.find(opt => opt.name === "提問")?.value;
                const isQuery = ["__setask__", "__clsask__"].includes(query);

                // 不在提問選項內時才提供模型選項
                if (!isQuery) {
                    const modelChoices = Object.entries(MODEL_OPTIONS)  // 定義在 askHandler.js 內
                        .map(([key, value]) => ({
                            name: `${value.name}：${value.description}`, // 顯示在選單上的文字
                            value: key, // 實際傳到指令處理器的值
                        }))
                        .filter(choice => choice.name.toLowerCase().includes(focused.toLowerCase()));
                    await interaction.respond(modelChoices.slice(0, 25)); // Discord 限制最多 25 筆
                } else {
                    await interaction.respond([]);
                }
                return;
            }
        }

        return;
    }

    // 不處理非指令互動
    if (!interaction.isCommand()) return;

    // /control（僅限 admin）
    if (interaction.commandName === "control") {
        const member = interaction.member;
        const adminRoleIds = process.env.ADMIN_ROLE_IDS.split(',').map(id => id.trim());

        if (!member || !member.roles.cache.some(role => adminRoleIds.includes(role.id))) {
            await interaction.reply({ content: "❌ 你沒有使用此指令的權限。", flags: 64 });
            return;
        }

        const option = interaction.options.getString("options");
        switch (option) {
            case "__replymemory__":
                await replyMemory(interaction);
                console.info(`[GET]${interaction.user.tag}> 調試記憶體內容`);
                break;
            case "__cronjobconnectlog__":
                // 切換顯示 Cron-Job 連線 Log
                process.env.DEBUG_CRONJOB_CONNECT = process.env.DEBUG_CRONJOB_CONNECT === "true" ? "false" : "true";
                await interaction.reply({
                    content: process.env.DEBUG_CRONJOB_CONNECT === "true" ? "已開啟 Cron-Job 連線 Log" : "已關閉 Cron-Job 連線 Log",
                    flags: 64,
                });
                console.info(`[SET]${process.env.DEBUG_CRONJOB_CONNECT === "true" ? "已開啟 Cron-Job 連線 Log" : "已關閉 Cron-Job 連線 Log"}`);
                break;
            case "__fullpromptlog__":
                // 切換顯示上下文 Debug Log
                process.env.DEBUG_FULLPROMPT = process.env.DEBUG_FULLPROMPT === "true" ? "false" : "true";
                await interaction.reply({
                    content: process.env.DEBUG_FULLPROMPT === "true" ? "已開啟上下文 Debug Log" : "已關閉上下文 Debug Log",
                    flags: 64,
                });
                console.info(`[SET]${process.env.DEBUG_FULLPROMPT === "true" ? "已開啟上下文 Debug Log" : "已關閉上下文 Debug Log"}`);
                break;
            case "__stopthediscordbot__":
                isStoppingBot = 'true';
                await interaction.reply({ content: "おやすみなさい．．．", flags: 64, });
                console.info("[INFO]🔴 theDiscordBot 停止中...");
                client.destroy(() => {  ////為何沒作用
                    console.info("[INFO]Discord 已離線");
                }); // 停止 Discord Bot
                break;
            default:
                await interaction.reply({
                    content: "❌ 無效的選項。",
                    flags: 64,
                });
                break;
        }

        return;
    }

    // /help
    if (interaction.commandName === "help") {
        console.log(`[REPLY]${interaction.user.tag}> 觸發了 /help`);
        await slashHelp(interaction);
        return;
    }

    // /ask
    if (interaction.commandName === "ask") {
        // 限定使用頻道
        const allowedChannels = [
            ...process.env.ASK_CHANNEL_IDS.split(','),
            ...process.env.DEBUG_ASK_CHANNEL_IDS.split(','),
        ].map(id => id.trim());
        if (!allowedChannels.includes(interaction.channelId)) {
            const channelMentions = allowedChannels
                .filter(id => process.env.ASK_CHANNEL_IDS.includes(id))
                .map(id => `<#${id}>`)
                .join('、');
            return interaction.reply({
                content: `抱歉，提問請在 ${channelMentions || '指定頻道'} 進行。`,
                flags: 64, // ephemeral
            });
        }

        const query = interaction.options.getString("提問");
        const addendum = interaction.options.getString("追記");

        switch (query) {
            case "__setask__":  // 設定對話前提
                await setAsk(interaction, addendum);
                break;
            case "__clsask__":  // 清除前提與記憶
                await clsAsk(interaction);
                break;
            default:  // 詢問內容
                await slashAsk(interaction, query, addendum);
        }
        return;
    }
});
//#endregion

//#region !Keywords

// 監聽 Keywords
client.on("messageCreate", async (message) => {
    if (isStoppingBot) return;       // !stopTheDiscordBot 後進入假眠
    if (message.author.bot) return;  // 忽略 Bot 自己的訊息

    // 確認這是一個 reply 訊息
    if (message.reference && message.reference.messageId) {
        try {
            // 取得被回覆的那則訊息，確認被回覆的訊息是 bot 自己發的
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            if (repliedMessage.author.id !== process.env.CLIENT_ID) {
                return;
            }

            // 加入或建立話題群組
            replyAsk(message, repliedMessage.id);

            console.info(`[INFO]]${message.author.tag}>reply bot 訊息: ${repliedMessage.id}`);
        } catch (err) {
            console.error(`[ERROR]取得被回覆訊息時失敗：`, err);
        }
    }

    const content = message.content;

    // 捕獲中止命令 !stopTheDiscordBot
    const adminRoleIds = process.env.ADMIN_ROLE_IDS.split(',').map(id => id.trim());
    if (content.includes("!stopTheDiscordBot") && message.member.roles.cache.some(role => adminRoleIds.includes(role.id))) {
        isStoppingBot = 'true';
        console.info("[INFO]執行 !stopTheDiscordBot");
        await message.reply("おやすみなさい。");
        console.info("[INFO]🔴 theDiscordBot 停止中...");
        client.destroy(() => {
            console.info("[INFO]Discord 已離線");
        }); // 停止 Discord Bot

        return; // 不用 process.exit(0) 會被render重啟
    }

    if (shouldHandle(content, "!time")) {
        const result = await theTimestamp(content);
        await message.reply(result);
        console.log(`[REPLY]${message.author.tag}> ${result}`);
    }

    if (shouldHandle(content, "!roll")) {
        await theRollDice(content, message);
    }

    // 測試用途
    if (shouldHandle(content, "!msgOwner")) {
        await handleMsgOwner(content, msg => message.reply(msg));
    }
});

// 判斷是否應該處理該指令
function shouldHandle(content, keyword) {
    const regex = new RegExp(`\\\`[^\\\`]*${keyword}[^\\\`]*\\\``);
    if (regex.test(content)) return false; // 在 `內包住，不處理
    return content.includes(keyword);
}
//#endregion

client.login(process.env.DISCORD_TOKEN);
