import fetch from 'node-fetch';  // 用於發送 HTTP 請求

//#region 環境初始化

// 模型清單，鍵名作為 enum 選項值
export const MODEL_OPTIONS = {
    gemini_2_0_flash: {
        name: 'gemini-2.0-flash',
        description: "低延遲的模型，適合快速回答，訓練資料截至 2023 年初。",
        handler: askGemini,
    },
    gemini_2_0_pro_exp: {
        name: 'gemini-2.0-pro-exp',
        description: "高品質回應模型，適合深度對話，訓練資料截至 2023 年初。",
        handler: askGemini,
    },
    openchat_3_5_turbo: {
        name: 'openai/gpt-3.5-turbo',
        description: "輕量優化版 ChatGPT，訓練資料截至 2021 年。",
        handler: askOpenrouter,
    },
    openchat_7b: {
        name: 'openchat/openchat-7b',
        description: "OpenChat 7B（免費版），相當於基礎 GPT-3.5，訓練資料截至 2023 年中。",
        handler: askOpenrouter,
    },
};
const modelKeys = Object.keys(MODEL_OPTIONS);

const MAX_DISCORD_REPLY_LENGTH = 1800;  // Discord 單則訊息的字數上限
const MAX_SEARCH_SUMMARY_LENGTH = 700;  // 網路搜尋結果的字數上限
const CONTEXT_TIMEOUT_MINUTES = 10;      // 時限內未互動，進行主題檢查
const QUEUE_LOCK_TIMEOUT = 10;           // 群組排隊鎖最大逾時
const MAX_CONTEXT_ROUND = 5;             // 對話記憶上限
const SUMMARY_ROUND_COUNT = 3;           // 摘要化舊對話輪數
const COMPRESSION_TRIGGER_LENGTH = 300;  // 上下文壓縮閾值
const COMPRESSION_TARGET_TOKENS = {      // 上下文壓縮率(token)
    threshold: 200,  // 第 2 輪對話後壓縮率
    merge: 450,      // 前情摘要篇幅
};
let useModel = null;  // 記錄當前可用 model

// 常數相依性檢查
if (SUMMARY_ROUND_COUNT >= MAX_CONTEXT_ROUND) {
    throw new Error(`[ERROR] SUMMARY_ROUND_COUNT (${SUMMARY_ROUND_COUNT}) 必須小於 MAX_CONTEXT_ROUND (${MAX_CONTEXT_ROUND})`);
}

class MemoryManager {
    constructor() {
        this.messageOwner = new Map(); // messageId -> userId (對話訊息擁有者)
        this.userMemory = new Map();   // userId -> record{}
        this.groupMemory = new Map();  // groupId -> record{}
        this.groupCounter = 1;         // 流水號給新的 groupId
        this.queueLock = new Map();    // groupId -> queue[]
    }

    // ---- userMemory / groupMemory ----

    // 初始化記憶模板
    cloneRecord(src = {}) {
        return {
            participants: src.participants instanceof Set ? new Set(src.participants) : new Set(),  // 參與者清單
            preset: typeof src.preset === 'string' ? src.preset : '',                               // 對話前提
            summary: typeof src.summary === 'string' ? src.summary : '',                            // 前情摘要
            context: Array.isArray(src.context) ? [...src.context] : [],                            // 最近對話記錄
            lastInteraction: typeof src.lastInteraction === 'number' ? src.lastInteraction : 0      // 最後對話時間戳
        };
    }

    // 取得使用者的 preset
    getUserPreset(userId) {
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();
        return userRecord.preset;
    }

    // 更新使用者的 preset
    setUserPreset(userId, preset) {
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();
        userRecord.preset = preset;
        this.userMemory.set(userId, userRecord);
    }

    // 取得 user 所屬 groupId
    getUserGroupId(userId) {
        if (!userId) return null;
        const record = this.userMemory.get(userId);
        return record && record.participants.size > 0 ? [...record.participants][0] : null;
    }

    // 取得目前的記憶體 (group/user)
    getMemory(userId) {
        if (!userId) return null;
        const groupId = this.getUserGroupId(userId);
        if (groupId && this.groupMemory.has(groupId)) {
            return this.groupMemory.get(groupId);
        } else {
            return this.userMemory.get(userId) ?? this.cloneRecord();
        }
    }

