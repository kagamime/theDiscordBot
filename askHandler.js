import fetch from 'node-fetch';  // 用於發送 HTTP 請求

//#region 環境初始化

// 使用者記憶
const userMemory = new Map();
// 臨時群組記憶
const groupMemory = new Map();
// 初始化 Map 結構
const cloneRecord = (src = {}) => ({
    participants: src.participants instanceof Set ? new Set(src.participants) : new Set(),  // 參與者清單
    context: Array.isArray(src.context) ? [...src.context] : [],  // 最近對話記錄
    preset: typeof src.preset === 'string' ? src.preset : '',     // 對話前提
    summary: typeof src.summary === 'string' ? src.summary : '',  // 前情摘要
    lastInteraction: typeof src.lastInteraction === 'number' ? src.lastInteraction : 0  // 最後對話時間戳
});

// 使用者對應群組Map
//const userToGroup = new Map< userId, groupId >();
const userToGroup = new Map();

// 模型清單，鍵名作為 enum 選項值
export const MODEL_OPTIONS = {
    gemini_2_0_flash: {
        name: 'gemini-2.0-flash',
        description: "低延遲的模型，適合快速回答。",
        handler: askGemini,
    },
    gemini_2_0_pro_exp: {
        name: 'gemini-2.0-pro-exp',
        description: "高品質回應模型，適合深度對話。",
        handler: askGemini,
    },
    openchat_3_5_turbo: {
        name: 'openchat/gpt-3.5-turbo',
        description: "輕量優化版 ChatGPT，訓練資料截至 2021 年。",
        handler: askOpenrouter,
    },
    openchat_3_5: {
        name: 'openchat/openchat-3.5-0106',
        description: "標準版 ChatGPT，訓練資料截至 2021 年。",
        handler: askOpenrouter,
    },
};
const modelKeys = Object.keys(MODEL_OPTIONS);

const MAX_DISCORD_REPLY_LENGTH = 1950;  // Discord 單則訊息的字數上限
const MAX_SEARCH_SUMMARY_LENGTH = 700;  // 網路搜尋結果的字數上限
const CONTEXT_TIMEOUT_MINUTES = 10;      // 時限內未互動，進行主題檢查
const MAX_CONTEXT_ROUND = 5;             // 對話記憶上限
const SUMMARY_ROUND_COUNT = 3;           // 摘要化舊對話輪數
const COMPRESSION_TRIGGER_LENGTH = 300;  // 上下文壓縮閾值
const COMPRESSION_TARGET_TOKENS = {      // 上下文壓縮率(token)
    threshold: 200,  // 第 2 輪對話後壓縮率
    merge: 450,      // 前情摘要篇幅
};

// 常數相依性檢查
if (SUMMARY_ROUND_COUNT >= MAX_CONTEXT_ROUND) {
    throw new Error(`[ERROR]SUMMARY_ROUND_COUNT (${SUMMARY_ROUND_COUNT}) 必須小於 MAX_CONTEXT_ROUND (${MAX_CONTEXT_ROUND})`);
}
//#endregion

//#region class MemoryManager 記憶管理
class MemoryManager {
    constructor() {
        this.messageOwner = new Map(); // messageId -> userId (對話訊息擁有者)
        this.userMemory = new Map();   // userId -> record
        this.groupMemory = new Map();  // groupId -> record
        this.groupCounter = 1;         // 流水號給新的 groupId
    }

    // 初始化記憶模板
    cloneRecord(src = {}) {
        return {
            participants: src.participants instanceof Set ? new Set(src.participants) : new Set(),  // 參與者清單
            context: Array.isArray(src.context) ? [...src.context] : [],                            // 最近對話記錄
            preset: typeof src.preset === 'string' ? src.preset : '',                               // 對話前提
            summary: typeof src.summary === 'string' ? src.summary : '',                            // 前情摘要
            lastInteraction: typeof src.lastInteraction === 'number' ? src.lastInteraction : 0      // 最後對話時間戳
        };
    }

    // 取得使用者的 preset
    getUserPreset(userId) {
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();
        return userRecord.preset;
    }

