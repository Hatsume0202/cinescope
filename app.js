// CineScope - 电影字幕分析引擎

// 简单中文情感词典
const positiveWords = new Set([
    '爱','喜欢','开心','快乐','幸福','美好','棒','优秀','成功','胜利',
    '希望','温暖','感动','精彩','漂亮','聪明','勇敢','坚强','温柔','甜蜜',
    '兴奋','满足','骄傲','感激','信任','支持','鼓励','赞美','欢笑','拥抱',
    '重逢','团圆','梦想','自由','和平','光明','鲜花','阳光','微笑','加油'
]);
const negativeWords = new Set([
    '恨','讨厌','悲伤','痛苦','失望','绝望','失败','死亡','恐惧','愤怒',
    '孤独','寂寞','离别','失去','伤害','背叛','欺骗','打击','挫折','困难',
    '危险','黑暗','冷漠','残酷','无奈','遗憾','后悔','焦虑','压力','泪水'
]);

// SRT 解析器
function parseSRT(content) {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const subtitles = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].trim() === '') { i++; continue; }
        const index = parseInt(lines[i].trim());
        i++;
        if (i >= lines.length) break;
        const timeLine = lines[i].trim();
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
        if (!timeMatch) { i++; continue; }
        const start = timeMatch[1];
        const end = timeMatch[2];
        i++;
        const textLines = [];
        while (i < lines.length && lines[i].trim() !== '') {
            textLines.push(lines[i].trim());
            i++;
        }
        const text = textLines.join(' ');
        if (text) {
            subtitles.push({ index, start, end, text });
        }
        i++;
    }
    return subtitles;
}

function timeToSeconds(timeStr) {
    const [h, m, s] = timeStr.split(':');
    const [sec, ms] = s.split(',');
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec) + parseInt(ms) / 1000;
}

// 提取角色（通过冒号判断）
function extractCharacter(text) {
    const match = text.match(/^([^:]+):\s*(.+)$/);
    if (match) {
        return { char: match[1].trim(), dialog: match[2].trim() };
    }
    return { char: '未知角色', dialog: text };
}

// 情感分析
function analyzeSentiment(text) {
    let score = 0;
    for (const w of positiveWords) {
        if (text.includes(w)) score++;
    }
    for (const w of negativeWords) {
        if (text.includes(w)) score--;
    }
    return score;
}

// 分词（简单实现）
function segmentWords(text) {
    const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
    const words = [];
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (/[\u4e00-\u9fa5]/.test(ch)) {
            words.push(ch);
            if (i + 1 < clean.length && /[\u4e00-\u9fa5]/.test(clean[i+1])) {
                words.push(ch + clean[i+1]);
            }
        } else if (/[a-zA-Z0-9]/.test(ch)) {
            let w = ch;
            while (i+1 < clean.length && /[a-zA-Z0-9]/.test(clean[i+1])) {
                w += clean[++i];
            }
            words.push(w.toLowerCase());
        }
    }
    return words;
}

// 分析字幕数据
function analyzeSubtitles(subtitles) {
    const charStats = {};
    const sentimentTimeline = [];
    const wordFreq = {};
    let totalSentiment = 0;
    let prevTime = 0;
    const sceneGaps = [];
    
    subtitles.forEach((sub, idx) => {
        const startSec = timeToSeconds(sub.start);
        const endSec = timeToSeconds(sub.end);
        const { char, dialog } = extractCharacter(sub.text);
        
        // 角色统计
        if (!charStats[char]) charStats[char] = 0;
        charStats[char]++;
        
        // 情感
        const sent = analyzeSentiment(dialog);
        totalSentiment += sent;
        sentimentTimeline.push({
            time: startSec,
            sentiment: sent,
            text: dialog.substring(0, 30)
        });
        
        // 词频
        const words = segmentWords(dialog);
        words.forEach(w => {
            if (w.length < 2 && !/[\u4e00-\u9fa5]/.test(w)) return;
            if (!wordFreq[w]) wordFreq[w] = 0;
            wordFreq[w]++;
        });
        
        // 场景切换（时间间隔>15秒认为是场景切换）
        if (idx > 0) {
            const gap = startSec - prevTime;
            if (gap > 15) {
                sceneGaps.push({ time: startSec, gap });
            }
        }
        prevTime = endSec;
    });
    
    const sortedWords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
    
    return {
        totalLines: subtitles.length,
        charStats,
        sentimentTimeline,
        avgSentiment: (totalSentiment / subtitles.length).toFixed(2),
        wordFreq: sortedWords,
        sceneGaps,
        duration: subtitles.length > 0 ? timeToSeconds(subtitles[subtitles.length-1].end) : 0
    };
}

