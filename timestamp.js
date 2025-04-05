import moment from "moment-timezone";

// 統一處理 !time 指令
function theTimestamp(content) {
    return parseOffsetTimeCommand(content) ?? //!time+1hF
        parseFixedTimeCommand(content) ?? //!timeYYYYMMDDHHmmT
        parseTimezoneCommand(content) ?? //!timeT
        parseTimestampCommand(content); //!time
}

// 偏移時間處理
function parseOffsetTimeCommand(content) {
    const regex = /!time([+-]\d+(\.\d+)?)(h|m|d)?([fr])?(!)?/i;
    const match = content.match(regex);
    if (!match) return null;

    const amount = parseFloat(match[1]);
    const unit = match[3] || "h";  // 預設為小時
    const formatFlag = (match[4] || "t").toLowerCase();
    const format = formatFlag === "r" ? "R" : formatFlag;

    const newTime = moment().add(amount, unit);
    const timestamp = Math.floor(newTime.valueOf() / 1000);
    return content.replace(regex, match[5] ? `\`<t:${timestamp}:${format}>\`` : `<t:${timestamp}:${format}>`);
}

// 固定時間處理
function parseFixedTimeCommand(content) {
    const regex = /!time(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})([TJS])?(r)?(!)?/i;
    const match = content.match(regex);
    if (!match) return null;

    const [_, year, month, day, hour, minute, zoneFlag, formatFlagRaw, exclamationFlag] = match;

    const zones = { T: "Asia/Taipei", J: "Asia/Tokyo", S: "Europe/Stockholm" };
    const zone = zones[zoneFlag?.toUpperCase()] || null;
    if (!zone) return null;

    const formatFlag = (formatFlagRaw || "f").toLowerCase();
    const format = formatFlag === "r" ? "R" : "f";

    const newTime = moment.tz(
        `${year}-${month}-${day} ${hour}:${minute}`,
        "YYYY-MM-DD HH:mm",
        zone
    );
    const timestamp = Math.floor(newTime.valueOf() / 1000);

    return content.replace(regex, exclamationFlag ? `\`<t:${timestamp}:${format}>\`` : `<t:${timestamp}:${format}>`);
}

// 轉換為指定時區時間
function parseTimezoneCommand(content) {
    const regex = /!time([TJS])/i;
    const match = content.match(regex);
    if (!match) return null;
    
    const timezoneCommands = {
        T: { zone: "Asia/Taipei", label: "_tw" },
        J: { zone: "Asia/Tokyo", label: "_jp" },
        S: { zone: "Europe/Stockholm", label: "_se" }
    };
    const timezoneInfo = timezoneCommands[match[1]];  // 根據指令選擇時區和標籤
    if (!timezoneInfo) return null;

    const now = moment.tz(timezoneInfo.zone);
    const formattedTime = now.format("MM/DD_HH:mm");

    return content.replace(regex, `\`${formattedTime}${timezoneInfo.label}\``);
}

// !time! 顯示當前時間戳
function parseTimestampCommand(content) {
    const regex = /!time(!)?/;
    const match = content.match(regex);
    const now = Math.floor(Date.now() / 1000);
    return content.replace(regex, match[1] ? `\`<t:${now}:t>\`` : `<t:${now}:t>`);
}

export { theTimestamp };
