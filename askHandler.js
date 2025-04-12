import fetch from 'node-fetch';  // 用於發送 HTTP 請求

// 模型清單，鍵名作為 enum 選項值
export const MODEL_OPTIONS = {
    gemini: {
        name: 'gemini-2.0-flash',
        source: 'gemini',
        handler: askGemini,
    },
    openchat: {
        name: 'openchat/openchat-3.5-0106',
        source: 'openrouter',
        handler: askOpenRouter,
    },
    opengpt: {
        name: 'openchat/gpt-3.5-turbo',
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
    //// 支援 Wikipedia 或其他LLM部份之後處理

    // 告知 Discord 延遲回應
    await interaction.deferReply();

    let modelKeys = Object.keys(MODEL_OPTIONS);
    let fallbackNotice = '';
    let modelInfo = MODEL_OPTIONS[selectedModel] || MODEL_OPTIONS['openchat'];
    let aiReply = '', modelName = '';

    for (let i = modelKeys.indexOf(selectedModel); i < modelKeys.length; i++) {
        const key = modelKeys[i];
        const model = MODEL_OPTIONS[key];
        try {
            const result = await model.handler(content);
            if (result?.content && !result.content.startsWith('❌')) {
                aiReply = result.content;
                modelName = result.model;

                // 加入模型切換紀錄（如有）
                if (key !== selectedModel) {
                    fallbackNotice = `\`${MODEL_OPTIONS[selectedModel].name}已超支\``;
                    console.log(`[REPLY]${interaction.user.tag}> /ask ${content} - ${selectedModel} -> ${key}`);
                } else {
                    console.log(`[REPLY]${interaction.user.tag}> /ask ${content} - \`${key}\``);
                }
                break;
            } else {
                if (key === selectedModel) fallbackNotice = `\`${MODEL_OPTIONS[selectedModel].name}沒回應\``;
            }
        } catch (err) {
            console.error(`[ERROR] 執行 ${key} 模型時發生例外：`, err);
            if (key === selectedModel) fallbackNotice = `\`${MODEL_OPTIONS[selectedModel].name}沒回應\``;
        }
    }

    const formattedReply = [
        `> ${content} - <@${interaction.user.id}>`,
        fallbackNotice,
        aiReply,
        `\`by ${modelName}\``
    ].filter(Boolean).join('\n');

    await interaction.editReply(formattedReply);
};

// 使用 Gemini 模型
async function askGemini(prompt) {
    const model = MODEL_OPTIONS.gemini.name;  // e.g. "gemini-2.0-flash"

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`Gemini Error: ${response.status} ${response.statusText}`, errorData);
        return { content: '❌ 查詢時發生錯誤，請稍後再試！', model };
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ 無回應內容';

    return {
        content,
        model
    };
}

// 使用 OpenRouter 模型
async function askOpenRouter(prompt, modelOverride) {
    const modelKey = modelOverride || 'openchat';
    const model = MODEL_OPTIONS[modelKey].name;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://yourdomain.com/',
            'X-Title': 'DiscordBot'
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: '你是一個友善又簡潔的 Discord 機器人助手，用繁體中文回答問題。' },
                { role: 'user', content: prompt }
            ]
        })
    });

    if (!response.ok) {
        console.error(`OpenRouter Error: ${response.statusText}`);
        return { content: '❌ 查詢時發生錯誤，請稍後再試！', model };
    }

    const data = await response.json();
    return {
        content: data.choices?.[0]?.message?.content || '⚠️ 無回應內容',
        model
    };
}
