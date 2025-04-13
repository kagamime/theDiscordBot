import fetch from 'node-fetch';  // 用於發送 HTTP 請求

// 模型清單，鍵名作為 enum 選項值
const MODEL_OPTIONS = {
    gemini: {
        name: 'gemini-2.0-flash',
        source: 'gemini',
        handler: askGemini,
    },
    openchat_3_5_turbo: {
        name: 'openchat/gpt-3.5-turbo',
        source: 'openrouter',
        handler: askOpenRouter,
    },
    openchat_3_5: {
        name: 'openchat/openchat-3.5-0106',
        source: 'openrouter',
        handler: askOpenRouter,
    },
    opengptmini: {
        name: 'openchat/gpt-4o-mini',
        source: 'openrouter',
        handler: askOpenRouter,
    }
};

// 產生 Discord 的模型選項用於註冊
export const MODEL_CHOICES = Object.entries(MODEL_OPTIONS).map(([key, value]) => ({
    name: value.name,
    value: key
}));

// 主要處理 ASK 命令
export const slashAsk = async (interaction, content, selectedModel) => {
    await interaction.deferReply(); // 告知 Discord 延遲回應

    //// 回答超過2000字會出錯待修正

    const modelKeys = Object.keys(MODEL_OPTIONS);
    const startIndex = modelKeys.indexOf(selectedModel);

    let aiReply = '', modelName = '', fallbackNotice = '';
    const userTag = interaction.user.tag;

    // 確保從選定模型開始循環
    let triedModels = 0; // 記錄嘗試過的模型數量
    let initialModel = selectedModel; // 記錄最初的選定模型

    while (triedModels < modelKeys.length) {
        const key = modelKeys[(startIndex + triedModels) % modelKeys.length];

        try {
            const result = await MODEL_OPTIONS[key].handler(content);

            if (result?.content) {
                aiReply = result.content;
                modelName = result.model;

                // 記錄模型切換
                const switchLog = key !== initialModel ? ` -> \`${MODEL_OPTIONS[key].name}\`` : '';
                console.log(`[REPLY]${userTag}> \`/ask\` ${content} - \`${MODEL_OPTIONS[initialModel].name}\`${switchLog}`);
                break;  // 找到有效回應後跳出循環
            } else {
                console.log(`[INFO]\`${MODEL_OPTIONS[key].name}\`回應無效，嘗試下一個模型`);
            }
        } catch (err) {
            console.error(`[ERROR]執行 ${MODEL_OPTIONS[key].name} 時發生錯誤:`, err);
        }

        fallbackNotice = `\`${MODEL_OPTIONS[initialModel].name}沒回應\``;
        triedModels++;
    }

    // 如果沒有任何模型回應
    if (!aiReply) {
        console.log(`[REPLY]${userTag}> \`/ask\` ${content} - \`${MODEL_OPTIONS[initialModel].name}\` -> \`（模型皆無回應）\``);
    }

    // 記錄並格式化回覆
    const formattedReply = [
        `> ${content} - <@${interaction.user.id}>`, // 原提問
        fallbackNotice,  // 沒有回應的模型提示
        aiReply,         // 模型的回應內容
        aiReply && `\`by ${modelName}\`` // 模型名稱
    ].filter(Boolean).join('\n');

    const chunks = splitDiscordMessage(formattedReply, `<@${interaction.user.id}>`);
    // 發送分段訊息
    if (chunks.length > 0) {
        await interaction.editReply(chunks[0]); // 首段用 editReply
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp(chunks[i]); // 後續用 followUp
        }
    }
};

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

// 使用 Gemini 模型
async function askGemini(prompt) {
    const model = MODEL_OPTIONS.gemini.name;

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
        console.error(`Gemini Error: ${response.status} ${response.statusText}`);
        return { content: '', model };  // 空回應
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
        content,
        model
    };
}

// 使用 OpenRouter 模型
async function askOpenRouter(prompt, modelOverride) {
    const modelKey = modelOverride || 'openchat_3_5_turbo';  // 如果沒有提供 modelOverride，則使用預設模型
    const model = MODEL_OPTIONS[modelKey];

    // 檢查模型是否存在
    if (!model) {
        console.error(`Model key '${modelKey}' is invalid or not found in MODEL_OPTIONS.`);
        return { content: '', model: 'error' };  // 空回應
    }

    const modelName = model.name;  // 正確地提取模型名稱

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
        console.error(`OpenRouter Error: ${response.statusText}`);
        return { content: '', model: modelName };  // 空回應
    }

    const data = await response.json();
    return {
        content: data.choices?.[0]?.message?.content || '',
        model: modelName
    };
}