    // 取得 user 所屬 groupId
    getUserGroupId(userId) {
        const record = this.userMemory.get(userId);
        return record && record.participants.size > 0 ? [...record.participants][0] : null;
    }

    // 取得目前的記憶體 (group/user)
    getMemory(userId) {
        const groupId = this.getUserGroupId(userId);
        if (groupId && this.groupMemory.has(groupId)) {
            return this.groupMemory.get(groupId);
        } else {
            return this.userMemory.get(userId) ?? this.cloneRecord();
        }
    }

    // 更新記憶體
    setMemory(userId, updatedRecord) {
        // 單獨更新 preset
        if (updatedRecord.preset) {
            this.userMemory.set(userId, updatedRecord);
            return;
        }

        const groupId = this.getUserGroupId(userId);
        if (groupId && this.groupMemory.has(groupId)) {
            // 取得現有的群組記錄，保證 participants 不被覆寫
            updatedRecord.participants = this.groupMemory.get(groupId).participants;
            updatedRecord.lastInteraction = Date.now();
            this.groupMemory.set(groupId, updatedRecord);
        } else {
            // 如果沒有群組，直接存入使用者記憶體，保證 participants 不被覆寫
            const currentUserRecord = this.userMemory.get(userId);
            updatedRecord.participants = currentUserRecord ? currentUserRecord.participants : this.cloneRecord().participants;
            updatedRecord.lastInteraction = Date.now();
            this.userMemory.set(userId, updatedRecord);
        }
    }

    // 將 user 加入指定 group，或創建新 group
    addUserToGroup(userId, groupId = null) {
        // 群組初始化檢查
        if (this.getUserGroupId(userId) === groupId) return;
        this.removeUserFromGroup(userId);
        let isNewGroup = false;
        if (!groupId) {
            groupId = `group_${this.groupCounter++}`;
            this.groupMemory.set(groupId, this.cloneRecord());
            isNewGroup = true;
        }

        // 取得或初始化 group/user 記錄
        const groupRecord = this.groupMemory.get(groupId) ?? this.cloneRecord();
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();

        // 更新 participants
        groupRecord.participants.add(userId);
        userRecord.participants = new Set([groupId]);

        // 移轉與處理使用者記憶 (除了 participants,preset)
        if (isNewGroup) {
            Object.assign(groupRecord, {
                context: [...userRecord.context],
                summary: userRecord.summary,
                lastInteraction: Date.now()
            });
        }
        Object.assign(userRecord, {
            context: this.cloneRecord().context,
            summary: this.cloneRecord().summary,
            lastInteraction: this.cloneRecord().lastInteraction
        });

        // 更新資料
        this.groupMemory.set(groupId, groupRecord);
        this.userMemory.set(userId, userRecord);
    }

    // 把 user 移出 group
    removeUserFromGroup(userId) {
        const groupId = this.getUserGroupId(userId);
        if (!groupId) return;

        const groupRecord = this.groupMemory.get(groupId);
        if (groupRecord) {
            groupRecord.participants.delete(userId);
            if (groupRecord.participants.size === 0) {
                this.groupMemory.delete(groupId);
            } else {
                this.groupMemory.set(groupId, groupRecord);
            }
        }

        // 初始化使用者資料
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();
        userRecord.participants = this.cloneRecord().participants;
        this.userMemory.set(userId, userRecord);
    }

    // 儲存新的對話記錄
    saveContext(userId, qaPair) {
        const groupId = this.getUserGroupId(userId);
        if (groupId && this.groupMemory.has(groupId)) {
            const groupRecord = this.groupMemory.get(groupId);
            groupRecord.context.push(qaPair);
            groupRecord.lastInteraction = Date.now();
            this.groupMemory.set(groupId, groupRecord);
        } else {
            const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();
            userRecord.context.push(qaPair);
            userRecord.lastInteraction = Date.now();
            this.userMemory.set(userId, userRecord);
        }
    }

