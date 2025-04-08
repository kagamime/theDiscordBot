import moment from "moment-timezone";

// help
export async function slashHelp(interaction) {
    const now = moment();
    const formattedTime = now.format("YYYYMMDDHHmm");

    const reply = `
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

    // 回應訊息並設置為僅使用者可見
    await interaction.reply({ content: reply, flags: 64 });
}

// !diceXdY 擲 X 顆 Y 面骰
export function rollDice(content) {
    const regex = /!dice(\d*)d(\d+)/i;
    const match = content.match(regex);
    if (!match) return null;

    const count = parseInt(match[1]) || 1;
    const sides = parseInt(match[2]);

    //if (count > 100 || sides > 1000) return "🎲 數值過大，請小一點！";

    const rolls = Array.from({ length: count }, () =>
        Math.floor(Math.random() * sides) + 1
    );

    const total = rolls.reduce((a, b) => a + b, 0);
    return `🎲 擲出 ${count}d${sides}：${rolls.join(", ")}（總和 ${total}）`;
}