    // 更新記憶體
    setMemory(userId, updatedRecord) {
        const groupId = this.getUserGroupId(userId);
        if (groupId && this.groupMemory.has(groupId)) {
            // 取得現有的群組記錄，保證 participants/preset 不被覆寫
            Object.assign(updatedRecord, {
                participants: this.groupMemory.get(groupId).participants,
                preset: this.cloneRecord().preset,
                lastInteraction: Date.now()
            });
            this.groupMemory.set(groupId, updatedRecord);
        } else {
            // 如果沒有群組，直接存入使用者記憶體，保證 participants 不被覆寫
            const currentUserRecord = this.userMemory.get(userId) ?? this.cloneRecord();
            Object.assign(updatedRecord, {
                participants: currentUserRecord ? currentUserRecord.participants : this.cloneRecord().participants,
                lastInteraction: Date.now()
            });
            this.userMemory.set(userId, updatedRecord);
        }
    }

    // 將 user 加入指定 group，或建立新 group
    addUserToGroup(userId, groupId) {
        // 群組初始化檢查
        if (groupId && this.getUserGroupId(userId) === groupId) return;
        this.removeUserFromGroup(userId);

        let isNewGroup = false;
        if (!groupId) {
            groupId = `group_${this.groupCounter++}`;
            this.groupMemory.set(groupId, this.cloneRecord());
            isNewGroup = true;
        }

        // 取得或初始化 group/user 記錄
        const groupRecord = this.groupMemory.get(groupId) ?? this.cloneRecord();
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();

        // 更新 participants
        groupRecord.participants.add(userId);
        userRecord.participants = new Set([groupId]);

        // 移轉與處理使用者記憶 (除了 participants,preset)
        if (isNewGroup) {
            Object.assign(groupRecord, {
                context: [...userRecord.context],
                summary: userRecord.summary,
                lastInteraction: Date.now()
            });
        }
        Object.assign(userRecord, {
            context: this.cloneRecord().context,
            summary: this.cloneRecord().summary,
            lastInteraction: this.cloneRecord().lastInteraction
        });

        // 更新資料
        this.groupMemory.set(groupId, groupRecord);
        this.userMemory.set(userId, userRecord);

        return groupId;
    }

    // 把 user 移出 group
    removeUserFromGroup(userId) {
        const groupId = this.getUserGroupId(userId);
        if (!groupId) return null;

        const groupRecord = this.groupMemory.get(groupId);
        if (groupRecord) {
            groupRecord.participants.delete(userId);
            if (groupRecord.participants.size === 0) {
                this.groupMemory.delete(groupId);
            } else {
                this.groupMemory.set(groupId, groupRecord);
            }
        }

        // 初始化使用者資料
        const userRecord = this.userMemory.get(userId) ?? this.cloneRecord();
        userRecord.participants = this.cloneRecord().participants;
        this.userMemory.set(userId, userRecord);
        return 'removed';
    }

    // ---- MessageOwner ----

    // 取得對話訊息的擁有者
    getMessageOwner(messageId) {
        if (!this.messageOwner) {
            console.error(`[ERROR] messageOwner未建立`);
            return null;
        }
        if (!this.messageOwner.has(messageId)) {
            console.warn(`[WARN] 找不到訊息ID: ${messageId} 擁有者`);
            return null;
        }
        return this.messageOwner.get(messageId);
    }

    // 更新對話訊息擁有者
    setMessageOwner(messageId, userId) {
        this.messageOwner.set(messageId, userId);

        // 超過最大筆數，自動刪掉最舊的
        if (this.messageOwner.size > 100) {
            const firstKey = this.messageOwner.keys().next().value;
            this.messageOwner.delete(firstKey);
        }
    }

    // 移除或轉移對話所有權
    removeMessageOwner(userId) {
        const groupId = this.getUserGroupId(userId);
        const groupRecord = groupId ? this.getGroupRecord(groupId) : null;

        // 如果使用者有群組且群組內有其他成員
        if (groupRecord && groupRecord.participants.size > 2) {
            // 找出一個非 userId 的參與者作為新擁有者
            const newOwnerId = [...groupRecord.participants].find(p => p !== userId);

            if (newOwnerId) {
                // 統一轉移所有權
                for (let [msgId, ownerId] of this.messageOwner) {
                    if (ownerId === userId) {
                        this.messageOwner.set(msgId, newOwnerId);
                    }
                }
            }
        }

        // 移除 userId 的所有訊息所有權
        for (let [msgId, ownerId] of this.messageOwner) {
            if (ownerId === userId) {
                this.messageOwner.delete(msgId);  // 刪除該 msgId
            }
        }
    }

