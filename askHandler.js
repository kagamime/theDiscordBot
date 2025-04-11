import fetch from 'node-fetch';  // 用於發送 HTTP 請求

// 主要處理 ASK 命令
export const slashAsk = async (interaction, content) => {
    //// 支援 Wikipedia 或其他LLM部份之後處理

    // 執行 LLM 查詢邏輯
    try {
        // 告知 Discord 延遲回應
        await interaction.deferReply();

        const { content: aiReply, model: modelName } = await askOpenRouter(content);
        const formattedReply = [
            `> ${content} - <@${interaction.user.id}>\n`,
            aiReply,
            `\`by ${modelName}\``
        ].join('\n');

        await interaction.editReply(formattedReply);
    } catch (error) {
        console.error('[ERROR]Discord Client 發生錯誤：', error);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply('❌ 發生錯誤，請稍後再試');
        } else {
            await interaction.reply({
                content: '❌ 發生錯誤，請稍後再試',
                flags: 64,
            });
        }
    }
};

// 使用 OpenRouter AI 查詢
async function askOpenRouter(prompt) {
    const model = 'openchat/openchat-3.5-0106'; // 免費模型，可更換為其他如 nousresearch/nous-capybara-7b

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
                {
                    role: 'system',
                    content: '你是一個友善又簡潔的 Discord 機器人助手，用繁體中文回答問題。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ]
        })
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errMsg = errorBody.error?.message || response.statusText;
    
        console.error(`OpenRouter Error: ${errMsg}`);
    
        if (response.status === 429 || errMsg.includes("quota")) {
            return '⚠️ 已超出每日使用配額。';
        }
    
        return '❌ 查詢時發生錯誤，請稍後再試！';
    }
    

    const data = await response.json();
    return {
        content: data.choices?.[0]?.message?.content || '⚠️ 無回應內容',
        model
    };
}



