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
\`\`\`/help  -- サポちゃん的支援說明！！\`\`\`
-# 下方說明\`<必填欄位>\`代表一定要 __選擇__ 或 __輸入__，\`[選填欄位]\`代表可以 __選擇__ 或 __輸入__ 或 __不選不設定__
\`\`\`/ask <提問> [追記]  -- 提問！！ サポちゃん會想辦法回答！！\`\`\`\`<提問>\` _- 必填欄位_
> 直接輸入 __問題內容__ **-** 詢問 AI；配合\`[追記]\`設定，可切換使用的模型。
> 直接輸入 __?問題內容__ **-** __問題內容__ 開頭加入 __?__ 可使用網路搜尋輔助詢問 AI 以支援簡單時事問答；配合\`[追記]\`設定，可切換使用的模型。
> 選擇 __「查詢或設定前提」__ **-** 可於\`[追記]\`輸入 __對話前提__ 以更新對話前提；或 __留空不選__ 可查詢已設定的前提。
> 選擇 __「清除前提與記憶」__ **-** 清除對話記憶與前提。
\`[追記]\` _- 選填欄位_
> 配合\`<提問>\`使用 **-** 可輸入內容會隨\`<提問>\`變化。
> **-** 當\`<提問>\`為 __任意輸入內容__ 時，\`[追記]\`會載入可使用的模型；或 __留空不選__ 使用預設模型。
> **-** 當\`<提問>\`為 __「查詢或設定前提」__，可於\`[追記]\`輸入 __對話前提__ 更新前提；或 __留空不選__ 查詢設定的前提。

\`\`\`/time <時間> [時區] [顯隱]  -- サポちゃん可以幫忙計算時間跟時區轉換！！\`\`\`\`<時間>\` _- 必填欄位_
> 選擇 __「 - 」__ **-** 代表當前時間；或配合\`[時區]\`設定，可換算成設定時區之時間。
> 直接輸入 __時間差__ **-** 計算相對時間；或配合\`[時區]\`設定，可換算成設定時區之時間。
> **-** 可接受單位為 __d__, __h__, __m__，輸入範例如 __+1d-1.5h+30m__ 代表計算本地時間往後一天往前1.5小時再往後30分鐘。
> 直接輸入 __指定時間__ **-** 顯示 __指定時間__ 的時間戳格式；或配合\`[時區]\`設定，可換算成設定時區之時間。
> **-** 可接受如 __${formattedTime[0]}__ / __${formattedTime[1]}__ / __${formattedTime[2]}__ / __${formattedTime[3]}__ / __${formattedTime[4]}__ 等格式。
> 直接輸入 __!指定時間__ **-** __指定時間__ 開頭加入 __!__ 可配合\`<時區>\`設定，換算回本地時間及其倒數，或時間戳格式等資訊。
> **-** 可接受如 __!${formattedTime[0]}__ / __!${formattedTime[1]}__ / __!${formattedTime[2]}__ / __!${formattedTime[3]}__ / __!${formattedTime[4]}__ 等格式。
\`[時區]\` _- 選填欄位_
> __留空不選__ **-** 預設\`<時間>\`為本地時區。
> 選擇 __「指定時區」__ **-** 對\`<時間>\`的時區設定。
> 直接輸入 __UTC__ **-** 對\`<時間>\`的時區設定。
> **-** 可接受如 __UTC__ / __UTC+8__ / __UTC-5__ 等格式。
> \`[時區]\`有設定時，配合\`<時間>\`的輸入會改變行為。
> **-** 當\`<時間>\`為 __指定時間__ 時，將本地時間換算成\`[時區]\`時間。
> **-** 當\`<時間>\`為 __!指定時間__ 時，將\`[時區]\`時間換算回本地時間。
\`[顯隱]\` _- 選填欄位_
> 選擇 __「顯示」__ **-** 顯示換算後時間及其倒數；配合\`[時區]\`設定顯示為當地時間。
> 選擇 __「隱藏」__ **-** 隱藏顯示時間戳格式等資訊；配合\`[時區]\`設定時顯示為當地時間。

\`!roll  -- 可以丟幾顆骰子或幫忙骰個決定！！\`
> !roll__3d6__ / !roll__1d3+3__ / !roll__1d100 < 50__ - 擲骰
> !roll__ 題目__ - 隨機抽選排序
> !roll - 原題重抽 (如果有)
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
        // 如果是抉擇重骰
        else if (content.trim() === '!roll' && this.rollRecord !== '') {
            console.log(`[FUNC] ${message.author.tag}> \`!roll\``);
            return await this._handleChoiceRoll(this.rollRecord.trim().split('\n'), message);
        }
        // 如果是抽選抉擇
        else {
            const lines = content.trim().split('\n');
            if (/^!roll\s*\S/.test(lines[0]) && lines.length > 0) {
                return await this._handleChoiceRoll(lines, message);
            }
        }
    }

    // !roll 隨機抽選排序
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
