import fetch from 'node-fetch';  // 用於發送 HTTP 請求

// 記憶體儲存：userId => { context: [{ q, a }], preset: string, lastInteraction: number }
const memoryStore = new Map();
// 初始化 Map 結構
const createDefaultRecord = () => ({
    context: [],        // 最近對話記錄
    preset: "",         // 對話前提
    summary: "",        // 前情摘要
    lastInteraction: 0  // 最後對話時間戳
});

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

// 對話記憶上限
const MAX_CONTEXT_LENGTH = 6;
// 時限內未互動，進行主題檢查
const CONTEXT_TIMEOUT_MINUTES = 10;

// ASK 設定對話前提
export const setAsk = async (interaction, content) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應

    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const record = memoryStore.get(userId) || createDefaultRecord();

    if (!content.trim()) {
        if (record.preset) {
            console.log(`[SET]${userTag}>查詢前提：${record.preset}`);
            await interaction.editReply({
                content: `\`目前的對話前提：\`\n>>> ${record.preset}`,
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
    record.preset = content.trim();
    memoryStore.set(userId, record);

    console.log(`[SET]${userTag}>設定前提：${record.preset}`);
    await interaction.editReply({
        content: `\`已設定對話前提！！\`\n>>> ${record.preset}`,
        flags: 64,
    });
};

// ASK 清除前提與對話記憶
export const clsAsk = async (interaction) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應

    memoryStore.delete(interaction.user.id);
    console.log(`[SET]${interaction.user.tag}>清除前提記憶`);
    await interaction.editReply({
        content: "\`已清除對話前提與記憶！！\`",
        flags: 64,
    });
};

// ASK 提問主邏輯
export const slashAsk = async (interaction, content, selectedModel) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應

    const modelKeys = Object.keys(MODEL_OPTIONS);
    selectedModel = modelKeys.includes(selectedModel) ? selectedModel : modelKeys[0];  // 檢查輸入選項合法性
    const startIndex = modelKeys.indexOf(selectedModel);  // 初始選定模型

    let aiReply = '', modelName = '', fallbackNotice = '';
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;

    //// 十分鐘未互動，進行主題檢查(使用const record.lastInteraction記錄個別使用者最後對話時間，新對話若超過十分鐘就讓LLM判斷主題跟前面記憶是否相同，不同則清空記憶)

    //// 之後實作網路搜尋提供參考功能searchSummary，限制長度const MAX_SEARCH_SUMMARY_LENGTH = 700，從\n截斷
    const searchSummary = "";

    // 組合上下文
    const fullPrompt = await composeFullPrompt(userId, content, searchSummary);

    //#region 詢問模型流程
    let triedModels = 0;  // 記錄嘗試過的模型數量
    let initialModel = selectedModel;  // 記錄最初的選定模型
    while (triedModels < modelKeys.length) {
        // 從選定模型往後開始循環
        const key = modelKeys[(startIndex + triedModels) % modelKeys.length];

        try {
            // 詢問 LLM
            const result = await MODEL_OPTIONS[key].handler(fullPrompt, MODEL_OPTIONS[key]);

            if (result?.content) {
                aiReply = result.content;
                modelName = result.model;

                // log 模型切換
                const switchLog = key !== initialModel ? ` -> \`${MODEL_OPTIONS[key].name}\`` : '';
                console.log(`[REPLY]${userTag}> \`/ask\` ${content} - \`${MODEL_OPTIONS[initialModel].name}\`${switchLog}`);

                // 儲存對話記憶
                //// 之後實作壓縮記憶
                const record = memoryStore.get(userId) || createDefaultRecord();
                record.context.push({ q: content, a: aiReply });
                if (record.context.length > MAX_CONTEXT_LENGTH) {
                    record.context.shift();  // 超出記憶上限則移除最舊的一筆
                    //// 移除記憶之後整進摘要const record.summary
                }
                memoryStore.set(userId, record);

                break;  // 找到有效回應後跳出循環
            } else {
                console.warn(`[WARN]\`${MODEL_OPTIONS[key].name}\`回應無效，嘗試下一個模型`);
            }
        } catch (err) {
            console.error(`[ERROR]執行 ${MODEL_OPTIONS[key].name} 時發生錯誤:`, err);
        }

        fallbackNotice = `\`${MODEL_OPTIONS[initialModel].name} 沒回應\``;
        triedModels++;
    }

    // 如果沒有任何模型回應
    if (!aiReply) {
        console.log(`[REPLY]${userTag}> \`/ask\` ${content} - \`${MODEL_OPTIONS[initialModel].name}\` -> \`（模型皆無回應）\``);
    }
    //#endregion

    // 記錄並格式化回覆
    const formattedReply = [
        `> ${content} - <@${userId}>`, // 原提問
        aiReply,         // 模型的回應內容
        fallbackNotice,  // 沒有回應的模型提示
        aiReply && `\`by ${modelName}\`` // 模型名稱
    ].filter(Boolean).join('\n');

    // 發送分段訊息
    const chunks = splitDiscordMessage(formattedReply, `<@${userId}>`);
    if (chunks.length > 0) {
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp(chunks[i]);
        }
    }
};

// 組合完整 prompt
const composeFullPrompt = async (userId, currentQuestion, searchSummary = "") => {
    const record = memoryStore.get(userId) || createDefaultRecord();

    const { preset, context } = record;

    const formattedContext = context.length > 0
        ? `（以下為你與使用者過去的對話供參考）\n` +
        context.map(item => `使用者：${item.q}\n你：${item.a}`).join("\n\n")
        : "";

    // 前提 + 上下文 + 搜尋結果 + 當前提問
    //// 之後追加前情摘要在上下文之前
    const fullPrompt = [
        preset && `前提：${preset}`,
        formattedContext,
        searchSummary ? `（以下為搜尋結果參考）\n${searchSummary}` : '',
        `使用者：${currentQuestion}`
    ].filter(Boolean).join("\n\n");

    console.log("組合上下文：" + fullPrompt);  //// 檢查用
    return fullPrompt;
};

// 分段訊息
const splitDiscordMessage = (text, userTag, maxLength = 1950) => {
    const lines = text.split('\n');
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
            idx === 0 ? chunk : `\`(第 ${idx + 1} 段 / 共 ${chunks.length} 段)\` - ${userTag}\n${chunk}`
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

    return {
        content,
        model
    };
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
        return { content: '', model: modelName };  // 空回應
    }

    const data = await response.json();
    return {
        content: data.choices?.[0]?.message?.content || '',
        model: modelName
    };
}
//#endregion