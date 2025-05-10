import { EmbedBuilder } from "discord.js";
import moment from "moment-timezone";
import dotenv from 'dotenv';
dotenv.config();

//#region 時區清單
export const ZONE_OPTIONS = {
    TW: {
        country: '台灣',  // UTC+8
        label: 'tw',
        timezone: 'Asia/Taipei',
    },
    JP: {
        country: '日本',  // UTC+9
        label: 'jp',
        timezone: 'Asia/Tokyo',
    },
    SE: {
        country: '瑞典',  // UTC+1 (有DST)
        label: 'se',
        timezone: 'Europe/Stockholm',
    },
    GB: {
        country: '英國',  // UTC+0 (有DST)
        label: 'uk',
        timezone: 'Europe/London',
    },
    US_E: {
        country: '美東',  // UTC-5 (有DST)
        label: 'us-e',
        timezone: 'America/New_York',
    },
    US_W: {
        country: '美西',  // UTC-8 (有DST)
        label: 'us-w',
        timezone: 'America/Los_Angeles',
    },
};

const ALL_ZONE_OPTIONS = {
    ...ZONE_OPTIONS,
    UTC_M12: { country: 'UTC-12', timezone: 'Etc/GMT+12' },
    UTC_M11: { country: 'UTC-11', timezone: 'Etc/GMT+11' },
    UTC_M10: { country: 'UTC-10', timezone: 'Etc/GMT+10' },
    UTC_M9: { country: 'UTC-9', timezone: 'Etc/GMT+9' },
    UTC_M8: { country: 'UTC-8', timezone: 'Etc/GMT+8' },
    UTC_M7: { country: 'UTC-7', timezone: 'Etc/GMT+7' },
    UTC_M6: { country: 'UTC-6', timezone: 'Etc/GMT+6' },
    UTC_M5: { country: 'UTC-5', timezone: 'Etc/GMT+5' },
    UTC_M4: { country: 'UTC-4', timezone: 'Etc/GMT+4' },
    UTC_M3: { country: 'UTC-3', timezone: 'Etc/GMT+3' },
    UTC_M2: { country: 'UTC-2', timezone: 'Etc/GMT+2' },
    UTC_M1: { country: 'UTC-1', timezone: 'Etc/GMT+1' },
    UTC_0: { country: 'UTC+0', timezone: 'Etc/GMT' },
    UTC_P1: { country: 'UTC+1', timezone: 'Etc/GMT-1' },
    UTC_P2: { country: 'UTC+2', timezone: 'Etc/GMT-2' },
    UTC_P3: { country: 'UTC+3', timezone: 'Etc/GMT-3' },
    UTC_P4: { country: 'UTC+4', timezone: 'Etc/GMT-4' },
    UTC_P5: { country: 'UTC+5', timezone: 'Etc/GMT-5' },
    UTC_P6: { country: 'UTC+6', timezone: 'Etc/GMT-6' },
    UTC_P7: { country: 'UTC+7', timezone: 'Etc/GMT-7' },
    UTC_P8: { country: 'UTC+8', timezone: 'Etc/GMT-8' },
    UTC_P9: { country: 'UTC+9', timezone: 'Etc/GMT-9' },
    UTC_P10: { country: 'UTC+10', timezone: 'Etc/GMT-10' },
    UTC_P11: { country: 'UTC+11', timezone: 'Etc/GMT-11' },
    UTC_P12: { country: 'UTC+12', timezone: 'Etc/GMT-12' },
    UTC_P13: { country: 'UTC+13', timezone: 'Etc/GMT-13' },
    UTC_P14: { country: 'UTC+14', timezone: 'Etc/GMT-14' },
};
//#endregion

//#region 主函式
export function theTimestamp(interaction, timeInput, zoneInput, visibility) {
    visibility = visibility !== "__hide__";
    const userId = interaction.user.id;
    let result = '';

    // 取得使用者時區與輸入時區
    const raw = process.env.EXCUSER_ZONE || '';
    const zoneUserKey = raw.includes(userId) ? raw.slice(raw.indexOf(userId) + userId.length + 1).split(';')[0] : 'TW';
    const zoneSetKey = zoneInput ? parseZoneKey(zoneInput) : zoneUserKey;
    if (!zoneSetKey) return { content: "請確認__時區__輸入格式", flags: 64 };

    // 當前時間 -
    if (["__now__", "-"].includes(timeInput.trim())) {
        result = formatResult(
            Math.floor(Date.now() / 1000),
            zoneSetKey,
            zoneInput,
            visibility
        );
    }
    // 相對時間 1.5h-30m+3d etc.
    else if (/^[\+\-]?\d+(?:\.\d+)?[dhm]/i.test(timeInput)) {
        result = formatResult(
            parseRelativeTime(timeInput),
            zoneSetKey,
            zoneInput,
            visibility
        );
    }
    // 指定時間 YYYYMMDDHHmm etc.
    else {
        result = parseAbsoluteTime(
            timeInput,
            zoneSetKey,
            zoneUserKey,
            visibility
        );
    }

    if (!result) {
        return { content: "請確認__時間__輸入格式", flags: 64 };
    }

    // 設定回傳的 Embed
    console.log(`[FUNC] ${interaction.user.tag}> \`/time\` timeInput: ${timeInput}, zoneInput: ${zoneInput}, visibility: ${visibility}`);
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(result.trim());
    return visibility ? { embeds: [embed] } : { embeds: [embed], flags: 64 };
}
//#endregion

