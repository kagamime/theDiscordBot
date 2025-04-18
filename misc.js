import moment from "moment-timezone";

// help
export async function slashHelp(interaction) {
    const now = moment();
    const formattedTime = now.format("YYYYMMDDHHmm");

    const reply = `
**__/help__** - サポちゃん的支援說明！！
**__/ask__** - 提問！！ サポちゃん會想辦法回答！！
> **___提問___：直接輸入__問題內容__** - 詢問 AI，可於後方___追記___欄切換使用模型
> **___提問___：直接輸入__？問題內容__** - 開頭?使用搜尋輔助詢問 AI，可於後方___追記___欄切換使用模型
> **___提問___：選擇__查詢或設定前提__** - 可於後方___追記___欄更新對話前提，或留空查詢現在前提
> **___提問___：選擇__清除前提與記憶__** - 清除對話記憶與前提

**___!time___**
> **!time** - 顯示當前時間
> **!time__+2h__ / !time__-30m__ / !time__+1.5h__** - 計算時間，未輸入單位預設為h
> **!time+3h__F__ / !time-1d__R__** - F 顯示完整時間，R 顯示倒數時間
> **!time__TW__** / **!time__JP__** / **!time__SE__** - 顯示指定時區時間（TW=台灣, JP=日本, SE=瑞典）
> **!time__${formattedTime}__TW / JP / SE**- 轉換指定時區時間
> **!time...__!__** - 顯示時間戳
**___!dice___**
> **!dice__3d6__ / !dice__1d100__** - 擲骰
`;

    // 回應訊息並設置為僅使用者可見(ephemeral)
    await interaction.reply({ content: reply, flags: 64 });
}

// !diceXdY 擲 X 顆 Y 面骰
export function rollDice(content) {
    const regex = /!dice(\d+)d(\d+)/i;
    const match = content.match(regex);
    if (!match) return null;

    const count = parseInt(match[1]) || 1; // 擲骰的數量
    const sides = parseInt(match[2]) || 6; // 骰子的面數

    // 擲出每顆骰子的結果
    const rolls = Array.from({ length: count }, () =>
        Math.floor(Math.random() * sides) + 1
    );

    // 計算總和
    const total = rolls.reduce((a, b) => a + b, 0);

    return content.replace(match[0], `\`[${rolls.join(",")}]=>(${total})\``);
}
