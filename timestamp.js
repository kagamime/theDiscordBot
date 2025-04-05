import moment from "moment-timezone";

// 統一處理 !time 指令
function theTimestamp(content) {
    const fixed = parseFixedTimeCommand(content);
    if (fixed) return fixed;

    const offset = parseTimestampCommand(content);
    if (offset) return offset;

    if (content.includes("!time")) {
        return content.replace("!time", getCurrentTimestamp());
    }

    return null;
}

// 無印 !time 顯示當前時間
function getCurrentTimestamp() {
    const now = Math.floor(Date.now() / 1000);
    return `<t:${now}:t>`;
}

function getFormattedTimestamp(offset, unit = "h", format = "t") {
    const newTime = moment().add(offset, unit);
    const timestamp = Math.floor(newTime.valueOf() / 1000);
    return `<t:${timestamp}:${format}>`;
}

// 動態偏移時間處理
function parseTimestampCommand(content) {
    const regex = /!time([+-]\d+(\.\d+)?)(h|m|d)?([fr])?/i;
    const match = content.match(regex);
    if (!match) return null;

    const amount = parseFloat(match[1]);
    const unit = match[3] || "h";
    const formatFlag = (match[4] || "t").toLowerCase();
    const format = formatFlag === "r" ? "R" : formatFlag;

    return content.replace(
        /!time[+-].*/i,
        getFormattedTimestamp(amount, unit, format),
    );
}

// 固定時間處理
function parseFixedTimeCommand(content) {
    const regex = /!time(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})([TJS])?/;
    const match = content.match(regex);
    if (!match) return null;

    const [_, year, month, day, hour, minute, zoneFlag] = match;
    const zones = { T: "Asia/Taipei", J: "Asia/Tokyo", S: "Europe/Stockholm" };
    const zone = zones[zoneFlag] || null;
    if (!zone) return null;

    const newTime = moment.tz(
        `${year}-${month}-${day} ${hour}:${minute}`,
        "YYYY-MM-DD HH:mm",
        zone,
    );
    const timestamp = Math.floor(newTime.valueOf() / 1000);
    return content.replace(/!time\d{12}[TJS]?/, `<t:${timestamp}:F>`);
}

export { theTimestamp };
