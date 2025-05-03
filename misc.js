import { EmbedBuilder } from "discord.js";
import moment from "moment-timezone";

//#region help
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
//#endregion

//#region 擲骰功能
class RollDice {
    constructor() {
        this.rules = [
            [/!roll(?!.*[<>])\s*(\d+d\d+(?:\s*[\+-]\s*\d+d\d+)*(?:\s*[\+-]\s*\d+)?)/gi, this._handleCompositeDice],  // 基本骰、複合骰、加減運算
            [/!roll\s*(\d+)\s*d\s*(\d+)\s*([<>])\s*(\d+)/gi, this._handleSuccessDice],  // 成功/失敗判定骰
        ];
    }

    // !rollXdY 主函式
    async roll(content, message) {
        let replacedContent = content.split('\n').map(line => '> ' + line).join('\n') + "\n\n";
        let result = '';
        for (const [regex, handler] of this.rules) {
            // 標記原文
            replacedContent = replacedContent.replaceAll(regex, (match) => `__${match}__`);

            // 擲骰處理
            let match;
            while ((match = regex.exec(content)) !== null) {
                console.log("[debug]" + match);
                result += handler.call(this, match) + '\n';
            }
        }

        if (!result) return;

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setDescription(replacedContent + result.trim());

        await message.reply({ embeds: [embed] });

        console.log(`[REPLY]${message.author.tag}> ${content}`);
    }

    // 基本骰、複合骰、加減運算
    _handleCompositeDice([, expression]) {
        const parts = expression.replace(/\s+/g, '').match(/[+-]?\d+d\d+|[+-]?\d+/gi);
        if (!parts) return null;

        let total = 0, output = '', rollsOut = '', formula = [];
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i], sign = part[0] === '-' ? -1 : 1;
            const clean = part.replace(/^[-+]/, '');
            let value = 0, display = '';

            if (clean.includes('d')) {
                let [count, sides] = clean.toLowerCase().split('d').map(Number);
                count = this._clamp(count, 1, 100); sides = this._clamp(sides, 2, 1000);
                const rolls = this._rollMultiple(count, sides);
                value = this._sum(rolls);

                display = rolls.length > 10 ? `[小計=${value}]` : `[${rolls.join(", ")}]`;
                output += (i && sign === 1 ? ' ' : '') + (sign === -1 ? '-' : '') + `\`${count}d${sides}\``;
                rollsOut += (i && sign === 1 ? ' ' : '') + (sign === -1 ? '-' : '') + display;
            } else {
                value = Number(clean);
                output += (sign === -1 ? '-' : '+') + `\`${value}\``;
                rollsOut += (sign === -1 ? '-' : '+') + value;
            }

            total += value * sign;
            formula.push(`${sign === -1 ? '-' : (i ? '+ ' : '')}${Math.abs(value)}`);
        }

        const text = `🎲 擲出 ${output}：${rollsOut}`;
        return formula.length > 1 ? `${text} ➜ 總和：${formula.join(' ')} = ${total}` : `${text} ➜ 總和：${total}`;
    }

    // 成功/失敗判定骰
    _handleSuccessDice([, countStr, sidesStr, operator, thresholdStr]) {
        const count = this._clamp(parseInt(countStr), 1, 100);
        const sides = this._clamp(parseInt(sidesStr), 2, 1000);
        const threshold = parseInt(thresholdStr);

        const rolls = this._rollMultiple(count, sides);
        const total = this._sum(rolls);

        if (count === 1) {
            const success = (operator === '<' ? rolls[0] <= threshold : rolls[0] >= threshold);
            return `🎲 擲出 \`${count}d${sides}${operator}${threshold}\`： [${rolls[0]}] ➜ ${success ? '成功' : '失敗'}`;
        } else {
            const results = rolls.map(r => (operator === '<' ? r <= threshold : r >= threshold) ? '成功' : '失敗');
            const successByTotal = operator === '<' ? total <= threshold : total >= threshold;
            const summary = `　　➜ 總和：${rolls.join(" + ")} = ${total} ${operator} ${threshold} ➜ ${successByTotal ? '成功' : '失敗'}`;

            return `🎲 擲出 \`${count}d${sides}${operator}${threshold}\`： [${rolls.join(", ")}] ➜ ${results.join(", ")}\n${summary}`;
        }
    }

    // 擲多次骰子
    _rollMultiple(count, sides) {
        return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    }

    // 計算總和
    _sum(arr) {
        return arr.reduce((a, b) => a + b, 0);
    }

    // 限制範圍
    _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
}
// 導出roll方法
const rollDice = new RollDice();
export const theRollDice = rollDice.roll.bind(rollDice);
//#endregion