// 渲染图表
function renderCharts(data) {
    const ctxChar = document.getElementById('charChart').getContext('2d');
    const ctxSent = document.getElementById('sentimentChart').getContext('2d');
    const ctxScene = document.getElementById('sceneChart').getContext('2d');
    const ctxWord = document.getElementById('wordChart').getContext('2d');
    
    // 角色台词量
    const chars = Object.entries(data.charStats).sort((a,b) => b[1]-a[1]).slice(0, 8);
    new Chart(ctxChar, {
        type: 'bar',
        data: {
            labels: chars.map(x => x[0]),
            datasets: [{
                label: '台词数',
                data: chars.map(x => x[1]),
                backgroundColor: 'rgba(231, 76, 60, 0.7)',
                borderColor: '#e74c3c',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0b0' } },
                x: { ticks: { color: '#a0a0b0' } }
            }
        }
    });
    
    // 情感曲线（滑动平均）
    const windowSize = Math.max(3, Math.floor(data.sentimentTimeline.length / 20));
    const smoothSent = [];
    for (let i = 0; i < data.sentimentTimeline.length; i++) {
        let sum = 0, count = 0;
        for (let j = Math.max(0, i - windowSize); j <= Math.min(data.sentimentTimeline.length - 1, i + windowSize); j++) {
            sum += data.sentimentTimeline[j].sentiment;
            count++;
        }
        smoothSent.push({
            x: data.sentimentTimeline[i].time,
            y: sum / count
        });
    }
    
    new Chart(ctxSent, {
        type: 'line',
        data: {
            datasets: [{
                label: '情感得分',
                data: smoothSent,
                borderColor: '#f39c12',
                backgroundColor: 'rgba(243, 156, 18, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { type: 'linear', title: { display: true, text: '时间 (秒)', color: '#a0a0b0' }, ticks: { color: '#a0a0b0' } },
                y: { title: { display: true, text: '情感得分', color: '#a0a0b0' }, ticks: { color: '#a0a0b0' } }
            }
        }
    });
    
    // 场景切换
    const sceneBuckets = {};
    data.sceneGaps.forEach(g => {
        const min = Math.floor(g.time / 60);
        if (!sceneBuckets[min]) sceneBuckets[min] = 0;
        sceneBuckets[min]++;
    });
    const sceneLabels = Object.keys(sceneBuckets).sort((a,b) => parseInt(a)-parseInt(b));
    new Chart(ctxScene, {
        type: 'bar',
        data: {
            labels: sceneLabels.map(m => m+'min'),
            datasets: [{
                label: '场景切换次数',
                data: sceneLabels.map(m => sceneBuckets[m]),
                backgroundColor: 'rgba(155, 89, 182, 0.7)',
                borderColor: '#9b59b6',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a0a0b0' } },
                x: { ticks: { color: '#a0a0b0' } }
            }
        }
    });
    
    // 词频
    new Chart(ctxWord, {
        type: 'bar',
        data: {
            labels: data.wordFreq.map(x => x[0]),
            datasets: [{
                label: '出现次数',
                data: data.wordFreq.map(x => x[1]),
                backgroundColor: 'rgba(46, 204, 113, 0.7)',
                borderColor: '#2ecc71',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { color: '#a0a0b0' } },
                y: { ticks: { color: '#a0a0b0' } }
            }
        }
    });
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

function showResults(data) {
    document.getElementById('totalLines').textContent = data.totalLines;
    document.getElementById('charCount').textContent = Object.keys(data.charStats).length;
    document.getElementById('duration').textContent = formatDuration(data.duration);
    document.getElementById('avgSentiment').textContent = data.avgSentiment;
    
    const results = document.getElementById('results');
    results.classList.remove('hidden');
    
    // 销毁旧图表
    Chart.getChart('charChart')?.destroy();
    Chart.getChart('sentimentChart')?.destroy();
    Chart.getChart('sceneChart')?.destroy();
    Chart.getChart('wordChart')?.destroy();
    
    renderCharts(data);
    
    // 导出按钮
    document.getElementById('exportBtn').onclick = () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cinescope-report.json';
        a.click();
    };
}

// 生成模拟数据（给阿嬷的情书风格）
function generateDemoData() {
    const characters = ['阿嬷', '小明', '爸爸', '妈妈', '邻居阿姨', '老师'];
    const subtitles = [];
    let time = 0;
    const lines = [
        ['阿嬷', '小明啊，回来啦？快洗手吃饭。'],
        ['小明', '阿嬷，我今天考了第一名！'],
        ['阿嬷', '真的啊？我们家小明最棒了。'],
        ['爸爸', '妈，今天工作有点累。'],
        ['阿嬷', '辛苦啦，多吃点补补。'],
        ['妈妈', '小明，作业写完了吗？'],
        ['小明', '写完了，妈你看。'],
        ['邻居阿姨', '阿嬷，你家小明真懂事。'],
        ['阿嬷', '哪里哪里，调皮得很呢。'],
        ['老师', '小明这孩子很聪明，就是有点马虎。'],
        ['阿嬷', '老师您多费心，我们不会忘了您的恩情。'],
        ['小明', '阿嬷，我长大后要带你环游世界。'],
        ['阿嬷', '傻孩子，阿嬷哪也不去，就在这等你回家。'],
        ['爸爸', '妈，医生说您身体不太好...'],
        ['阿嬷', '没事没事，老毛病了。'],
        ['小明', '阿嬷你一定要好好的。'],
        ['阿嬷', '阿嬷还要看着你长大，看着你结婚呢。'],
        ['妈妈', '妈，您就听医生的，好好休息。'],
        ['阿嬷', '知道啦知道啦，你们这些孩子就是爱操心。'],
        ['小明', '阿嬷，我会一直陪着你的。']
    ];
    
    // 扩展更多数据
    const extendedLines = [];
    for (let i = 0; i < 60; i++) {
        const base = lines[i % lines.length];
        extendedLines.push([base[0], base[1] + (i > 20 && Math.random() > 0.7 ? '...' : '')]);
    }
    
    extendedLines.forEach((line, idx) => {
        const duration = 3 + Math.random() * 5;
        const start = formatTime(time);
        time += duration;
        const end = formatTime(time);
        time += 1 + Math.random() * 3; // 间隔
        
        subtitles.push({
            index: idx + 1,
            start: start,
            end: end,
            text: `${line[0]}: ${line[1]}`
        });
    });
    
    return subtitles.map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}\n`).join('\n');
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = '000';
    return `${h}:${m}:${s},${ms}`;
}

// 事件监听
document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const subs = parseSRT(ev.target.result);
        const data = analyzeSubtitles(subs);
        showResults(data);
    };
    reader.readAsText(file);
});

document.getElementById('dropZone').addEventListener('dragover', (e) => {
    e.preventDefault();
    e.currentTarget.style.borderColor = '#e74c3c';
});

document.getElementById('dropZone').addEventListener('dragleave', (e) => {
    e.currentTarget.style.borderColor = '';
});

document.getElementById('dropZone').addEventListener('drop', (e) => {
    e.preventDefault();
    e.currentTarget.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.srt')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const subs = parseSRT(ev.target.result);
            const data = analyzeSubtitles(subs);
            showResults(data);
        };
        reader.readAsText(file);
    }
});

document.getElementById('loadDemo').addEventListener('click', () => {
    const demoSRT = generateDemoData();
    const subs = parseSRT(demoSRT);
    const data = analyzeSubtitles(subs);
    showResults(data);
});