    // 手動移轉所有權 - 測試用途
    changeMessageOwner(messageId, userId) {
        const newOwnerId = userId || ((Date.now() - 1420070400000) * 4194304 + Math.floor(Math.random() * 4194304)).toString(); // userId 未指定則隨機生成

        // 記憶轉移
        const oldOwnerId = this.messageOwner.get(messageId);
        if (oldOwnerId && oldOwnerId !== newOwnerId) {
            const oldRecord = this.userMemory.get(oldOwnerId);
            if (oldRecord) {
                this.userMemory.set(newOwnerId, oldRecord);
                this.userMemory.delete(oldOwnerId);
            }
        }

        // 記錄轉移
        this.messageOwner.set(messageId, newOwnerId);
    }

    // ---- queueLock ----

    // 第一次呼叫：加入排隊
    queueLockEnter(groupId, timeout = 10000) {
        if (!this.queueLock.has(groupId)) {
            this.queueLock.set(groupId, []);
        }

        const queue = this.queueLock.get(groupId); // 取得對應的隊列

        let timeoutId; // 用來存儲 timeout 設定的 ID

        return new Promise((resolve, reject) => {
            const isFirst = queue.length === 0; // 判斷目前的隊列是否是空的，即是否是第一個進來的請求

            // 定義排隊後解鎖的函數
            const wrappedResolve = () => {
                clearTimeout(timeoutId);  // 排隊完成後清除 timeout 設定
                resolve();  // 完成排隊，放行
            };

            // 把 wrappedResolve（解鎖函數）放到隊列中
            queue.push(wrappedResolve);

            // 如果是第一個進來的請求，立即放行
            if (isFirst) {
                wrappedResolve();  // 第一個請求不需要等待，立刻解鎖
            }

            // 設定超時機制：超過 timeout 時候 reject 排隊
            timeoutId = setTimeout(() => {
                const index = queue.indexOf(wrappedResolve);  // 查找請求是否還在隊列中
                if (index !== -1) {
                    queue.splice(index, 1);  // 如果請求還在隊列中，將其移除
                }
                reject(new Error(`queueLockEnter timeout (${timeout}ms)`));  // 超時，拒絕這個請求
            }, timeout);
        });
    }

    /* ////--使用例--
    try {
      // 排隊並自動處理 timeout
      await memoryManager.queueLockEnter(groupId, 1000 * QUEUE_LOCK_TIMEOUT);  // 超時
      const reply = await askLLM(query, model);  // 詢問 LLM
      // 寫入記憶
    } catch (err) {
      console.error(`[LOCK ERROR]`, err);  // 處理 timeout 或其他錯誤
    } finally {
      memoryManager.queueLockLeave(groupId);  // 釋放排隊
    }
    */

    // 第二次呼叫：釋放排隊（用於寫入記憶） ////注意ask失敗時或有先return情況
    queueLockLeave(groupId) {
        const queue = this.queueLock.get(groupId);
        if (!queue || queue.length === 0) return;

        queue.shift(); // 自己離開

        const next = queue[0];
        if (next) next(); // 放行下一位
    }
}
const memoryManager = new MemoryManager();
//#endregion

//#region 主函式

// ASK 設定對話前提
export const setAsk = async (interaction, content) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    let preset = memoryManager.getUserPreset(userId);

    if (!content || !content.trim()) {
        if (preset) {
            console.info(`[GET] ${userTag}>查詢前提：${preset}`);
            await interaction.editReply({
                content: `\`目前的對話前提：\`\n>>> ${preset}`,
                flags: 64,
            });
        } else {
            console.info(`[GET] ${userTag}>查詢前提：（尚未設定）`);
            await interaction.editReply({
                content: `\`目前還沒有對話前提！！\``,
                flags: 64,
            });
        }
        return;
    }

    // 有傳入內容，設定新的前提
    preset = content.trim();
    memoryManager.setUserPreset(userId, preset);
    console.info(`[SET] ${userTag}>設定前提：${preset}`);
    await interaction.editReply({
        content: `\`已設定對話前提！！\`\n>>> ${preset}`,
        flags: 64,
    });
};

