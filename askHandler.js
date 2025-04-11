import fetch from 'node-fetch';  // 用於發送 HTTP 請求

// 主要處理 ASK 命令
export const theAsk = async (content) => {
    //// 支援 Wikipedia 部份之後處理

    const aiResult = await askOpenRouter(content);
    return aiResult || "罷工了!!";
};

// 使用 OpenRouter AI 查詢
async function askOpenRouter(prompt) {
    const model = 'openchat/openchat-3.5-0106'; // 免費模型，可更換為其他如 nousresearch/nous-capybara-7b

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://yourdomain.com/', // 可用任意網站
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
        console.error(`OpenRouter Error: ${response.statusText}`);
        return '❌ 查詢時發生錯誤，請稍後再試！';
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    return (content ? `${content.trim()}\n\n\`by ${model}\`` : '⚠️ 無回應內容');
}


