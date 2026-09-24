import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { MODEL_OPTIONS, setAsk, clsAsk, slashAsk, replyAsk, replyMemory, handleMsgOwner } from "./askHandler.js";
import { theTimestamp, ZONE_OPTIONS } from "./timestamp.js";
import { slashHelp, theRoll, theUrl } from "./misc.js";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

console.log("___________________________________");

//#region 環境初始化

const procId = Date.now().toString().slice(-4);
let isStoppingBot = false;
let isCronJobPing = false;

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
    if (isStoppingBot) return res.status(403).end();  // 進入假眠，回應403

    // 收到 cron-job 定時請求
    if (req.headers['the-cron-job'] === 'true') {
        if (!isCronJobPing) {
            isCronJobPing = true;
            console.info(`[INFO] 確認 cron-job 請求，重啟機制就緒`);
        }
        if (process.env.DEBUG_CRONJOB_CONNECT === "true") {
            console.info(`[INFO] 收到請求：${req.method} cron-job.org`);
        }
    } else {
        console.info(`[INFO] 收到請求：${req.method} ${req.originalUrl}`);
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
    console.info(`[INFO] Web Server 正在埠 ${port} 運行`);
});

// 錯誤事件處理
app.on('error', (error) => {
    console.error('[ERROR] Express 伺服器錯誤：', error);
});
client.on('error', (error) => {
    console.error('[ERROR] Discord Client 發生錯誤：', error); ////send log 長度問題?? 長文進歷史後
});

// 覆寫 console.log，使其同時發送到 Discord
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
            console.info("[INFO] 刪除舊命令並註冊新命令...");

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
                    console.info("[INFO] 刪除舊命令：" + command.id);
                }

                // 註冊新的命令
                console.info("[INFO] 註冊新命令...");
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
            console.info("[INFO] Slash Commands 重新註冊成功");
        } else {
            console.info("[INFO] Slash Commands 已註冊");
        }
    } catch (error) {
        console.error("[ERROR] 重註冊 Slash Command 發生例外：", error);
    }

    console.info(`[INFO] ✅ theDiscordBot\`(${procId})\` 已啟動，登入為 ${client.user.tag}`);
});

// 監聽 SIGTERM 訊號（Render 停止服務時會發送此信號）
process.on('SIGTERM', async () => {
    console.info(`[INFO] 已收到 SIGTERM 訊號，準備結束 theDiscordBot\`(${procId})\``);

    // 當接收過 cron-job ping 之後或SIGTERM_REDEPLOY才啟用重啟機制
    if (isCronJobPing || process.env.SIGTERM_REDEPLOY === 'true') {
        console.info('[INFO] 正在重啟部署...');
        try {
            const response = await fetch(process.env.DEPLOY_HOOK_URL, {
                method: 'POST',  // HTTP 方法
                headers: { 'Content-Type': 'application/json' },  // 如果需要的話，可以添加 header
                body: JSON.stringify({ message: "Deploy triggered by SIGTERM" })  // 如果需要的話，可以傳送資料
            });

            if (response.ok) {
                console.info('[INFO] 成功觸發部署');
            } else {
                console.error('[ERROR] 觸發部署時出錯');
            }
        } catch (err) {
            console.error('[ERROR] 無法觸發部署', err);
        }
    }

    return;
});

