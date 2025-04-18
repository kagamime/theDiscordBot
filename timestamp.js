import moment from "moment-timezone";

const rules = [
    [/!time([+-]\d+(\.\d+)?)(h|m|d)?([fr])?(!)?/i, parseOffsetTimeCommand], //!time+1.5hF
    [/!time(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(TW|JP|SE)?(r)?(!)?/i, parseFixedTimeCommand], //!timeYYYYMMDDHHmmTW
    [/!time(TW|JP|SE)/i, parseTimezoneCommand], //!timeTW
    [/!time(!)?/, parseTimestampCommand] //!time
];

// 統一處理 !time 指令
export function theTimestamp(content) {

    do {
        // 遍歷比對正則
        for (const [regex, handler] of rules) {
            const match = content.match(regex);
            if (match) {
                content = handler(content, match);
                break;
            }
        }
    } while (content.includes('!time'));
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

    const zones = { TW: "Asia/Taipei", JP: "Asia/Tokyo", SE: "Europe/Stockholm" };
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
        TW: { zone: "Asia/Taipei", label: "_tw" },
        JP: { zone: "Asia/Tokyo", label: "_jp" },
        SE: { zone: "Europe/Stockholm", label: "_se" }
    };
    const timezoneInfo = timezoneCommands[match[1].toUpperCase()];
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