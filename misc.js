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
