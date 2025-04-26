import { EmbedBuilder } from "discord.js";

// !rollXdY 主函式
export async function theRollDice(content, message) {
    const rules = [
        [/!roll(?!.*[<>])\s*(\d+d\d+(?:\s*[\+-]\s*\d+d\d+)*(?:\s*[\+-]\s*\d+)?)/gi, handleCompositeDice],  // 基本骰、複合骰、加減運算
        [/!roll\s*(\d+)\s*d\s*(\d+)\s*([<>])\s*(\d+)/gi, handleSuccessDice],  // 成功/失敗判定骰
    ];

    let result = '';
    for (const [regex, handler] of rules) {
        let match;
        while ((match = regex.exec(content)) !== null) {
            console.log("[debug]" + match);
            result += handler(match) + '\n';
        }
    }

    if (!result) return;

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setDescription(result.trim());

    await message.reply({ embeds: [embed] });

    console.log(`[REPLY]${message.author.tag}> ${content}`);
}

// 基本骰、複合骰、加減運算
function handleCompositeDice([, expression]) {
    const parts = expression.replace(/\s+/g, '').match(/[+-]?\d+d\d+|[+-]?\d+/gi);
    if (!parts) return null;

    let total = 0, output = '', rollsOut = '', formula = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i], sign = part[0] === '-' ? -1 : 1;
        const clean = part.replace(/^[-+]/, '');
        let value = 0, display = '';

        if (clean.includes('d')) {
            let [count, sides] = clean.toLowerCase().split('d').map(Number);
            count = clamp(count, 1, 100); sides = clamp(sides, 2, 1000);
            const rolls = rollMultiple(count, sides);
            value = sum(rolls);

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
function handleSuccessDice([, countStr, sidesStr, operator, thresholdStr]) {
    const count = clamp(parseInt(countStr), 1, 100);
    const sides = clamp(parseInt(sidesStr), 2, 1000);
    const threshold = parseInt(thresholdStr);

    const rolls = rollMultiple(count, sides);
    const total = sum(rolls);

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

// 輔助函式 - 擲多次骰子
function rollMultiple(count, sides) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
}

// 輔助函式 - 計算總和
function sum(arr) {
    return arr.reduce((a, b) => a + b, 0);
}

// 輔助函式 - 限制範圍
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}