    // 記錄對話訊息擁有者
    setMessageOwner(messageId, userId) {
        this.messageOwner.set(messageId, userId);

        // 超過最大筆數，自動刪掉最舊的
        if (messageOwner.size > 100) {
            const firstKey = this.messageOwner.keys().next().value;
            this.messageOwner.delete(firstKey);
        }
    }

    // 取得對話訊息的擁有者
    getMessageOwner(messageId) {
        return this.messageOwner.get(messageId);
    }//// 取得的owner有點問題要想一下

    // 刪除對話訊息的擁有者記錄
    removeMessageOwner(messageId) {
        this.messageOwner.delete(messageId);
    }
}
const memoryManager = new MemoryManager();
//#endregion

//#region 主函式

// ASK 設定對話前提
export const setAsk = async (interaction, content) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const preset = memoryManager.getUserPreset(userId);

    if (!content.trim()) {
        if (preset) {
            console.log(`[SET]${userTag}>查詢前提：${preset}`);
            await interaction.editReply({
                content: `\`目前的對話前提：\`\n>>> ${preset}`,
                flags: 64,
            });
        } else {
            console.log(`[SET]${userTag}>查詢前提：（尚未設定）`);
            await interaction.editReply({
                content: `\`目前還沒有對話前提！！\``,
                flags: 64,
            });
        }
        return;
    }

    // 有傳入內容，設定新的前提
    const userRecord = memoryManager.userMemory.get(userId) ?? memoryManager.cloneRecord();
    userRecord.preset = content.trim();
    memoryManager.setMemory(userId, userRecord);

    console.log(`[SET]${userTag}>設定前提：${preset}`);
    await interaction.editReply({
        content: `\`已設定對話前提！！\`\n>>> ${preset}`,
        flags: 64,
    });
};

// ASK 清除前提與對話記憶
export const clsAsk = async (interaction) => {
    await interaction.deferReply({ flags: 64 });  // 告知 Discord 延遲回應，且回應為隱藏
    memoryManager.removeUserFromGroup(interaction.user.id);
    memoryManager.userMemory.delete(interaction.user.id);
    console.log(`[SET]${interaction.user.tag}>清除前提記憶`);
    await interaction.editReply(`\`已清除對話前提與記憶！！\``);
};

