import fetch from 'node-fetch';  // 用於發送 HTTP 請求

// 主要處理 ASK 命令
export const theAsk = async (content) => {
    //// 支援 Wikipedia 部份之後處理

    /* const aiResult = await fetchOpenRouterAI(content);
    return aiResult; */
    return "功能還沒實作!!";
};

// 使用 OpenRouter AI 查詢
const fetchOpenRouterAI = async (inputText) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const body = JSON.stringify({
        model: "openai/gpt-4",  // 設定模型（依需要調整）
        messages: [{
            role: "user",
            content: inputText
        }]
    });

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: body,
        });
        const data = await response.json();

        if (data && data.choices && data.choices[0].message) {
            return data.choices[0].message.content;  // 回傳AI的回答
        } else {
            return "I couldn't get a response from the AI.";
        }
    } catch (error) {
        console.error('[ERROR] OpenRouter API 錯誤:', error);
        return "Sorry, I couldn't fetch the response from the AI right now.";
    }
};