// ASK 清除前提與對話記憶
export const clsAsk = async (interaction) => {
    await interaction.deferReply({ flags: 64 });  // 告知 Discord 延遲回應，且回應為隱藏
    memoryManager.removeUserFromGroup(interaction.user.id);
    memoryManager.userMemory.delete(interaction.user.id);
    console.info(`[SET] ${interaction.user.tag}>清除前提記憶`);
    await interaction.editReply(`\`已清除對話前提與記憶！！\``);
};

// ASK 提問主邏輯
export const slashAsk = async (interaction, query, selectedModel) => {
    await interaction.deferReply();  // 告知 Discord 延遲回應

    selectedModel = modelKeys.includes(selectedModel) ? selectedModel : modelKeys[0];  // 檢查輸入選項合法性
    useModel = selectedModel;

    let aiReply = '', modelName = '', fallbackNotice = '', searchSummary = '';
    let content = query;
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const record = memoryManager.getMemory(userId);

    // 逾時主題檢查
    const timeoutThreshold = CONTEXT_TIMEOUT_MINUTES * 60 * 1000;
    if (Date.now() - record.lastInteraction > timeoutThreshold && record.context.length > 0) {
        // --- 逾時主題判斷 ---
        const recentQuestions = record.context.slice(-3).map(item => `Q：${item.q}`).join('\n');
        // 使用者的先前提問 / 目前輸入 / 這是否屬於相似主題？請僅回答「是」或「否」。
        const topicCheckPrompt = `User's previous questions:\n${recentQuestions}\n\nCurrent input: ${query}\n\nIs this topic similar? Reply with "Yes" or "No".`;

        try {
            const topicCheckResult = await askLLM(topicCheckPrompt, useModel);
            const isSameTopic = topicCheckResult?.trim().startsWith("Yes");

            if (!isSameTopic) {
                memoryManager.removeMessageOwner(userId);

                if (!memoryManager.removeUserFromGroup(userId)) {
                    record.context = memoryManager.cloneRecord().context;
                    record.summary = memoryManager.cloneRecord().summary;
                    memoryManager.setMemory(userId, record);
                }
                console.info(`[SET] ${userTag}>主題變更，清除記憶：`);
            }
        } catch (err) {
            console.warn(`[WARN] 主題判斷失敗：${err.message}`);
            // 為保險仍保留記憶
        }
    }

    // 網路搜尋提供參考
    if (content.startsWith('?') || content.startsWith('？')) {
        content = content.slice(1).trim();
        searchSummary = await searchGoogle(content);
    }

    // 組合上下文
    const fullPrompt = await composeFullPrompt(userId, content, searchSummary);

    // 詢問 LLM
    aiReply = await askLLM(fullPrompt, useModel);
    modelName = MODEL_OPTIONS[useModel].name;

    if (!aiReply) {
        await interaction.editReply("目前所有模型皆無回應，請稍後再試。");
        return;
    }
    if (useModel !== selectedModel) {
        fallbackNotice = `\`${MODEL_OPTIONS[selectedModel].name} 沒回應\``;
    }
    console.log(
        `[REPLY] ${userTag}> \`/ask\` ${content} - \`${MODEL_OPTIONS[selectedModel].name}\`` +
        (useModel !== selectedModel
            ? ` -> \`${MODEL_OPTIONS[useModel].name}\``
            : '')
    );

    // 儲存對話記憶並處理壓縮
    const newRound = { q: content, a: aiReply };
    const contextLength = record.context.length;
    if (contextLength >= 1) {
        const prevRound = record.context[contextLength - 1];  // 僅對倒數第 2 輪進行

        if (prevRound.q.length > COMPRESSION_TRIGGER_LENGTH) {
            prevRound.q = await compressTextWithLLM(prevRound.q, COMPRESSION_TARGET_TOKENS.threshold, useModel);
        }

        if (prevRound.a.length > COMPRESSION_TRIGGER_LENGTH) {
            prevRound.a = await compressTextWithLLM(prevRound.a, COMPRESSION_TARGET_TOKENS.threshold, useModel);
        }
    }

    // 推入最新對話
    record.context.push(newRound);

    // 檢查對話輪數並前情摘要化
    if (record.context.length > MAX_CONTEXT_ROUND) {
        const overflow = record.context.splice(0, SUMMARY_ROUND_COUNT);  // 取出前面的
        const mergedText = [
            record.summary,
            ...overflow.map(item => `User: ${item.q}\nYou: ${item.a}`)
        ].filter(Boolean).join("\n\n");

        const summaryResult = await compressTextWithLLM(mergedText, COMPRESSION_TARGET_TOKENS.merge, useModel);
        record.summary = summaryResult;
    }

    // 更新記憶
    memoryManager.setMemory(userId, record);

    // 記錄並格式化回覆
    const formattedReply = [
        `> ${searchSummary ? '🌐 ' : ''}${content} - <@${userId}>`,  // 原提問
        aiReply,         // 模型的回應內容
        fallbackNotice,  // 沒有回應的模型提示
        aiReply && `\`by ${modelName}\``  // 模型名稱
    ].filter(Boolean).join('\n');

    // 發送分段訊息
    const chunks = splitDiscordMessage(formattedReply, MAX_DISCORD_REPLY_LENGTH, userId);
    if (chunks.length > 0) {
        await interaction.editReply(chunks[0]);
        const currentEditReply = await interaction.fetchReply();
        memoryManager.setMessageOwner(currentEditReply.id, userId);
        for (let i = 1; i < chunks.length; i++) {
            const currentFollowUp = await interaction.followUp(chunks[i]);
            memoryManager.setMessageOwner(currentFollowUp.id, userId);
        }
    }
};