// ASK 提問主邏輯
export const slashAsk = async (interaction, query, selectedModel) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應

    selectedModel = modelKeys.includes(selectedModel) ? selectedModel : modelKeys[0];  // 檢查輸入選項合法性
    let useModel = selectedModel;

    let aiReply = '', modelName = '', fallbackNotice = '', searchSummary = '';
    let content = query;
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const record = memoryManager.getMemory(userId);

    // 逾時主題檢查
    const timeoutThreshold = CONTEXT_TIMEOUT_MINUTES * 60 * 1000;
    if (Date.now() - record.lastInteraction > timeoutThreshold && record.context.length > 0) {
        // --- 逾時主題判斷 ---
        const recentQuestions = record.context.slice(-3).map(item => `Q：${item.q}`).join('\n');
        const topicCheckPrompt = `以下是使用者近期的提問：\n${recentQuestions}\n\n現在他問：「${query}」\n\n這是否為相似主題？請僅回答「是」或「否」。`;

        try {
            const topicCheckResult = await askLLM(topicCheckPrompt, useModel);
            const isSameTopic = topicCheckResult.text.trim().startsWith("是");

            if (!isSameTopic) {
                memoryManager.removeUserFromGroup(userId);
                record.context = memoryManager.cloneRecord().context;
                record.summary = memoryManager.cloneRecord().summary;
                memoryManager.setMemory(userId, record);
                console.log(`[SET]${userTag}>主題變更，清除記憶：`);
            }
        } catch (err) {
            console.warn(`[WARN]主題判斷失敗：${err.message}`);
            // 為保險仍保留記憶
        }
    }

    // 網路搜尋提供參考
    if (content.startsWith('?') || content.startsWith('？')) {
        content = content.slice(1).trim();
        searchSummary = await searchGoogle(content);
    }

    // 組合上下文
    const fullPrompt = await composeFullPrompt(userId, content, searchSummary);

    // 詢問 LLM
    const result = await askLLM(fullPrompt, useModel);
    aiReply = result.response;
    useModel = result.usableModel;
    modelName = MODEL_OPTIONS[useModel].name;

    if (!aiReply) {
        await interaction.editReply("目前所有模型皆無回應，請稍後再試。");
        return;
    }
    if (useModel !== selectedModel) {
        fallbackNotice = `\`${MODEL_OPTIONS[selectedModel].name} 沒回應\``;
    }
    console.log(
        `[REPLY]${userTag}> \`/ask\` ${content} - \`${MODEL_OPTIONS[selectedModel].name}\`` +
        (useModel !== selectedModel
            ? ` -> \`${MODEL_OPTIONS[useModel].name}\``
            : '')
    );

    // 儲存對話記憶並處理壓縮
    const newRound = { q: content, a: aiReply };
    const contextLength = record.context.length;
    if (contextLength >= 1) {
        const prevRound = record.context[contextLength - 1];  // 僅對倒數第 2 輪進行

        if (prevRound.q.length > COMPRESSION_TRIGGER_LENGTH) {
            prevRound.q = await compressTextWithLLM(prevRound.q, COMPRESSION_TARGET_TOKENS.threshold, useModel);
        }

        if (prevRound.a.length > COMPRESSION_TRIGGER_LENGTH) {
            prevRound.a = await compressTextWithLLM(prevRound.a, COMPRESSION_TARGET_TOKENS.threshold, useModel);
        }
    }

    // 推入最新對話
    memoryManager.saveContext(userId, newRound);

    // 檢查對話輪數並前情摘要化
    if (record.context.length > MAX_CONTEXT_ROUND) {
        const overflow = record.context.splice(0, SUMMARY_ROUND_COUNT);  // 取出前面的
        const mergedText = [
            record.summary,
            ...overflow.map(item => `使用者：${item.q}\n你：${item.a}`)
        ].filter(Boolean).join("\n\n");

        const summaryResult = await compressTextWithLLM(mergedText, COMPRESSION_TARGET_TOKENS.merge, useModel);
        record.summary = summaryResult;
    }

    // 更新記憶
    memoryManager.setMemory(userId, record);

    // 記錄並格式化回覆
    const formattedReply = [
        `> ${searchSummary ? '🌐 ' : ''}${content} - <@${userId}>`, // 原提問
        aiReply,         // 模型的回應內容
        fallbackNotice,  // 沒有回應的模型提示
        aiReply && `\`by ${modelName}\`` // 模型名稱
    ].filter(Boolean).join('\n');

    // 發送分段訊息
    const chunks = splitDiscordMessage(formattedReply, MAX_DISCORD_REPLY_LENGTH, userTag);
    if (chunks.length > 0) {
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp(chunks[i]);
        }
    }
};
//#endregion

// 遍歷可用模型並詢問 LLM
const askLLM = async (query, useModel) => {
    let triedModels = 0;  // 記錄嘗試過的模型數量
    let key = null;
    let answer = null;

    while (triedModels < modelKeys.length) {
        // 從選定模型往後開始循環
        key = modelKeys[(modelKeys.indexOf(useModel) + triedModels) % modelKeys.length];

        try {
            // 詢問 LLM
            answer = await MODEL_OPTIONS[key].handler(query, MODEL_OPTIONS[key]);
            //useModel
            if (typeof answer === 'string' && answer.trim()) {
                break;  // 找到有效回應後跳出循環
            } else {
                console.warn(`[WARN]\`${MODEL_OPTIONS[key].name}\`回應無效，嘗試下一個模型`);
            }
        } catch (err) {
            console.error(`[ERROR]執行 ${MODEL_OPTIONS[key].name} 時發生錯誤:`, err);
        }

        triedModels++;
    }

    if (!answer) {
        console.error(`[ERROR]模型皆無回應`);
        return {
            response: null,
            usableModel: key,
        }
    }

    return {
        response: answer,
        usableModel: key,
    }
}

