import { EmbedBuilder } from "discord.js";
import moment from "moment-timezone";

//#region help
export function slashHelp() {
    const formattedTime = [
        moment().format("YYYYMMDDHHmm"),
        moment().format("MMDDHHmm"),
        moment().format("YYYY/MM/DD HH:mm"),
        moment().format("MM-DD HH:mm"),
        moment().format("HH:mm"),
    ];

    const reply = `
**__/help__** - サポちゃん的支援說明！！

**__/ask__** - 提問！！ サポちゃん會想辦法回答！！
> **___提問___：直接輸入__問題內容__** - 詢問 AI，可於後方___追記___欄切換使用模型
> **　　：直接輸入__？問題內容__** - 開頭?使用搜尋輔助詢問 AI，可於後方___追記___欄切換使用模型
> **　　：選擇__查詢或設定前提__** - 可於後方___追記___欄更新對話前提，或留空查詢現在前提
> **　　：選擇__清除前提與記憶__** - 清除對話記憶與前提
> **___追記___：配合__提問__使用** - 可輸入內容會隨__提問__變化

**___/time___** - サポちゃん可以幫忙計算時間跟時區轉換！！
> **___時間___：選「 - 」** - 代表當前時間，或配合__時區__可換算成__時區__時間
> 　　**：輸入__時間差__** - 計算__相對時間__，或配合__時區__可換算成__時區__時間
> 　　　可接受如__+1d-1.5h+30m__，單位 __d__, __h__, __m__
> 　　**：輸入__指定時間__** - 顯示__指定時間__的__時間戳格式__，或配合__時區__可換算成__時區__時間
> 　　　可接受如__ ${formattedTime[0]}__ / __${formattedTime[1]}__ / __${formattedTime[2]}__ / __${formattedTime[3]}__ / __${formattedTime[4]}__等格式
> 　　**：輸入__！指定時間__** - 配合__時區__設定，可換算成__本地時間__
> 　　　可接受如__ ！${formattedTime[0]}__ / __!${formattedTime[1]}__ / __！${formattedTime[2]}__ / __!${formattedTime[3]}__ / __！${formattedTime[4]}__等格式
> **___時區___：可__選擇時區__或__直接填入UTC__** - 對__時間__的__時區__設定，留空未選預設為__本地時區__
> **___顯隱___：可選擇__顯示__或__隱藏__** - 可__顯示__換算後時間及倒數，或__隱藏__顯示__時間戳格式__等資訊

**___!roll___**
> **!roll__3d6__ / !roll__1d3+3__ / !roll__1d100 < 50__** - 擲骰
> **!roll__ 題目__** - 抽選
> **__!roll__** - 原題重抽 (如果有)
`;

    return { content: reply, flags: 64 };
}
//#endregion

//#region 擲骰功能
class RollSomething {
    constructor() {
        this.rules = [
            [/!roll(?!.*[<>])\s*(\d+d\d+(?:\s*[\+-]\s*\d+d\d+)*(?:\s*[\+-]\s*\d+)?)/gi, this._handleCompositeDice],  // 基本骰、複合骰、加減運算
            [/!roll\s*(\d+)\s*d\s*(\d+)\s*([<>])\s*(\d+)/gi, this._handleSuccessDice],  // 成功/失敗判定骰
        ];
        this.rollRecord = '';
    }

    // 主函式
    async roll(content, message) {
        // 如果是擲骰
        const tryRollDice = this._rollDice(content, message);
        if (tryRollDice) {
            return await message.reply(tryRollDice);
        }
        // 如果是重骰
        else if (content.trim() === '!roll' && this.rollRecord !== '') {
            console.log(`[FUNC] ${message.author.tag}> \`!roll\``);
            return await this._handleChoiceRoll(this.rollRecord.trim().split('\n'), message);
        }
        // 如果是抉擇
        else {
            const lines = content.trim().split('\n');
            if (/^!roll\s+\S/.test(lines[0]) && lines.length > 0) {
                return await this._handleChoiceRoll(lines, message);
            }
        }
    }

    // !roll 隨機排序
    async _handleChoiceRoll(lines, message) {
        // 去掉 !roll 跟句尾標點符號
        const title = lines[0].replace(/^!roll\s*/i, '').replace(/[\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F\s\p{P}]+$/gu, '').trim();

        const options = lines.slice(1).filter(line => line.trim());
        if (!title || options.length < 2) {
            await message.reply('請輸入題目，並提供至少兩個選項！！ 範例：\n\`!roll 午餐吃啥\n麵\n飯\`');
            return;
        }

        const shuffled = options.sort(() => Math.random() - 0.5);
        const intro = `\` ${title}？？ 遇事不決，サポちゃん幫你骰一個！！\``;
        this.rollRecord = `!roll ${title}`;

        let content = intro;
        const sent = await message.reply(content);

        let delay = 2000;
        let count = 1;
        for (const option of shuffled) {
            await new Promise(res => setTimeout(res, delay));
            content += `\n> ${count++}. ${option}！！`;
            this.rollRecord += `\n${option}`;
            await sent.edit(content);
            delay = Math.max(delay / 2, 100); // 不小於 100ms
        }
        console.log(`[FUNC] ${message.author.tag}> \`!roll\` ${lines[0]}`);
    }

    // !rollXdY
    _rollDice(content, message) {
        let replacedContent = content.split('\n').map(line => '> ' + line).join('\n') + "\n\n";
        let result = '';
        for (const [regex, handler] of this.rules) {
            // 標記原文
            replacedContent = replacedContent.replaceAll(regex, (match) => `__${match}__`);

            // 擲骰處理
            let match;
            while ((match = regex.exec(content)) !== null) {
                result += handler.call(this, match) + '\n';
            }
        }

        if (!result) return;

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setDescription(replacedContent + result.trim());

        console.log(`[FUNC] ${message.author.tag}> ${content}`);
        return { embeds: [embed] };
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
const rollSomething = new RollSomething();
export const theRoll = rollSomething.roll.bind(rollSomething);
//#endregion