// ASK 加入或建立話題群組
export const replyAsk = async (message, messageId) => {
    const userId = message.author.id;
    const ownerId = memoryManager.getMessageOwner(messageId);
    const ownerGroup = memoryManager.getUserGroupId(ownerId);
    const content = message.content;

    // 檢查ownerId存在、messageId所屬身分非自己，或非同群組
    if (!ownerId || ownerId === userId || (ownerGroup && ownerGroup === memoryManager.getUserGroupId(userId))) return;

    // 加入或建立群組
    if (ownerGroup) {
        memoryManager.addUserToGroup(userId, ownerGroup);
    } else {
        const newGroup = memoryManager.addUserToGroup(ownerId);
        memoryManager.addUserToGroup(userId, newGroup);
    }

    // 回覆思考動畫
    const sentMessage = await message.reply("https://cdn.discordapp.com/attachments/876975982110703637/1368209561240080434/think.gif");
    
    let aiReply = '', modelName = '', searchSummary = '';

    // 網路搜尋提供參考
    if (content.startsWith('?') || content.startsWith('？')) {
        content = content.slice(1).trim();
        searchSummary = await searchGoogle(content);
    }

    // 組合上下文
    const fullPrompt = await composeFullPrompt(userId, content, searchSummary);

    // 詢問 LLM
    aiReply = await askLLM(fullPrompt, useModel);
    modelName = MODEL_OPTIONS[useModel].name;

    if (!aiReply) {
        await sentMessage.edit("目前所有模型皆無回應，請稍後再試。");
        return;
    }

    // 儲存對話記憶並處理壓縮
    const record = memoryManager.getMemory(userId);
    const newRound = { q: content, a: aiReply };
    const contextLength = record.context.length;
    if (contextLength >= 1) {
        const prevRound = record.context[contextLength - 1];  // 僅對倒數第 2 輪進行

        if (prevRound.q.length > COMPRESSION_TRIGGER_LENGTH) {
            prevRound.q = await compressTextWithLLM(prevRound.q, COMPRESSION_TARGET_TOKENS.threshold, useModel);
        }

        if (prevRound.a.length > COMPRESSION_TRIGGER_LENGTH) {
            prevRound.a = await compressTextWithLLM(prevRound.a, COMPRESSION_TARGET_TOKENS.threshold, useModel);
        }
    }

    // 推入最新對話
    record.context.push(newRound);

    // 更新記憶
    memoryManager.setMemory(userId, record);

    // 記錄並格式化回覆
    const formattedReply = [
        `${searchSummary ? '> 🌐 ' : ''}`,  // 搜尋符號
        aiReply,         // 模型的回應內容
        aiReply && `\`by ${modelName}\``  // 模型名稱
    ].filter(Boolean).join('\n');

    // 發送分段訊息
    const chunks = splitDiscordMessage(formattedReply, MAX_DISCORD_REPLY_LENGTH, userId);
    if (chunks.length > 0) {
        await sentMessage.edit(chunks[0]);
        memoryManager.setMessageOwner(sentMessage.id, userId);
        for (let i = 1; i < chunks.length; i++) {
            const currentFollowUp = await message.reply(chunks[i]);
            memoryManager.setMessageOwner(currentFollowUp.id, userId);
        }
    }
}

