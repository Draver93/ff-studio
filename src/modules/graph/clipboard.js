// graph/clipboard.js
// Clipboard operations and keyboard event handling

const { invoke } = window.__TAURI__.core;
import { addLogEntry } from '../logs/logs.js';
import { canvas, graph } from './core.js';

import { parseFFmpegCommand } from './parser.js';
import { arrangeNodes } from './utils.js';

// Clipboard utility functions
async function copyToClipboard(text) {
    await invoke("plugin:clipboard|write_text", { text });
    console.log("Copied:", text);
}

async function pasteFromClipboard() {
    const text = await invoke("plugin:clipboard|read_text");
    console.log("Pasted:", text);
    return text;
}

// Check if text is an FFmpeg command
function isFFmpegCommand(text) {
    // Basic check: starts with 'ffmpeg' or contains '-i '
    return text.trim().startsWith("ffmpeg") || text.includes("-i ");
}

// Initialize clipboard event handlers
function initializeClipboard() {
    const litegraph_canvas = document.getElementById("litegraph-canvas");
    
    // Keyboard event handling for copy/paste
    litegraph_canvas.addEventListener("keydown", async (event) => {
        const key = event.key.toLowerCase();

        if (event.ctrlKey && key === "c") {
            const selected = canvas.getClipboard();
            await copyToClipboard(selected);
        }

        if (event.ctrlKey && key === "x") {
            canvas.copyToClipboard();
            const selected = canvas.getClipboard();
            await copyToClipboard(selected);
            canvas.deleteSelectedNodes();
        }

        if (event.ctrlKey && key === "v") {
            try {
                const text = await pasteFromClipboard();
                if (!text) return;

                // First try JSON
                try {
                    const data = JSON.parse(text);

                    // Check if it's valid LiteGraph data
                    if (data.nodes && Array.isArray(data.nodes)) {
                        canvas.setClipboard(text);
                        canvas.pasteFromClipboard();
                        return;
                    }

                } catch (jsonErr) { }

                // Check if text is an FFmpeg command
                if (isFFmpegCommand(text)) {
                    parseFFmpegCommand(text, graph);
                    arrangeNodes(graph);
                    return;
                }
                addLogEntry('error', `Clipboard data not recognized`);

            } catch (err) {
                addLogEntry('error', `Failed to read clipboard: ${err}`);
            }
        }
    });
}

export { isFFmpegCommand, copyToClipboard, pasteFromClipboard, initializeClipboard };