// 於 Render 上進入假眠
function stopTheDiscordBot() {
    console.info(`[INFO] 🔴 theDiscordBot\`(${procId})\` 停止中...`);

    isStoppingBot = true;
    isCronJobPing = false;

    // 停止 Discord Bot
    console.info("[INFO] Discord 已離線");
    client.destroy();
}

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
        options: [
            {
                name: "分項",
                description: "子項目說明",
                type: 3,
                required: false,
                autocomplete: true,
            },
        ],
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
    {
        name: "time",
        description: "サポちゃん可以幫忙計算時間跟時區轉換！！",
        dm_permission: false,
        type: 1,
        options: [
            {
                name: "時間",
                description: "輸入「指定時間(MM/DD HH:mm)」或「時間差(+1.5h)」可顯示時間戳或換算成「時區」時間，或「！指定時間」可查詢「時區」對應本地時間",
                type: 3,
                required: true,
                autocomplete: true,
            },
            {
                name: "時區",
                description: "可「選擇時區」或直接填入「UTC」，留空未選預設為「本地時區」",
                type: 3,
                required: false,
                autocomplete: true,
            },
            {
                name: "顯隱",
                description: "「顯示」或「隱藏」查詢的輸出結果",
                type: 3,
                required: false,
                autocomplete: true,
            },
        ],
    },
];

// 定義 Autocomplete 提示列表
const autocompleteHandlers = {
    control: {
        options: async (focused) => {
            const choices = [
                { name: "調試記憶體內容", value: "__replymemory__" },
                {
                    name: process.env.DEBUG_CRONJOB_CONNECT === "false"
                        ? "開啟 Cron-Job 連線 Log"
                        : "關閉 Cron-Job 連線 Log",
                    value: "__cronjobconnectlog__"
                },
                {
                    name: process.env.DEBUG_FULLPROMPT === "false"
                        ? "開啟上下文 Debug Log"
                        : "關閉上下文 Debug Log",
                    value: "__fullpromptlog__"
                },
                { name: "終止執行 theDiscordBot", value: "__stopthediscordbot__" },
            ];
            return choices.filter(c => c.name.startsWith(focused));
        }
    },
    help: {
        分項: async (focused) => {
            const choices = [
                { name: "/ask", value: "__ask__" },
                { name: "/time", value: "__time__" },
                { name: "!roll", value: "__roll__" },
            ];
            return choices.filter(c => c.name.startsWith(focused));
        }
    },
    ask: {
        提問: async (focused) => {
            return [
                { name: "查詢或設定前提 → 可於後方追記欄輸入對話前提", value: "__setask__" },
                { name: "清除前提與記憶", value: "__clsask__" }
            ].filter(c => c.name.startsWith(focused));
        },
        追記: async (focused, interaction) => {
            const query = interaction.options.get("提問")?.value;
            const isQuery = ["__setask__", "__clsask__"].includes(query);
            if (isQuery) return [];               // 不在提問選項內時才提供模型選項
            return Object.entries(MODEL_OPTIONS)  // 定義在 askHandler.js 內
                .map(([key, value]) => ({
                    name: `${value.name}：${value.description}`,  // 顯示在選單上的文字
                    value: key                                    // 實際傳到指令處理器的值
                }))
                .filter(c => c.name.toLowerCase().includes(focused.toLowerCase()))
                .slice(0, 25);  // Discord 限制最多 25 筆
        }
    },
    time: {
        時間: async (focused) => {
            return [{ name: "-", value: "__now__" }].filter(c => c.name.startsWith(focused));
        },
        時區: async (focused) => {
            return Object.entries(ZONE_OPTIONS)  // 定義在 timestamp.js 內
                .map(([key, value]) => ({
                    name: `${value.country}(${value.label})`,
                    value: key
                }))
                .filter(c => c.name.toLowerCase().includes(focused.toLowerCase()))
                .slice(0, 25);
        },
        顯隱: async (focused) => {
            return [
                { name: "顯示", value: "__show__" },
                { name: "隱藏", value: "__hide__" }
            ].filter(c => c.name.startsWith(focused));
        }
    }
};