// 調試記憶體內容
export const replyMemory = async (interaction) => {
    await interaction.deferReply({ flags: 64 });  // 告知 Discord 延遲回應，且回應為隱藏
    let fullContent = '';

    // 遍歷所有使用者記憶
    memoryManager.userMemory.forEach((record, userId) => {
        fullContent += `
__UserId__: ${userId}
> Participants: ${Array.from(record.participants).join(', ') || ' -'}
> Preset: ${record.preset || ' -'}
> Summary: ${record.summary || ' -'}
> Context: ${record.context.length > 0 ? JSON.stringify(record.context, null, 2).split('\n').map(line => `> ${line}`).join('\n') : ' -'}
> Last Interaction: ${record.lastInteraction || ' -'}`
    });
    fullContent += '\n============\n';
    // 遍歷所有群組記憶
    memoryManager.groupMemory.forEach((groupRecord, groupId) => {
        fullContent += `
__GroupId__: ${groupId}
> Participants: ${Array.from(groupRecord.participants).join(', ') || ' -'}
> Summary: ${groupRecord.summary || ' -'}
> Context: ${groupRecord.context.length > 0 ? JSON.stringify(groupRecord.context, null, 2).split('\n').map(line => `> ${line}`).join('\n') : ' -'}
> Last Interaction: ${groupRecord.lastInteraction || ' -'}`
    });
    fullContent += '\n============\n';
    // 遍歷最後十筆對話目錄
    const last10 = Array.from(memoryManager.messageOwner.entries()).slice(-10); // 取最後10筆
    last10.forEach(([messageId, userId]) => {
        fullContent += `__MessageId__: \`${messageId}\` | __UserId__: \`${userId}\`\n`;
    });

    // 處理分段訊息
    const chunks = splitDiscordMessage(fullContent, MAX_DISCORD_REPLY_LENGTH);
    if (chunks.length > 0) {
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp(chunks[i]);
        }
    }
};

// 手動移轉所有權 - 測試用途
export const handleMsgOwner = async (content, replyFunc) => {
    const args = content.trim().split(/\s+/); // 切割空白

    if (args.length < 2) {
        return replyFunc("❌ 格式錯誤：請使用 `!msgOwner <msgId> [userId]`");
    }

    const msgId = args[1];
    const userId = args[2]; // 可選

    try {
        memoryManager.changeMessageOwner(msgId, userId);
        const msg = userId
            ? `✅ 已將 ${msgId} 的擁有者改為 ${userId}`
            : `✅ 已將 ${msgId} 的擁有者改為隨機用戶`;
        await replyFunc(msg);
    } catch (err) {
        console.error("changeMessageOwner 錯誤:", err);
        await replyFunc("❌ 發生錯誤，無法變更擁有者");
    }
};
//#endregion

//#region 子函式

// 遍歷可用模型並詢問 LLM
const askLLM = async (query, model) => {
    let triedModels = 0;  // 記錄嘗試過的模型數量
    let key = null;
    let answer = null;

    while (triedModels < modelKeys.length) {
        // 從選定模型往後開始循環
        key = modelKeys[(modelKeys.indexOf(model) + triedModels) % modelKeys.length];

        try {
            // 詢問 LLM
            answer = await MODEL_OPTIONS[key].handler(query, MODEL_OPTIONS[key]);
            if (typeof answer === 'string' && answer.trim()) {
                break;  // 找到有效回應後跳出循環
            } else {
                console.warn(`[WARN] \`${MODEL_OPTIONS[key].name}\`回應無效，嘗試下一個模型`);
            }
        } catch (err) {
            console.error(`[ERROR] 執行 ${MODEL_OPTIONS[key].name} 時發生錯誤:`, err);
        }

        triedModels++;
    }

    if (!answer) {
        console.error(`[ERROR] 模型皆無回應`);
        return null;
    }

    return answer;
}

