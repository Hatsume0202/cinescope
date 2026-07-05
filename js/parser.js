/**
 * CineScope - SRT Subtitle Parser
 *
 * Parses .srt files into structured subtitle entries with
 * automatic speaker detection via "NAME: dialogue" prefix.
 */

const CineScopeParser = (() => {
    'use strict';

    /**
     * Parse a raw .srt string into an array of subtitle entries.
     * @param {string} raw - The full text content of an .srt file
     * @returns {{ entries: SubtitleEntry[], errors: string[] }}
     *
     * SubtitleEntry: {
     *   id: number,
     *   startMs: number,
     *   endMs: number,
     *   start: string,    // "HH:MM:SS,mmm"
     *   end: string,      // "HH:MM:SS,mmm"
     *   text: string,     // raw text (multi-line joined)
     *   speaker: string|null,  // detected speaker name
     *   dialogue: string  // text without speaker prefix
     * }
     */
    function parse(raw) {
        if (!raw || typeof raw !== 'string') {
            return { entries: [], errors: ['No subtitle data provided.'] };
        }

        const errors = [];
        const blocks = raw
            .replace(/\r\n/g, '\n')
            .replace(/﻿/g, '')       // strip BOM
            .split(/\n\n+/)
            .map(b => b.trim())
            .filter(b => b.length > 0);

        const entries = [];

        for (let i = 0; i < blocks.length; i++) {
            try {
                const entry = parseBlock(blocks[i], i + 1);
                if (entry) {
                    entries.push(entry);
                }
            } catch (e) {
                errors.push(`Block #${i + 1}: ${e.message}`);
            }
        }

        return { entries, errors };
    }

    /**
     * Parse one SRT block.
     * Block format:
     *   1
     *   00:00:01,000 --> 00:00:04,000
     *   Speaker: dialogue text
     */
    function parseBlock(block, blockNum) {
        const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length < 2) {
            throw new Error('Block too short (need index + timestamp).');
        }

        // Line 1: numeric index (optional — some files omit it)
        let idx = 1;
        let timeLine = lines[0];
        let textStart = 1;

        if (/^\d+$/.test(lines[0])) {
            idx = parseInt(lines[0], 10);
            timeLine = lines[1];
            textStart = 2;
        }

        if (textStart > lines.length) {
            throw new Error('Missing timestamp line.');
        }

        // Parse timestamp: 00:00:01,000 --> 00:00:04,000
        const timeMatch = timeLine.match(
            /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/
        );

        if (!timeMatch) {
            throw new Error(`Invalid timestamp format: "${timeLine}"`);
        }

        const startStr = normalizeTime(timeMatch[1]);
        const endStr = normalizeTime(timeMatch[2]);
        const startMs = timeToMs(startStr);
        const endMs = timeToMs(endStr);

        // Remaining lines = subtitle text
        const textLines = lines.slice(textStart);
        const fullText = textLines.join(' ').replace(/\s+/g, ' ').trim();

        if (!fullText) {
            // Empty subtitle — still include with placeholder
            return {
                id: idx,
                startMs,
                endMs,
                start: startStr,
                end: endStr,
                text: '(silence)',
                speaker: null,
                dialogue: ''
            };
        }

        // Speaker detection: "NAME: dialogue" or "NAME：dialogue"
        const speakerMatch = fullText.match(/^([一-鿿\wÀ-ɏ'.-]+)\s*[:：]\s*(.*)/);
        let speaker = null;
        let dialogue = fullText;

        if (speakerMatch) {
            speaker = speakerMatch[1].trim();
            dialogue = speakerMatch[2].trim() || '';
        }

        // Filter out HTML/XML tags (common in some SRTs)
        dialogue = dialogue.replace(/<[^>]*>/g, '').trim();
        const cleanText = fullText.replace(/<[^>]*>/g, '').trim();

        return {
            id: idx,
            startMs,
            endMs,
            start: startStr,
            end: endStr,
            text: cleanText || '(empty)',
            speaker,
            dialogue: dialogue || cleanText
        };
    }

    /**
     * Normalize time string: replace comma with dot, pad to 3-digit millis.
     */
    function normalizeTime(ts) {
        ts = ts.replace(',', '.');
        // Pad milliseconds if needed
        const parts = ts.split('.');
        if (parts.length === 2) {
            parts[1] = parts[1].padEnd(3, '0').slice(0, 3);
        } else {
            parts.push('000');
        }
        return parts.join('.');
    }

    /**
     * Convert "HH:MM:SS.mmm" to milliseconds.
     */
    function timeToMs(ts) {
        const [hms, ms] = ts.split('.');
        const [h, m, s] = hms.split(':').map(Number);
        return h * 3600000 + m * 60000 + s * 1000 + parseInt(ms || '0', 10);
    }

    /**
     * Convert milliseconds back to "HH:MM:SS.mmm" format.
     */
    function msToTime(ms) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const millis = ms % 1000;
        return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(millis).padStart(3, '0')}`;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    /**
     * Get all unique speakers from parsed entries.
     */
    function getSpeakers(entries) {
        const speakers = new Set();
        entries.forEach(e => {
            if (e.speaker) speakers.add(e.speaker);
        });
        return Array.from(speakers).sort();
    }

    /**
     * Assign speakers to entries that have none, using a best-guess heuristic
     * based on adjacent entries' speakers.
     */
    function inferSpeakers(entries) {
        const result = [...entries];
        let lastSpeaker = null;

        for (let i = 0; i < result.length; i++) {
            const e = result[i];
            if (e.speaker) {
                lastSpeaker = e.speaker;
            } else if (lastSpeaker && e.dialogue && e.dialogue.length > 0) {
                // If previous entry had a speaker and this has dialogue, assume same
                e.speaker = lastSpeaker;
            }
        }

        // Reverse pass for leading entries without speaker
        lastSpeaker = null;
        for (let i = result.length - 1; i >= 0; i--) {
            const e = result[i];
            if (e.speaker) {
                lastSpeaker = e.speaker;
            } else if (lastSpeaker && e.dialogue && e.dialogue.length > 0) {
                e.speaker = lastSpeaker;
            }
        }

        return result;
    }

    // Public API
    return {
        parse,
        getSpeakers,
        inferSpeakers,
        msToTime,
        timeToMs
    };
})();

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CineScopeParser;
}