// 監聽 Slash Command
client.on("interactionCreate", async (interaction) => {
    if (isStoppingBot) return;  // 進入假眠

    // Autocomplete 提示邏輯
    if (interaction.isAutocomplete()) {
        const { commandName } = interaction;
        const focusedOption = interaction.options.getFocused(true);
        const focused = focusedOption.value;

        const handlerGroup = autocompleteHandlers[commandName];
        const handler = handlerGroup?.[focusedOption.name];
        if (handler) {
            try {
                const results = await handler(focused, interaction);
                await interaction.respond(results);
            } catch (err) {
                if (err.code !== 40060) console.error("[ERROR] Autocomplete Error: ", err);
            }
        }
        return;
    }

    // 不處理非指令互動
    if (!interaction.isChatInputCommand()) return;

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
                console.info(`[GET] \`${interaction.user.tag}\`> 調試記憶體內容`);
                break;
            case "__cronjobconnectlog__":
                // 切換顯示 Cron-Job 連線 Log
                process.env.DEBUG_CRONJOB_CONNECT = process.env.DEBUG_CRONJOB_CONNECT === "true" ? "false" : "true";
                await interaction.reply({
                    content: process.env.DEBUG_CRONJOB_CONNECT === "true" ? "已開啟 Cron-Job 連線 Log" : "已關閉 Cron-Job 連線 Log",
                    flags: 64,
                });
                console.info(`[SET] \`${interaction.user.tag}\`> ${process.env.DEBUG_CRONJOB_CONNECT === "true" ? "已開啟 Cron-Job 連線 Log" : "已關閉 Cron-Job 連線 Log"}`);
                break;
            case "__fullpromptlog__":
                // 切換顯示上下文 Debug Log
                process.env.DEBUG_FULLPROMPT = process.env.DEBUG_FULLPROMPT === "true" ? "false" : "true";
                await interaction.reply({
                    content: process.env.DEBUG_FULLPROMPT === "true" ? "已開啟上下文 Debug Log" : "已關閉上下文 Debug Log",
                    flags: 64,
                });
                console.info(`[SET] \`${interaction.user.tag}\`> ${process.env.DEBUG_FULLPROMPT === "true" ? "已開啟上下文 Debug Log" : "已關閉上下文 Debug Log"}`);
                break;
            case "__stopthediscordbot__":
                await interaction.reply({ content: "おやすみなさい．．．", flags: 64, });
                stopTheDiscordBot();
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
        console.info(`[GET] \`${interaction.user.tag}\`> 觸發了 \`/help\``);
        await interaction.reply(slashHelp(interaction.options.getString("分項")));
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

    // /time
    if (interaction.commandName === "time") {
        const result = theTimestamp(interaction,
            interaction.options.getString("時間"),
            interaction.options.getString("時區"),
            interaction.options.getString("顯隱"),
        );
        await interaction.reply(result);
        return;
    }
});
//#endregion

//#region !Keywords

// 監聽 Keywords
client.on("messageCreate", async (message) => {
    if (isStoppingBot) return;       // 進入假眠
    if (message.author.bot) return;  // 忽略 Bot 自己的訊息

    const content = message.content;

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
        } catch (err) {
            console.error(`[ERROR] 取得被回覆訊息時失敗：`, err);
        }
    }

    // 管理員指令
    const adminRoleIds = process.env.ADMIN_ROLE_IDS.split(',').map(id => id.trim());
    if (message.member.roles.cache.some(role => adminRoleIds.includes(role.id))) {
        // 捕獲中止命令 !stopTheDiscordBot
        if (content.includes("!stopTheDiscordBot")) {
            await message.reply("おやすみなさい。");
            stopTheDiscordBot();
            return; // 不用 process.exit(0) 會被render重啟
        }

        // 測試用途
        if (shouldHandle(content, "!test")) {
            await handleMsgOwner(content, msg => message.reply(msg));
        }
    }

    // 各種骰
    if (shouldHandle(content, "!roll") || shouldHandle(content, "！roll")) {
        await theRoll(content, message);
    }

    // 網址轉譯
    if (content.includes("https://")) {
        const converted = await theUrl(content, msg => message.reply(msg), message.author.tag);
        if (converted) {
            await message.suppressEmbeds(); // 轉譯後隱藏原始網址的預覽
        }
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