// 搜尋網路參考
const searchGoogle = async (query) => {
    const endpoint = 'https://www.googleapis.com/customsearch/v1';
    const url = `${endpoint}?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_CSE_ID}&q=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            return '找不到相關的搜尋結果。';
        }

        // 取前 3 筆結果
        const summary = data.items.slice(0, 3).map((item, index) => {
            return `${index + 1}. ${item.title}\n${item.snippet}`;
        }).join('\n');

        // 限制搜尋結果篇幅
        return splitDiscordMessage(summary, MAX_SEARCH_SUMMARY_LENGTH)[0];
    } catch (error) {
        console.error('[ERROR] 搜尋時發生錯誤：', error);
        return '搜尋時發生錯誤，請稍後再試。';
    }
}

// 組合完整 prompt
const composeFullPrompt = async (userId, currentQuestion, searchSummary = "") => {
    const record = memoryManager.getMemory(userId);
    const { preset, context, summary } = record;

    // （你是一個 Discord 助理。簡潔地回應並遵循使用者的前提或指示。所有對話皆為你與使用者之間的互動。使用使用者的語言；若為中文則使用繁體中文。）
    const instruction = "(You are a Discord assistant. Respond concisely and follow the user's premise or instructions. All dialogue is between you and the user. Use the user's language; use Traditional Chinese if it's Chinese.)";
    const formattedSummary = summary ? `[Summary]\n${summary}` : "";
    const formattedContext = context.length > 0
        ? `[History]\n` +
        context.map(item => `User: ${item.q}\nYou: ${item.a}`).join("\n\n")
        : "";

    // 前提 + 前情摘要 + 上下文 + 搜尋結果 + 當前提問
    const fullPrompt = [
        instruction,
        preset && `[Premise]\n${preset}`,
        formattedSummary,
        formattedContext,
        searchSummary ? `[Search]\n(Use the search results below if helpful, but don't mention or refer to them.)\n${searchSummary}` : '',  // （如果下方的搜尋結果有幫助可以使用，但不要提及或引用它們。）
        `[User's Current Input]\nUser: ${currentQuestion}\n\n(Continue the conversation.)`  // （繼續對話）
    ].filter(Boolean).join("\n\n");

    if (process.env.DEBUG_FULLPROMPT === "true") {
        console.log(`[DEBUG] \`${userId}\`>組合上下文：\n${fullPrompt}`);
    }
    return fullPrompt;
};

// 摘要壓縮
const compressTextWithLLM = async (content, targetTokens, useModel) => {
    // 請將以下段落濃縮成不超過 / token 的摘要，保留關鍵資訊與主要邏輯脈絡
    const prompt = `Please condense the following paragraph into a summary of no more than ${targetTokens} tokens, retaining key information and the main logical flow:\n\n${content}`;
    return (await askLLM(prompt, useModel)) || '';
};

// 分段訊息
const splitDiscordMessage = (content, maxLength, userId = null) => {
    // 字數沒過不用處理
    if (content.length <= maxLength) return [content];

    const lines = content.split('\n');
    const chunks = [];
    let current = '';

    for (const line of lines) {
        if ((current + '\n' + line).length > maxLength) {
            chunks.push(current.trim());
            current = line;
        } else {
            current += '\n' + line;
        }
    }
    if (current.trim()) chunks.push(current.trim());

    // 第二段以後加註段落標記
    if (chunks.length > 1) {
        return chunks.map((chunk, idx) =>
            idx === 0
                ? chunk
                : `\`(第 ${idx + 1} 段 / 共 ${chunks.length} 段)\`${userId ? ` - <@${userId}>` : ''}\n${chunk}`
        );
    }
    return chunks;
};
//#endregion

//#region 模型實作

// 使用 Gemini 模型
async function askGemini(prompt, modelConfig) {
    const model = modelConfig.name;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ERROR] askGemini Error: ${response.status} ${response.statusText}\n${errorText}`);
        return '';  // 空回應
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return content;
}

// 使用 Openrouter 模型
async function askOpenrouter(prompt, modelConfig) {
    const model = modelConfig.name;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Title': 'DiscordBot'
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'user', content: prompt }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ERROR] askOpenrouter Error: ${response.status} ${response.statusText}\n${errorText}`);
        return '';  // 空回應
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
}
//#endregion