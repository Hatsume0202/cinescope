/**
 * CineScope - Analysis Engine
 *
 * Processes parsed subtitle entries to extract:
 *   - Character dialogue statistics
 *   - Sentiment / emotion curves
 *   - Word frequency (for word cloud)
 *   - Scene change detection
 */

const CineScopeAnalyzer = (() => {
    'use strict';

    // ====================================================================
    // Chinese Sentiment Lexicon
    // ====================================================================

    const SENTIMENT_WORDS = {
        positive: [
            '爱', '喜欢', '幸福', '开心', '快乐', '温暖', '感动', '美好', '希望',
            '笑', '微笑', '美', '好', '想', '念', '感谢', '珍惜', '温柔', '甜蜜',
            '灿烂', '阳光', '浪漫', '幸运', '满足', '骄傲', '自豪', '期待', '相信',
            '努力', '勇敢', '坚强', '善良', '真诚', '可爱', '棒', '赞', '妙',
            '漂亮', '帅气', '高兴', '欢喜', '喜悦', '欣慰', '陶醉', '美满', '温馨',
            '亲切', '舒服', '顺利', '成功', '实现', '团圆', '相聚', '拥抱', '亲吻',
            '爱护', '呵护', '包容', '理解', '支持', '鼓励', '欢呼', '得意', '愉快',
            '享受', '轻松', '自在', '舒坦', '甜蜜蜜', '乐', '喜'
        ],
        negative: [
            '哭', '悲伤', '难过', '痛苦', '孤单', '寂寞', '遗憾', '后悔', '离别',
            '失去', '忘', '忘记', '冷漠', '伤害', '泪', '眼泪', '怕', '担心', '难',
            '苦', '恨', '痛', '黑暗', '孤独', '寂寞', '可怜', '悲惨', '伤心',
            '绝望', '失望', '焦虑', '恐惧', '害怕', '愤怒', '生气', '恨', '讨厌',
            '厌倦', '疲惫', '累', '辛酸', '苦涩', '悲', '哀', '愁', '忧', '闷',
            '烦', '恼', '怒', '怨', '责怪', '批评', '争吵', '吵架', '打架', '危险',
            '失败', '落', '弃', '病', '老', '死', '离别', '分离', '告别', '走',
            '离开', '消失', '再也不', '再不', '不能', '不行', '不可以', '艰难',
            '困难', '折磨', '煎熬', '忍受', '负担', '压力', '崩溃', '泪流满面'
        ]
    };

    // Build lookup maps
    const posSet = new Set(SENTIMENT_WORDS.positive);
    const negSet = new Set(SENTIMENT_WORDS.negative);

    // ====================================================================
    // Scene Detection Thresholds
    // ====================================================================

    /** Gap in ms above which we consider it a new scene */
    const SCENE_GAP_THRESHOLD_MS = 2000;   // 2 seconds
    /** Minimum scene duration in ms */
    const MIN_SCENE_MS = 5000;             // 5 seconds
    /** Keywords that strongly suggest a scene change */
    const SCENE_KEYWORDS = [
        '第二天', '第二天早上', '第二天上午', '第二天中午', '第二天下午', '第二天晚上',
        '次日', '次日清晨', '次日早上',
        '当晚', '这天晚上',
        '几个月后', '几年后', '多年后',
        '与此同时', '另一方面',
        '回忆', '回想', '记得', '那时候', '当时',
        '这时', '此时', '突然',
        '画面切换', '场景转换',
        '回到', '镜头',
        '第一章', '第二章', '第三章',
        '序幕', '尾声',
        '--', '——',
        '（闪回）', '(闪回)', '（回忆）', '(回忆)'
    ];

    // ====================================================================
    // Character name grouping (aliases)
    // ====================================================================

    /** Known name variants mapped to canonical names */
    const NAME_ALIASES = {
        // Extensible: map lowercased aliases to canonical names
    };

    // ====================================================================
    // Public API
    // ====================================================================

    /**
     * Run full analysis on parsed subtitle entries.
     * @param {SubtitleEntry[]} entries - Array from CineScopeParser.parse()
     * @returns {AnalysisResult}
     *
     * AnalysisResult: {
     *   summary: { totalEntries, totalWords, uniqueSpeakers, estimatedDuration, avgSentiment },
     *   characterStats: [{ name, count, words, percentage, sentiment }],
     *   timeline: [{ index, startMs, endMs, sentiment, cumulativeAvg, sceneLabel }],
     *   wordFrequency: [{ word, count }],
     *   scenes: [{ startMs, endMs, label, entryCount, durationMs }],
     *   emotionSeries: { positive: number[], negative: number[], neutral: number[], labels: string[] }
     * }
     */
    function analyze(entries) {
        if (!entries || entries.length === 0) {
            return buildEmptyResult();
        }

        const cleaned = entries.filter(e => e && e.text && e.text !== '(silence)' && e.text !== '(empty)');

        // --- Character Stats ---
        const characterStats = computeCharacterStats(cleaned);

        // --- Timeline with sentiment ---
        const timeline = computeTimeline(cleaned);

        // --- Word frequency ---
        const wordFrequency = computeWordFrequency(cleaned);

        // --- Scene detection ---
        const scenes = detectScenes(cleaned);

        // --- Emotion series for charts ---
        const emotionSeries = buildEmotionSeries(timeline);

        // --- Summary ---
        const totalWords = cleaned.reduce((sum, e) => sum + countWords(e.dialogue || e.text), 0);
        const avgSentiment = timeline.length > 0
            ? timeline.reduce((sum, t) => sum + t.sentiment, 0) / timeline.length
            : 0;
        const uniqueSpeakers = characterStats.length;
        const firstMs = cleaned[0].startMs;
        const lastMs = cleaned[cleaned.length - 1].endMs;
        const estimatedDuration = lastMs - firstMs;

        return {
            summary: {
                totalEntries: cleaned.length,
                totalWords,
                uniqueSpeakers,
                estimatedDuration,
                avgSentiment: Math.round(avgSentiment * 100) / 100
            },
            characterStats,
            timeline,
            wordFrequency,
            scenes,
            emotionSeries
        };
    }

    // ====================================================================
    // Character Statistics
    // ====================================================================

    function computeCharacterStats(entries) {
        const stats = {};
        const speakers = new Set();

        entries.forEach(e => {
            const speaker = e.speaker || '未知';
            speakers.add(speaker);
        });

        // Initialize all speakers
        speakers.forEach(name => {
            stats[name] = { name, count: 0, words: 0, sentiments: [] };
        });

        // Tally
        entries.forEach(e => {
            const speaker = e.speaker || '未知';
            if (!stats[speaker]) {
                stats[speaker] = { name: speaker, count: 0, words: 0, sentiments: [] };
            }
            stats[speaker].count++;
            const wordCount = countWords(e.dialogue || e.text);
            stats[speaker].words += wordCount;
            const sent = analyzeSentiment(e.dialogue || e.text);
            stats[speaker].sentiments.push(sent);
        });

        const total = entries.length;

        return Object.values(stats)
            .map(s => ({
                name: s.name,
                count: s.count,
                words: s.words,
                percentage: total > 0 ? Math.round((s.count / total) * 10000) / 100 : 0,
                avgSentiment: s.sentiments.length > 0
                    ? Math.round((s.sentiments.reduce((a, b) => a + b, 0) / s.sentiments.length) * 100) / 100
                    : 0
            }))
            .sort((a, b) => b.count - a.count);
    }

    // ====================================================================
    // Word Frequency (Chinese + English)
    // ====================================================================

    /** Chinese character-level + English word tokenizer */
    function tokenize(text) {
        if (!text) return [];

        const tokens = [];
        // English words
        const engWords = text.match(/[a-zA-Z]+(?:['-][a-zA-Z]+)?/g) || [];
        engWords.forEach(w => tokens.push(w.toLowerCase()));

        // Chinese characters (individual, or try bigrams)
        const chineseChars = text.match(/[一-鿿]/g) || [];
        tokens.push(...chineseChars);

        return tokens;
    }

    /** Common Chinese stop-words (function words) */
    const STOP_WORDS = new Set([
        '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
        '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
        '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '什么',
        '吗', '啊', '吧', '呢', '哦', '嗯', '啦', '呀', '喔', '嘿', '喂',
        '得', '地', '过', '把', '被', '让', '给', '对', '从', '向', '在',
        '与', '跟', '同', '比', '为', '以', '于', '由', '被', '将', '把',
        '但', '可', '却', '而', '而且', '或', '或者', '如果', '虽然', '因为',
        '所以', '然后', '那么', '这样', '那样', '怎么', '怎样', '几', '多么',
        '非常', '比较', '相当', '很', '太', '更', '最', '越', '稍', '略',
        '还', '已', '已经', '曾经', '刚', '刚刚', '才', '正', '正在', '将',
        '将', '要', '会', '可以', '可能', '应该', '必须', '需要', '一定',
        '来', '去', '进', '出', '回', '上', '下', '起', '过', '开', '关'
    ]);

    function isStopWord(word) {
        if (word.length === 1 && /[一-鿿]/.test(word)) {
            // Single Chinese character — filter common particles
            return STOP_WORDS.has(word);
        }
        return STOP_WORDS.has(word);
    }

    function computeWordFrequency(entries) {
        const freq = {};

        entries.forEach(entry => {
            const text = entry.dialogue || entry.text;
            const tokens = tokenize(text);

            tokens.forEach(token => {
                if (token.length === 0) return;
                if (isStopWord(token)) return;
                // Skip pure punctuation
                if (/^[^\w一-鿿]+$/.test(token)) return;

                freq[token] = (freq[token] || 0) + 1;
            });
        });

        return Object.entries(freq)
            .map(([word, count]) => ({ word, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 120);  // Top 120 for word cloud
    }

    // ====================================================================
    // Sentiment Analysis
    // ====================================================================

    /**
     * Score a text segment for sentiment.
     * Returns a value in [-1, 1]: negative = sad, positive = happy.
     */
    function analyzeSentiment(text) {
        if (!text) return 0;

        let score = 0;
        let matches = 0;

        // Check positive words
        posSet.forEach(word => {
            let idx = -1;
            while ((idx = text.indexOf(word, idx + 1)) !== -1) {
                score += 0.3;
                matches++;
            }
        });

        // Check negative words (weighted slightly higher for emotional impact)
        negSet.forEach(word => {
            let idx = -1;
            while ((idx = text.indexOf(word, idx + 1)) !== -1) {
                score -= 0.4;
                matches++;
            }
        });

        // Check for exclamation marks (positive emphasis)
        const exclaimCount = (text.match(/！/g) || []).length + (text.match(/!/g) || []).length;
        score += exclaimCount * 0.05;

        // Check for ellipsis / hesitance (negative)
        const ellipsisCount = (text.match(/…/g) || []).length + (text.match(/\.\.\./g) || []).length;
        score -= ellipsisCount * 0.1;

        // Check for question marks (neutral/curious)
        const questionCount = (text.match(/？/g) || []).length + (text.match(/\?/g) || []).length;
        score += questionCount * 0.02;

        // Emotion amplifiers: 很, 非常, 太, 好
        const amplifiers = (text.match(/很|非常|太|好/g) || []).length;
        score += amplifiers * 0.02;

        // Clamp to [-1, 1]
        if (matches > 0 || exclaimCount > 0 || ellipsisCount > 0) {
            // Scale the score
            const magnitude = Math.abs(score);
            if (magnitude > 1) {
                score = score / magnitude;
            }
        }

        return Math.max(-1, Math.min(1, Math.round(score * 100) / 100));
    }

    // ====================================================================
    // Timeline (sentiment over time)
    // ====================================================================

    function computeTimeline(entries) {
        let cumulativeSum = 0;

        return entries.map((entry, index) => {
            const sentiment = analyzeSentiment(entry.dialogue || entry.text);
            cumulativeSum += sentiment;

            return {
                index,
                id: entry.id,
                startMs: entry.startMs,
                endMs: entry.endMs,
                start: entry.start,
                end: entry.end,
                speaker: entry.speaker || '未知',
                text: (entry.dialogue || entry.text).slice(0, 40),
                sentiment,
                cumulativeAvg: Math.round((cumulativeSum / (index + 1)) * 100) / 100,
                sceneLabel: ''
            };
        });
    }

    // ====================================================================
    // Emotion Series (bucketed for charts)
    // ====================================================================

    function buildEmotionSeries(timeline) {
        if (timeline.length === 0) {
            return { positive: [], negative: [], neutral: [], labels: [] };
        }

        // Bucket into N segments
        const BUCKETS = Math.min(30, Math.max(8, Math.floor(timeline.length / 3)));
        const bucketSize = Math.ceil(timeline.length / BUCKETS);

        const positive = [];
        const negative = [];
        const neutral = [];
        const labels = [];

        for (let i = 0; i < timeline.length; i += bucketSize) {
            const bucket = timeline.slice(i, i + bucketSize);
            const posCount = bucket.filter(t => t.sentiment > 0.05).length;
            const negCount = bucket.filter(t => t.sentiment < -0.05).length;
            const neuCount = bucket.filter(t => t.sentiment >= -0.05 && t.sentiment <= 0.05).length;

            positive.push(posCount);
            negative.push(negCount);
            neutral.push(neuCount);

            const firstEntry = bucket[0];
            const lastEntry = bucket[bucket.length - 1];
            labels.push(`${formatTimeShort(firstEntry.startMs)}`);
        }

        return { positive, negative, neutral, labels };
    }

    function formatTimeShort(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${String(sec).padStart(2, '0')}`;
    }

    // ====================================================================
    // Scene Detection
    // ====================================================================

    function detectScenes(entries) {
        if (entries.length === 0) return [];

        const scenes = [];
        let currentStart = entries[0].startMs;
        let currentLabel = `场景 1`;
        let currentEntries = [entries[0]];
        let sceneNum = 1;

        for (let i = 1; i < entries.length; i++) {
            const prev = entries[i - 1];
            const curr = entries[i];
            const gap = curr.startMs - prev.endMs;

            // Check for scene keyword in text
            const text = (curr.dialogue || curr.text);
            const hasSceneKeyword = SCENE_KEYWORDS.some(kw => text.includes(kw));

            // Detect scene break
            if (gap > SCENE_GAP_THRESHOLD_MS || hasSceneKeyword) {
                // Finalize current scene
                const duration = currentEntries[currentEntries.length - 1].endMs - currentStart;
                scenes.push({
                    id: sceneNum,
                    startMs: currentStart,
                    endMs: currentEntries[currentEntries.length - 1].endMs,
                    label: currentLabel,
                    entryCount: currentEntries.length,
                    durationMs: Math.max(0, duration),
                    durationFormatted: msToTimeStr(duration)
                });

                // Start new scene
                sceneNum++;
                currentStart = curr.startMs;
                currentLabel = hasSceneKeyword
                    ? `场景 ${sceneNum}: "${text.slice(0, 20)}"`
                    : `场景 ${sceneNum}`;
                currentEntries = [curr];
            } else {
                currentEntries.push(curr);
            }
        }

        // Final scene
        if (currentEntries.length > 0) {
            const duration = currentEntries[currentEntries.length - 1].endMs - currentStart;
            scenes.push({
                id: sceneNum,
                startMs: currentStart,
                endMs: currentEntries[currentEntries.length - 1].endMs,
                label: currentLabel,
                entryCount: currentEntries.length,
                durationMs: Math.max(0, duration),
                durationFormatted: msToTimeStr(duration)
            });
        }

        return scenes;
    }

    function msToTimeStr(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}m ${String(sec).padStart(2, '0')}s`;
    }

    // ====================================================================
    // Helpers
    // ====================================================================

    function countWords(text) {
        if (!text) return 0;
        // Count Chinese characters + English words
        const chinese = (text.match(/[一-鿿]/g) || []).length;
        const english = (text.match(/[a-zA-Z]+/g) || []).length;
        const numbers = (text.match(/\d+/g) || []).length;
        return chinese + english + numbers;
    }

    function buildEmptyResult() {
        return {
            summary: {
                totalEntries: 0, totalWords: 0, uniqueSpeakers: 0,
                estimatedDuration: 0, avgSentiment: 0
            },
            characterStats: [],
            timeline: [],
            wordFrequency: [],
            scenes: [],
            emotionSeries: { positive: [], negative: [], neutral: [], labels: [] }
        };
    }

    // Expose for external use
    return {
        analyze,
        analyzeSentiment,
        tokenize,
        countWords,
        SENTIMENT_WORDS
    };
})();

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CineScopeAnalyzer;
}