// 搜尋網路參考
const searchGoogle = async (query) => {
    const endpoint = 'https://www.googleapis.com/customsearch/v1';
    const url = `${endpoint}?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_CSE_ID}&q=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            return '找不到相關的搜尋結果。';
        }

        // 取前 3 筆結果
        const summary = data.items.slice(0, 3).map((item, index) => {
            return `${index + 1}. ${item.title}\n${item.snippet}`;
        }).join('\n');

        // 限制搜尋結果篇幅
        return splitDiscordMessage(summary, MAX_SEARCH_SUMMARY_LENGTH)[0];
    } catch (error) {
        console.error('[ERROR]搜尋時發生錯誤：', error);
        return '搜尋時發生錯誤，請稍後再試。';
    }
}

// 組合完整 prompt
const composeFullPrompt = async (userId, currentQuestion, searchSummary = "") => {
    const record = memoryManager.getMemory(userId);
    const { preset, context, summary } = record;

    const formattedSummary = summary ? `（以下為前情摘要供參考）\n${summary}` : "";
    const formattedContext = context.length > 0
        ? `（以下為你與使用者過去的對話供參考）\n` +
        context.map(item => `使用者：${item.q}\n你：${item.a}`).join("\n\n")
        : "";

    // 前提 + 前情摘要 + 上下文 + 搜尋結果 + 當前提問
    const fullPrompt = [
        preset && `前提：${preset}`,
        formattedSummary,
        formattedContext,
        searchSummary ? `（可根據下方搜尋結果作答，資訊不足請誠實回答，不提及「根據搜尋」等語句）\n${searchSummary}` : '',
        `使用者：${currentQuestion}`
    ].filter(Boolean).join("\n\n");

    if (process.env.DEBUG_FULLPROMPT === "true") {
        console.log(`[DEBUG]\`${userId}\`>組合上下文：\n${fullPrompt}`);
    }
    return fullPrompt;
};

// 摘要壓縮
const compressTextWithLLM = async (content, targetTokens, useModel) => {
    const prompt = `請將以下段落濃縮成不超過 ${targetTokens} token 的摘要，保留關鍵資訊與主要邏輯脈絡：\n\n${content}`;
    return (await askLLM(prompt, useModel)).response || '';
};

// 分段訊息
const splitDiscordMessage = (content, maxLength, userTag = null) => {
    // 字數沒過不用處理
    if (content.length <= maxLength) return [content];

    const lines = content.split('\n');
    const chunks = [];
    let current = '';

    for (const line of lines) {
        if ((current + '\n' + line).length > maxLength) {
            chunks.push(current.trim());
            current = line;
        } else {
            current += '\n' + line;
        }
    }
    if (current.trim()) chunks.push(current.trim());

    // 第二段以後加註段落標記
    if (chunks.length > 1) {
        return chunks.map((chunk, idx) =>
            idx === 0
                ? chunk
                : `\`(第 ${idx + 1} 段 / 共 ${chunks.length} 段)\`${userTag ? ` - ${userTag}` : ''}\n${chunk}`
        );
    }
    return chunks;
};

//#region 模型實作

// 使用 Gemini 模型
async function askGemini(prompt, modelConfig) {
    const model = modelConfig.name;

    // 檢查 prompt 是否包含中文字符，加入簡潔提示詞
    if (/[\u4e00-\u9fa5]/.test(prompt)) {
        prompt = `如果回答中使用中文，請使用繁體中文並避免簡體字。\n${prompt}`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {
        console.error(`[ERROR]Gemini Error: ${response.status} ${response.statusText}`);
        return { content: '', model };  // 空回應
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return content;
}

// 使用 Openrouter 模型
async function askOpenrouter(prompt, modelConfig) {
    const modelName = modelConfig.name;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://yourdomain.com/',
            'X-Title': 'DiscordBot'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: '你是一個友善又簡潔的 Discord 機器人助手，用繁體中文回答問題。' },
                { role: 'user', content: prompt }
            ]
        })
    });

    if (!response.ok) {
        console.error(`[ERROR]Openrouter Error: ${response.statusText}`);
        return '';  // 空回應
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}
//#endregion