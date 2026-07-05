/**
 * CineScope - Main Application Logic
 *
 * Orchestrates: file upload → parse → analyze → render.
 * Handles drag-and-drop, sample data loading, UI state.
 */

const CineScopeApp = (() => {
    'use strict';

    // DOM refs (populated on init)
    let els = {};

    // Current state
    let state = {
        rawContent: null,
        fileName: null,
        entries: null,
        result: null,
        isAnalyzing: false
    };

    // ====================================================================
    // Initialization
    // ====================================================================

    function init() {
        // Cache DOM elements
        els = {
            uploadZone: document.getElementById('uploadZone'),
            fileInput: document.getElementById('fileInput'),
            uploadPrompt: document.getElementById('uploadPrompt'),
            fileInfo: document.getElementById('fileInfo'),
            fileName: document.getElementById('fileName'),
            fileSize: document.getElementById('fileSize'),
            btnAnalyze: document.getElementById('btnAnalyze'),
            btnSample: document.getElementById('btnSample'),
            btnReset: document.getElementById('btnReset'),
            analysisSection: document.getElementById('analysisSection'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            toast: document.getElementById('toast'),
            // Stats
            statEntries: document.getElementById('statEntries'),
            statWords: document.getElementById('statWords'),
            statSpeakers: document.getElementById('statSpeakers'),
            statSentiment: document.getElementById('statSentiment'),
            statScenes: document.getElementById('statScenes'),
            statDuration: document.getElementById('statDuration')
        };

        // Bind events
        bindEvents();

        // Apply Chart.js dark theme
        if (typeof CineScopeCharts !== 'undefined') {
            CineScopeCharts.applyDarkTheme();
        }

        console.log('CineScope initialized.');
    }

    // ====================================================================
    // Event Binding
    // ====================================================================

    function bindEvents() {
        // Drag-and-drop
        els.uploadZone.addEventListener('dragover', onDragOver);
        els.uploadZone.addEventListener('dragleave', onDragLeave);
        els.uploadZone.addEventListener('drop', onDrop);

        // File input
        els.fileInput.addEventListener('change', onFileSelected);
        els.uploadZone.querySelector('.browse-link').addEventListener('click', (e) => {
            e.stopPropagation();
            els.fileInput.click();
        });
        els.uploadZone.addEventListener('click', (e) => {
            if (e.target === els.uploadZone || e.target.closest('.upload-zone') && !e.target.closest('.btn')) {
                els.fileInput.click();
            }
        });

        // Buttons
        els.btnAnalyze.addEventListener('click', onAnalyze);
        els.btnSample.addEventListener('click', onLoadSample);
        els.btnReset.addEventListener('click', onReset);

        // Window resize for word cloud
        window.addEventListener('resize', () => {
            if (state.result && state.result.wordFrequency) {
                CineScopeCharts.handleResize(state.result.wordFrequency);
            }
        });
    }

    // ====================================================================
    // Drag & Drop Handlers
    // ====================================================================

    function onDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        els.uploadZone.classList.add('drag-over');
    }

    function onDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        els.uploadZone.classList.remove('drag-over');
    }

    function onDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        els.uploadZone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (isSrtFile(file)) {
                readFile(file);
            } else {
                showToast('请上传 .srt 格式的字幕文件。', 'error');
            }
        }
    }

    // ====================================================================
    // File Selection
    // ====================================================================

    function onFileSelected(e) {
        const file = e.target.files[0];
        if (file) {
            readFile(file);
        }
    }

    function isSrtFile(file) {
        return file.name.toLowerCase().endsWith('.srt') || file.type === 'text/plain' || file.type === '';
    }

    function readFile(file) {
        const reader = new FileReader();

        reader.onload = (e) => {
            const content = e.target.result;
            setFileContent(content, file.name, file.size);
        };

        reader.onerror = () => {
            showToast('读取文件时出错，请重试。', 'error');
        };

        reader.readAsText(file, 'UTF-8');
    }

    function setFileContent(content, fileName, fileSize) {
        state.rawContent = content;
        state.fileName = fileName;

        // Update UI
        els.uploadPrompt.style.display = 'none';
        els.fileInfo.style.display = 'flex';
        els.fileName.textContent = fileName;
        els.fileSize.textContent = formatFileSize(fileSize);
        els.uploadZone.classList.add('has-file');

        // Enable analyse button
        els.btnAnalyze.disabled = false;

        showToast(`已加载 "${fileName}"`, 'success');
    }

    // ====================================================================
    // Sample Data
    // ====================================================================

    function onLoadSample() {
        showToast('正在加载示例数据...', 'success');

        fetch('data/sample.srt')
            .then(res => {
                if (!res.ok) throw new Error('示例文件加载失败');
                return res.text();
            })
            .then(content => {
                setFileContent(content, 'sample.srt', content.length);
                // Auto-analyze after a brief delay
                setTimeout(() => onAnalyze(), 400);
            })
            .catch(err => {
                showToast('加载示例数据失败: ' + err.message, 'error');
            });
    }

    // ====================================================================
    // Analyze
    // ====================================================================

    function onAnalyze() {
        if (state.isAnalyzing) return;
        if (!state.rawContent) {
            showToast('请先上传字幕文件。', 'error');
            return;
        }

        state.isAnalyzing = true;
        els.btnAnalyze.disabled = true;
        els.loadingOverlay.classList.add('active');

        // Use requestAnimationFrame + setTimeout to let UI breathe
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    runAnalysis();
                } catch (err) {
                    console.error('Analysis error:', err);
                    showToast('分析过程出错: ' + err.message, 'error');
                }
                state.isAnalyzing = false;
                els.btnAnalyze.disabled = false;
                els.loadingOverlay.classList.remove('active');
            }, 50);
        });
    }

    function runAnalysis() {
        // 1. Parse
        const parsed = CineScopeParser.parse(state.rawContent);
        if (parsed.errors.length > 0) {
            console.warn('Parse warnings:', parsed.errors);
        }

        if (parsed.entries.length === 0) {
            showToast('未解析到有效字幕条目，请检查文件格式。', 'error');
            return;
        }

        // 2. Infer missing speakers
        const entries = CineScopeParser.inferSpeakers(parsed.entries);
        state.entries = entries;

        console.log(`Parsed ${entries.length} subtitle entries, ${parsed.errors.length} warnings`);

        // 3. Analyze
        const result = CineScopeAnalyzer.analyze(entries);
        state.result = result;

        console.log('Analysis complete:', result.summary);

        // 4. Update stats overview
        updateStats(result);

        // 5. Render all charts
        CineScopeCharts.renderAll(result);

        // 6. Show analysis section
        els.analysisSection.classList.add('visible');
        els.analysisSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        showToast(
            `分析完成！共 ${result.summary.totalEntries} 条字幕，` +
            `${result.summary.uniqueSpeakers} 个角色，` +
            `${result.scenes.length} 个场景`,
            'success'
        );
    }

    // ====================================================================
    // Stats Overview
    // ====================================================================

    function updateStats(result) {
        const s = result.summary;

        els.statEntries.textContent = s.totalEntries;
        els.statWords.textContent = s.totalWords;
        els.statSpeakers.textContent = s.uniqueSpeakers;
        els.statScenes.textContent = result.scenes.length;

        // Sentiment
        const avgSent = s.avgSentiment;
        const sentLabel = avgSent > 0.05 ? '😊 偏正面'
            : avgSent < -0.05 ? '😢 偏负面'
            : '😐 中性';
        els.statSentiment.textContent = sentLabel;
        els.statSentiment.style.color = avgSent > 0.05 ? 'var(--positive)'
            : avgSent < -0.05 ? 'var(--negative)'
            : 'var(--neutral)';

        // Duration
        const durSec = Math.round(s.estimatedDuration / 1000);
        const durMin = Math.floor(durSec / 60);
        const durSecRem = durSec % 60;
        els.statDuration.textContent = `${durMin}分${durSecRem}秒`;
    }

    // ====================================================================
    // Reset
    // ====================================================================

    function onReset() {
        // Destroy charts
        CineScopeCharts.destroyAll();

        // Reset state
        state = {
            rawContent: null,
            fileName: null,
            entries: null,
            result: null,
            isAnalyzing: false
        };

        // Reset UI
        els.uploadPrompt.style.display = 'block';
        els.fileInfo.style.display = 'none';
        els.uploadZone.classList.remove('has-file');
        els.btnAnalyze.disabled = true;
        els.analysisSection.classList.remove('visible');
        els.fileInput.value = '';

        // Clear word cloud canvas
        const wcCanvas = document.getElementById('wordCloudCanvas');
        if (wcCanvas) {
            const ctx = wcCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, wcCanvas.width, wcCanvas.height);
            }
        }

        showToast('已重置', 'success');
    }

    // ====================================================================
    // Toast
    // ====================================================================

    let _toastTimer = null;

    function showToast(message, type) {
        if (!els.toast) return;

        if (_toastTimer) {
            clearTimeout(_toastTimer);
            els.toast.classList.remove('show');
        }

        els.toast.textContent = message;
        els.toast.className = 'toast';
        if (type) {
            els.toast.classList.add(type);
        }

        // Trigger reflow
        void els.toast.offsetWidth;

        els.toast.classList.add('show');

        _toastTimer = setTimeout(() => {
            els.toast.classList.remove('show');
        }, 4000);
    }

    // ====================================================================
    // Utility
    // ====================================================================

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ====================================================================
    // Bootstrap
    // ====================================================================

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public (for debugging / external access)
    return {
        init,
        onLoadSample,
        state: () => ({ ...state })
    };
})();
