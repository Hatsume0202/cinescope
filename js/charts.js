/**
 * CineScope - Chart Renderer
 *
 * Wraps Chart.js for the four chart groups and implements
 * a Canvas-based word cloud with spiral collision detection.
 *
 * Chart groups:
 *   1. Character dialogue — Bar chart + Pie chart
 *   2. Emotion — Line chart + Stacked area chart
 *   3. Word cloud — Canvas-based
 *   4. Scene changes — Bar chart
 */

const CineScopeCharts = (() => {
    'use strict';

    // Holds active Chart.js instances for cleanup
    let _chartInstances = {};

    // ====================================================================
    // Global Chart.js defaults — dark cinema theme
    // ====================================================================

    function applyDarkTheme() {
        if (typeof Chart === 'undefined') return;

        Chart.defaults.color = '#9898b0';
        Chart.defaults.borderColor = 'rgba(42, 42, 64, 0.6)';
        Chart.defaults.font.family = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.tooltip.backgroundColor = '#1a1a28';
        Chart.defaults.plugins.tooltip.titleColor = '#e8e8ee';
        Chart.defaults.plugins.tooltip.bodyColor = '#c8c8d8';
        Chart.defaults.plugins.tooltip.borderColor = 'rgba(212, 167, 71, 0.3)';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.cornerRadius = 6;
        Chart.defaults.plugins.tooltip.padding = 10;
    }

    // ====================================================================
    // Color Palette
    // ====================================================================

    const COLORS = {
        gold: '#d4a747',
        goldLight: '#e8c46a',
        goldDim: '#a88330',
        blue: '#60a5fa',
        cyan: '#22d3ee',
        green: '#4ade80',
        red: '#f87171',
        purple: '#c084fc',
        pink: '#f472b6',
        orange: '#fb923c',
        teal: '#2dd4bf',
        // Extended palette for multi-character charts
        palette: [
            '#d4a747', '#60a5fa', '#4ade80', '#f87171', '#c084fc',
            '#f472b6', '#fb923c', '#22d3ee', '#a78bfa', '#34d399',
            '#fbbf24', '#f97316', '#818cf8', '#2dd4bf', '#e879f9'
        ],
        sentiment: {
            positive: '#4ade80',
            negative: '#f87171',
            neutral: '#60a5fa'
        }
    };

    // ====================================================================
    // Chart Cleanup
    // ====================================================================

    function destroyAll() {
        Object.values(_chartInstances).forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
        _chartInstances = {};
    }

    function register(key, chart) {
        if (_chartInstances[key] && typeof _chartInstances[key].destroy === 'function') {
            _chartInstances[key].destroy();
        }
        _chartInstances[key] = chart;
        return chart;
    }

    // ====================================================================
    // 1. Character Dialogue Charts
    // ====================================================================

    /**
     * Render character dialogue bar chart + pie chart.
     * @param {string} barCanvasId
     * @param {string} pieCanvasId
     * @param {{ name: string, count: number, words: number, percentage: number }[]} stats
     */
    function renderDialogueCharts(barCanvasId, pieCanvasId, stats) {
        if (!stats || stats.length === 0) return;

        const names = stats.map(s => s.name);
        const counts = stats.map(s => s.count);
        const percentages = stats.map(s => s.percentage);

        // --- Horizontal Bar Chart ---
        const barCtx = document.getElementById(barCanvasId);
        if (barCtx) {
            const barChart = new Chart(barCtx, {
                type: 'bar',
                data: {
                    labels: names,
                    datasets: [{
                        label: '台词条数',
                        data: counts,
                        backgroundColor: stats.map((_, i) => COLORS.palette[i % COLORS.palette.length] + 'CC'),
                        borderColor: stats.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: 0.6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                afterLabel: function(context) {
                                    const i = context.dataIndex;
                                    return `占比: ${percentages[i]}% | 字数: ${stats[i].words}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(42, 42, 64, 0.4)'
                            },
                            ticks: {
                                stepSize: 1
                            }
                        },
                        y: {
                            grid: { display: false },
                            ticks: {
                                font: { size: 12 }
                            }
                        }
                    }
                }
            });
            register('dialogueBar', barChart);
        }

        // --- Pie Chart ---
        const pieCtx = document.getElementById(pieCanvasId);
        if (pieCtx) {
            const pieChart = new Chart(pieCtx, {
                type: 'doughnut',
                data: {
                    labels: names.map((n, i) => `${n} (${percentages[i]}%)`),
                    datasets: [{
                        data: counts,
                        backgroundColor: stats.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
                        borderColor: '#12121a',
                        borderWidth: 2,
                        hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    cutout: '55%',
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                padding: 12,
                                usePointStyle: true,
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const i = context.dataIndex;
                                    return ` ${names[i]}: ${counts[i]} 条 (${percentages[i]}%)`;
                                }
                            }
                        }
                    }
                }
            });
            register('dialoguePie', pieChart);
        }
    }

    // ====================================================================
    // 2. Emotion Charts
    // ====================================================================

    /**
     * Render emotion line chart + stacked area chart.
     * @param {string} lineCanvasId
     * @param {string} areaCanvasId
     * @param {object} emotionSeries - { positive: number[], negative: number[], neutral: number[], labels: string[] }
     */
    function renderEmotionCharts(lineCanvasId, areaCanvasId, emotionSeries, timeline) {
        if (!emotionSeries || !timeline || timeline.length === 0) return;

        const labels = emotionSeries.labels || [];

        // --- Line Chart (sentiment value per subtitle) ---
        const lineCtx = document.getElementById(lineCanvasId);
        if (lineCtx) {
            // Downsample if too many points
            const maxPoints = 80;
            let displayTimeline = timeline;
            let displayLabels = timeline.map(t => formatTimeMs(t.startMs));

            if (timeline.length > maxPoints) {
                const step = Math.ceil(timeline.length / maxPoints);
                displayTimeline = timeline.filter((_, i) => i % step === 0);
                displayLabels = displayTimeline.map(t => formatTimeMs(t.startMs));
            }

            const lineChart = new Chart(lineCtx, {
                type: 'line',
                data: {
                    labels: displayLabels,
                    datasets: [
                        {
                            label: '情感值',
                            data: displayTimeline.map(t => t.sentiment),
                            borderColor: COLORS.gold,
                            backgroundColor: 'rgba(212, 167, 71, 0.1)',
                            borderWidth: 2,
                            pointRadius: 2,
                            pointHoverRadius: 5,
                            pointBackgroundColor: COLORS.gold,
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: '累积平均',
                            data: displayTimeline.map(t => t.cumulativeAvg),
                            borderColor: COLORS.cyan,
                            backgroundColor: 'transparent',
                            borderWidth: 1.5,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            pointHoverRadius: 3,
                            fill: false,
                            tension: 0.4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                afterTitle: function(items) {
                                    const i = items[0]?.dataIndex;
                                    if (i !== undefined && displayTimeline[i]) {
                                        const t = displayTimeline[i];
                                        return `${t.speaker}: ${t.text}`;
                                    }
                                    return '';
                                }
                            }
                        },
                        // Zero line annotation via custom plugin
                    },
                    scales: {
                        x: {
                            display: labels.length <= 30,
                            grid: { color: 'rgba(42, 42, 64, 0.3)' },
                            ticks: {
                                maxTicksLimit: 20,
                                font: { size: 9 }
                            }
                        },
                        y: {
                            min: -1,
                            max: 1,
                            grid: {
                                color: (ctx) => ctx.tick.value === 0
                                    ? 'rgba(212, 167, 71, 0.3)'
                                    : 'rgba(42, 42, 64, 0.3)'
                            },
                            ticks: {
                                stepSize: 0.25,
                                callback: function(value) {
                                    if (value === 0) return '0 中性';
                                    if (value > 0) return `+${value}`;
                                    return String(value);
                                }
                            }
                        }
                    }
                },
                plugins: [{
                    id: 'zeroLine',
                    beforeDraw: function(chart) {
                        // Already handled by grid color callback above
                    }
                }]
            });
            register('emotionLine', lineChart);
        }

        // --- Stacked Area Chart ---
        const areaCtx = document.getElementById(areaCanvasId);
        if (areaCtx) {
            const areaChart = new Chart(areaCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '正面',
                            data: emotionSeries.positive,
                            borderColor: COLORS.sentiment.positive,
                            backgroundColor: 'rgba(74, 222, 128, 0.5)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1,
                            pointHoverRadius: 4
                        },
                        {
                            label: '中性',
                            data: emotionSeries.neutral,
                            borderColor: COLORS.sentiment.neutral,
                            backgroundColor: 'rgba(96, 165, 250, 0.4)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1,
                            pointHoverRadius: 4
                        },
                        {
                            label: '负面',
                            data: emotionSeries.negative,
                            borderColor: COLORS.sentiment.negative,
                            backgroundColor: 'rgba(248, 113, 113, 0.5)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 1,
                            pointHoverRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                font: { size: 11 }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(42, 42, 64, 0.3)' },
                            ticks: {
                                maxTicksLimit: 15,
                                font: { size: 9 }
                            }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(42, 42, 64, 0.3)' },
                            ticks: {
                                stepSize: 1,
                                precision: 0
                            }
                        }
                    }
                }
            });
            register('emotionArea', areaChart);
        }
    }

    // ====================================================================
    // 3. Canvas Word Cloud
    // ====================================================================

    /**
     * Render a word cloud on an HTML Canvas using spiral placement.
     * @param {string} canvasId
     * @param {{ word: string, count: number }[]} words - sorted desc by count
     */
    function renderWordCloud(canvasId, words) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !words || words.length === 0) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // Size canvas
        const rect = canvas.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#12121a';
        ctx.fillRect(0, 0, width, height);

        const maxCount = words[0]?.count || 1;
        const minCount = words[words.length - 1]?.count || 1;

        // Filter to top 80 for performance
        const displayWords = words.slice(0, 80);

        // Prepare word objects with size
        const minFont = 12;
        const maxFont = 52;
        const wordObjects = displayWords.map((w, i) => {
            const ratio = (w.count - minCount) / Math.max(maxCount - minCount, 1);
            const fontSize = minFont + ratio * (maxFont - minFont);
            // Add some variety via random small offset
            const colorIndex = i % COLORS.palette.length;
            return {
                word: w.word,
                count: w.count,
                fontSize: Math.round(fontSize),
                color: COLORS.palette[colorIndex],
                opacity: 0.6 + ratio * 0.4,
                placed: false,
                x: 0,
                y: 0,
                rot: 0  // 0 or 90 degrees
            };
        });

        // Sort by size descending (place largest first)
        wordObjects.sort((a, b) => b.fontSize - a.fontSize);

        // Font measurement cache
        function measure(wordObj) {
            ctx.font = `${wordObj.fontSize}px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
            const metrics = ctx.measureText(wordObj.word);
            return {
                width: metrics.width,
                height: wordObj.fontSize * 1.2
            };
        }

        // Collision detection
        function collides(x, y, w, h, placedWords) {
            const margin = 4;
            for (const pw of placedWords) {
                if (!pw.placed) continue;
                // AABB collision with margin
                if (x < pw.x + pw.drawWidth + margin &&
                    x + w + margin > pw.x &&
                    y < pw.y + pw.drawHeight + margin &&
                    y + h + margin > pw.y) {
                    return true;
                }
            }
            return false;
        }

        // Place each word using Archimedean spiral
        const placed = [];

        for (const wo of wordObjects) {
            const m = measure(wo);

            // Randomly rotate some words
            let rot = 0;
            if (wo.fontSize > 20 && Math.random() < 0.25) {
                rot = -Math.PI / 2; // 90 deg counter-clockwise
            }

            let drawWidth, drawHeight;
            if (rot === 0) {
                drawWidth = m.width;
                drawHeight = m.height;
            } else {
                drawWidth = m.height;
                drawHeight = m.width;
            }

            // Spiral placement
            const cx = width / 2;
            const cy = height / 2;
            let placed = false;

            for (let theta = 0; theta < Math.PI * 12; theta += 0.08) {
                const radius = 2.5 * theta;
                const x = cx + radius * Math.cos(theta) - drawWidth / 2;
                const y = cy + radius * Math.sin(theta) - drawHeight / 2;

                // Bounds check
                if (x < 5 || y < 5 || x + drawWidth > width - 5 || y + drawHeight > height - 5) {
                    continue;
                }

                if (!collides(x, y, drawWidth, drawHeight, placed)) {
                    wo.x = x;
                    wo.y = y;
                    wo.rot = rot;
                    wo.drawWidth = drawWidth;
                    wo.drawHeight = drawHeight;
                    wo.placed = true;
                    placed.push(wo);
                    break;
                }
            }

            // If spiral failed, try slightly overlapping (accept collision near edges as a fallback)
            if (!wo.placed) {
                for (let attempt = 0; attempt < 5; attempt++) {
                    const x = 10 + Math.random() * (width - 20 - drawWidth);
                    const y = 10 + Math.random() * (height - 20 - drawHeight);
                    if (!collides(x, y, drawWidth, drawHeight, placed)) {
                        wo.x = x;
                        wo.y = y;
                        wo.rot = rot;
                        wo.drawWidth = drawWidth;
                        wo.drawHeight = drawHeight;
                        wo.placed = true;
                        placed.push(wo);
                        break;
                    }
                }
            }
        }

        // Draw all placed words
        for (const wo of placed) {
            if (!wo.placed) continue;

            ctx.save();
            ctx.translate(wo.x + (wo.drawWidth || 0) / 2, wo.y + (wo.drawHeight || 0) / 2);
            ctx.rotate(wo.rot);

            ctx.font = `${wo.fontSize}px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = wo.opacity;

            // Shadow for readability
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 2;

            ctx.fillStyle = wo.color;
            ctx.fillText(wo.word, 0, 0);

            ctx.restore();
        }

        // If no words placed at all, show message
        if (placed.length === 0) {
            ctx.fillStyle = '#606078';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('暂无足够的词频数据', width / 2, height / 2);
        }
    }

    // ====================================================================
    // 4. Scene Change Bar Chart
    // ====================================================================

    /**
     * Render scene change frequency bar chart.
     * @param {string} canvasId
     * @param {{ id: number, label: string, entryCount: number, durationMs: number }[]} scenes
     */
    function renderSceneChart(canvasId, scenes) {
        if (!scenes || scenes.length === 0) return;

        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        const labels = scenes.map(s => `场景 ${s.id}`);
        const entryCounts = scenes.map(s => s.entryCount);
        const durations = scenes.map(s => Math.round(s.durationMs / 1000)); // seconds

        const sceneChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: '台词条数',
                        data: entryCounts,
                        backgroundColor: scenes.map((_, i) => COLORS.palette[i % COLORS.palette.length] + 'BB'),
                        borderColor: scenes.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
                        borderWidth: 1,
                        borderRadius: 3,
                        order: 1
                    },
                    {
                        label: '时长(秒)',
                        data: durations,
                        type: 'line',
                        borderColor: COLORS.goldLight,
                        backgroundColor: COLORS.goldLight,
                        pointBackgroundColor: COLORS.goldLight,
                        pointBorderColor: '#12121a',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        borderWidth: 2,
                        tension: 0.3,
                        yAxisID: 'y1',
                        order: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function(items) {
                                const i = items[0]?.dataIndex;
                                if (i !== undefined && scenes[i]) {
                                    return `场景: ${scenes[i].label}`;
                                }
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(42, 42, 64, 0.3)' },
                        ticks: {
                            maxTicksLimit: 25,
                            font: { size: 9 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        grid: { color: 'rgba(42, 42, 64, 0.3)' },
                        title: {
                            display: true,
                            text: '台词条数',
                            color: '#9898b0'
                        },
                        ticks: {
                            stepSize: 1,
                            precision: 0
                        }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: { display: false },
                        title: {
                            display: true,
                            text: '时长 (秒)',
                            color: '#9898b0'
                        }
                    }
                }
            }
        });

        register('sceneChart', sceneChart);
    }

    // ====================================================================
    // Full Render
    // ====================================================================

    /**
     * Render all charts from an analysis result.
     * @param {AnalysisResult} result
     */
    function renderAll(result) {
        if (!result) return;

        applyDarkTheme();
        destroyAll();

        // 1. Character dialogue
        if (result.characterStats && result.characterStats.length > 0) {
            renderDialogueCharts('dialogueBarChart', 'dialoguePieChart', result.characterStats);
        }

        // 2. Emotion
        if (result.timeline && result.timeline.length > 0) {
            renderEmotionCharts('emotionLineChart', 'emotionAreaChart', result.emotionSeries, result.timeline);
        }

        // 3. Word cloud (delay slightly to ensure layout is settled)
        if (result.wordFrequency && result.wordFrequency.length > 0) {
            setTimeout(() => {
                renderWordCloud('wordCloudCanvas', result.wordFrequency);
            }, 100);
        }

        // 4. Scene chart
        if (result.scenes && result.scenes.length > 0) {
            renderSceneChart('sceneChart', result.scenes);
        }
    }

    // ====================================================================
    // Helpers
    // ====================================================================

    function formatTimeMs(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${String(sec).padStart(2, '0')}`;
    }

    // Handle window resize for word cloud
    let _resizeTimeout = null;
    let _lastWords = null;

    function handleResize(words) {
        if (_resizeTimeout) clearTimeout(_resizeTimeout);
        _lastWords = words;
        _resizeTimeout = setTimeout(() => {
            if (_lastWords) {
                renderWordCloud('wordCloudCanvas', _lastWords);
            }
        }, 300);
    }

    // ====================================================================
    // Public API
    // ====================================================================

    return {
        renderAll,
        renderDialogueCharts,
        renderEmotionCharts,
        renderWordCloud,
        renderSceneChart,
        destroyAll,
        handleResize,
        applyDarkTheme
    };
})();
