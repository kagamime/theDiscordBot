import moment from "moment-timezone";

const rules = [
    [/!time([+-]\d+(\.\d+)?)(h|m|d)?([fr])?(!)?/i, parseOffsetTimeCommand], //!time+1.5hF
    [/!time(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})([TJS])?(r)?(!)?/i, parseFixedTimeCommand], //!timeYYYYMMDDHHmmT
    [/!time([TJS])/i, parseTimezoneCommand], //!timeT
    [/!time(!)?/, parseTimestampCommand] //!time
];

// 遍歷比對 !time 正則
export function theTimestamp(content) {
    for (const [regex, handler] of rules) {
        const match = content.match(regex);
        if (match) return handler(content, match);
    }
    return content;
}

// 偏移時間處理
function parseOffsetTimeCommand(content, match) {
    const amount = parseFloat(match[1]);
    const unit = match[3] || "h";
    const formatFlag = (match[4] || "t").toLowerCase();
    const format = formatFlag === "r" ? "R" : formatFlag;

    const newTime = moment().add(amount, unit);
    const timestamp = Math.floor(newTime.valueOf() / 1000);
    return content.replace(match[0], match[5] ? `\`<t:${timestamp}:${format}>\`` : `<t:${timestamp}:${format}>`);
}

// 固定時間處理
function parseFixedTimeCommand(content, match) {
    const [_, year, month, day, hour, minute, zoneFlag, formatFlagRaw, exclamationFlag] = match;

    const zones = { T: "Asia/Taipei", J: "Asia/Tokyo", S: "Europe/Stockholm" };
    const zone = zones[zoneFlag?.toUpperCase()] || null;
    if (!zone) return null;

    const formatFlag = (formatFlagRaw || "f").toLowerCase();
    const format = formatFlag === "r" ? "R" : "f";

    const newTime = moment.tz(`${year}-${month}-${day} ${hour}:${minute}`, "YYYY-MM-DD HH:mm", zone);
    const timestamp = Math.floor(newTime.valueOf() / 1000);

    return content.replace(match[0], exclamationFlag ? `\`<t:${timestamp}:${format}>\`` : `<t:${timestamp}:${format}>`);
}

// 轉換為指定時區時間
function parseTimezoneCommand(content, match) {
    const timezoneCommands = {
        T: { zone: "Asia/Taipei", label: "_tw" },
        J: { zone: "Asia/Tokyo", label: "_jp" },
        S: { zone: "Europe/Stockholm", label: "_se" }
    };
    const timezoneInfo = timezoneCommands[match[1]];
    if (!timezoneInfo) return null;

    const now = moment.tz(timezoneInfo.zone);
    const formattedTime = now.format("MM/DD_HH:mm");

    return content.replace(match[0], `\`${formattedTime}${timezoneInfo.label}\``);
}

// !time! 顯示當前時間戳
function parseTimestampCommand(content, match) {
    const now = Math.floor(Date.now() / 1000);
    return content.replace(match[0], match[1] ? `\`<t:${now}:t>\`` : `<t:${now}:t>`);
}