//#region 子函式

// 格式化顯示結果的函數
function formatResult(result, zoneSetKey, zoneInput, visibility) {
    if (!zoneInput) {
        return visibility
            ? `<t:${result}:t> - 於<t:${result}:R>`
            : `\`<t:${result}:t>\` -> <t:${result}:t>\n\`<t:${result}:f>\` -> <t:${result}:f>\n\`<t:${result}:R>\` -> <t:${result}:R>`;
    } else {
        return convertToZoneTime(result, zoneSetKey);
    }
}

// 轉換成指定時區
function convertToZoneTime(timestamp, zoneKey) {
    const zoneCountry = ALL_ZONE_OPTIONS[zoneKey].country;
    const time = moment.tz(timestamp * 1000, ALL_ZONE_OPTIONS[zoneKey].timezone);  // 轉換為指定時區的時間

    const currentYear = moment().year();
    const inputYear = time.year();

    // 判斷是否處於夏令時間
    const isDST = time.isDST() ? " (DST)" : "";

    // 檢查年份是否不同
    const format = (currentYear === inputYear)
        ? `${zoneCountry}時間：M月D日 HH:mm` // 若年份相同，只顯示月日和時間
        : `${zoneCountry}時間：YYYY年M月D日 HH:mm`; // 若年份不同，顯示完整日期

    return time.format(format) + isDST;
}

// 解析時區
function parseZoneKey(zoneInput) {
    if (!zoneInput) return null;

    // 輸入為 key
    if (ALL_ZONE_OPTIONS[zoneInput]) {
        return zoneInput;
    }

    // 輸入為 UTC
    const match = zoneInput.match(/^UTC\s?(?:([+-]?)\s?(\d{1,2}))?$/i);
    if (match) {
        const sign = match[1].trim() || '+';
        const offset = parseInt(match[2].trim() || '0');

        const utcKey = offset === 0
            ? 'UTC_0'
            : sign === '+'
                ? `UTC_P${offset}`
                : `UTC_M${offset}`;
        if (ALL_ZONE_OPTIONS[utcKey]) {
            return utcKey;
        }
    }

    return null;
}


// 解析相對時間格式
function parseRelativeTime(input) {
    let base = moment();
    const regex = /([+\-]?\d*\.?\d+)\s*(d|h|m)/gi;
    let match;
    while ((match = regex.exec(input)) !== null) {
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (unit === 'd') base = base.add(value, 'days');
        if (unit === 'h') base = base.add(value, 'hours');
        if (unit === 'm') base = base.add(value, 'minutes');
    }
    return Math.floor(base.valueOf() / 1000);
}

// 解析指定時間格式
function parseAbsoluteTime(timeInput, zoneSetKey, zoneUserKey, visibility) {
    // 開頭！則 timeInput 時區為 zoneSetKey
    const inputZoneKey = (/^(!|！)/.test(timeInput)) ? zoneSetKey : zoneUserKey;
    const now = moment().tz(ALL_ZONE_OPTIONS[inputZoneKey].timezone);  // 取得時區當前時間
    timeInput = timeInput
        .replace(/\b(\d)\b(?=[\/:-])/g, '0$1')  // 單個數字在 /:- 前補 0（前位）
        .replace(/(?<=[\/:-])(\d)\b/g, '0$1')   // 單個數字在 /:- 後補 0（後位）
        .replace(/^(!|！)/, '')                 // 去除開頭的 ! 或 ！
        .trim();

    // 時間格式
    const formats = [
        'YYYYMMDDHHmm',  // 完整日期時間格式
        'MMDDHHmm',      // 月日小時分鐘
        'YYYY-MM-DD HH:mm',
        'YYYY/MM/DD HH:mm',
        'MM-DD HH:mm',
        'MM/DD HH:mm',
        'HH:mm',
    ];

    let parsed = null;
    // 嘗試不同格式解析 timeInput
    for (const fmt of formats) {
        parsed = moment.tz(timeInput, fmt, true, ALL_ZONE_OPTIONS[inputZoneKey].timezone);
        if (parsed.isValid()) {
            if (!parsed.year()) parsed.year(now.year());
            if (!parsed.month() && parsed.month() !== 0) parsed.month(now.month()); // 0 是一月，要保留
            if (!parsed.date()) parsed.date(now.date());
            break;
        }
    }

    console.log(`////timeInput+:${timeInput} | parsed:${parsed} | now.date:${now.date()}`); // 日期可能有問題，凌晨2時再測試

    if (!parsed || !parsed.isValid()) return null;
    const result = Math.floor(parsed.valueOf() / 1000);

    // return (開頭！) ? timestamp : string
    if (inputZoneKey === zoneSetKey) {
        return visibility
            ? `<t:${result}:t> - 於<t:${result}:R>`
            : `\`<t:${result}:t>\` -> <t:${result}:t>\n\`<t:${result}:f>\` -> <t:${result}:f>\n\`<t:${result}:R>\` -> <t:${result}:R>`;
    } else {
        return convertToZoneTime(result, zoneSetKey);
    }
}
//#endregion