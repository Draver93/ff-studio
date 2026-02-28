// graph/execution.js
// Graph execution, transcoding, and FFmpeg command generation

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
import { addLogEntry } from '../logs/logs.js';
import { expandFfmpegCommand } from './utils.js';
import * as core from './core.js';

// Execution state
window.loadingInterval = null;
window.isTranscoding = false;

window.action_button_listener = false;

// DOM elements
const executeBtn = document.getElementById('execute-btn');
const proModeToggle = document.getElementById('pro-mode-toggle');
const executionBarExpanded = document.getElementById('execution-bar-expanded');
const addChainElement = document.getElementById('add-chain-element');
const refreshChainElement = document.getElementById('refresh-chain-element');
const removeChainElement = document.getElementById('remove-chain-element');
const canvasContainer = document.getElementById('canvas-container');
const chain_canvas = document.getElementById('chainCanvas');

function replaceVariables(command) {
    if (!window.graph_variables) {
        return command;
    }

    let result = command;

    function escapeRegExp(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Replace variables in format {{variable_name}}
    Object.keys(window.graph_variables).forEach(key => {
        const value = window.graph_variables[key];
        const safeKey = escapeRegExp(key);
        const regex = new RegExp(`\\{\\{${safeKey}\\}\\}`, 'g');
        result = result.replace(regex, value);
    });

    return result;
}

// Generate FFmpeg command from graph
function get_ffmpeg_command(selected_only = false) {
    window.global_ffmpeg = {
        selected_only: selected_only,
        inputs: [],
        filters: [],
        outputs: []
    };
    window.graph_variables = {};

    core.graph.runStep();

    let result_cmd = "";

    window.global_ffmpeg.inputs.forEach((item) => {
        result_cmd += item + " ";
    });

    let filter_str = "";
    window.global_ffmpeg.filters.forEach((item) => {
        filter_str += item + ";";
    });
    if (filter_str.slice(-1) === ";") filter_str = filter_str.slice(0, -1);
    if (filter_str) result_cmd += `-filter_complex "${filter_str}" `;

    window.global_ffmpeg.outputs.forEach((item) => {
        result_cmd += item + " ";
    });
    
    if (!window.global_ffmpeg.outputs.length) {
        addLogEntry("error", "Caught error: Failed to create ffmpeg transcode cmd! At least one Output node must be specified!");
        return;
    }

    result_cmd = replaceVariables(result_cmd);

    return result_cmd;
}

async function startTranscding(cmds, envs) {
    invoke('queue_transcode', { cmds: cmds,  envs: envs,
        desc: JSON.stringify({
            "tag": cmds.length > 1 ? "chain transcode" : "single transcode", 
            "cmd": cmds.join(" | "), 
            "workflow": window.selectedWorkflow})
        });
}

// Initialize execution system
function initializeExecution() {
    // Canvas and chain state
    const ctx = chain_canvas.getContext('2d');
    const BLOCK_WIDTH = 270;
    const BLOCK_HEIGHT = 80; // Reduced height since we're skipping env
    const BLOCK_SPACING = 20;
    const BLOCK_Y = 20;

    // Setup resize observer
    const resizeObserver = new ResizeObserver((entries) => {
        const positionInfo = canvasContainer.getBoundingClientRect();
        chain_canvas.height = 112;
        redrawCanvas();
    });
    resizeObserver.observe(canvasContainer);

    let commandChain = [];
    let draggedBlock = null;
    let dragOffset = {x: 0, y: 0};
    let selectedBlock = null;

    // Initialize canvas events
    chain_canvas.addEventListener('mousedown', onCanvasMouseDown);
    chain_canvas.addEventListener('mousemove', onCanvasMouseMove);
    chain_canvas.addEventListener('mouseup', onCanvasMouseUp);
    chain_canvas.addEventListener('mouseleave', onCanvasMouseUp);

    // Pro Mode Toggle
    proModeToggle.addEventListener('click', () => {
        const result = proModeToggle.classList.toggle('active');
        executionBarExpanded.classList.toggle('active');
        
        if(!window.isTranscoding) executeBtn.querySelector('span').textContent = result ? "Execute Pipeline" : "Execute Graph";
    });
    // Add new element to canvas chain
    addChainElement.addEventListener('click', () => {
        const newBlock = {
            id: Date.now(),
            title: formatFfmpegPath(window.FFMPEG_BIN),
            command: get_ffmpeg_command(true),
            ffmpeg: window.FFMPEG_BIN,
            envs: window.FFMPEG_ENV,
            x: commandChain.length * (BLOCK_WIDTH + BLOCK_SPACING) + 20,
            y: BLOCK_Y
        };
        commandChain.push(newBlock);
        core.canvas.deselectAllNodes();
        redrawCanvas();
    });
    
    removeChainElement.addEventListener('click', () => {
        if(selectedBlock) {
            let selectedBlockIndex = commandChain.findIndex(block => {
                return selectedBlock.id == block.id;
            });
            commandChain.splice(selectedBlockIndex, 1);
            commandChain.forEach((b, i) => {
                b.x = i * (BLOCK_WIDTH + BLOCK_SPACING) + 20;
                b.y = BLOCK_Y;
            });
            selectedBlock = null;
            redrawCanvas();
        }
    });
    
    refreshChainElement.addEventListener('click', () => {
        if(selectedBlock) {
            selectedBlock.id = Date.now();
            selectedBlock.title = formatFfmpegPath(window.FFMPEG_BIN),
            selectedBlock.command = get_ffmpeg_command(true);
            selectedBlock.ffmpeg = window.FFMPEG_BIN,
            selectedBlock.envs = window.FFMPEG_ENV,
            redrawCanvas();
        }
    });

    // Execute functions
    executeBtn.addEventListener('click', () => {

        let cmds = [];
        let envs = [];
        if (proModeToggle.classList.contains('active')) {
            if (commandChain.length === 0) { addLogEntry("error", "Caught error: No commands in chain"); return; }
            cmds = commandChain.map(b => `${b.ffmpeg} ${b.command}`);
            envs = commandChain.map(b => b.envs);
            addLogEntry("info", `Executing ffmpeg commands chain: ${cmds.join(" | ")}`);
            startTranscding(cmds, envs);
        }
        else {
            expandFfmpegCommand(`${window.FFMPEG_BIN} ${get_ffmpeg_command()}`).then(list => {
                list.forEach(cmd => {
                    cmds = [cmd];
                    envs = [window.FFMPEG_ENV];
                    startTranscding(cmds, envs);
                    addLogEntry("info", `Expanded ffmpeg command: ${cmd}`);
                });
            });
        }
    });

    window.action_button_listener = setInterval(() => {
        addChainElement.disabled = Object.keys(core.canvas.selected_nodes).length < 2;
        removeChainElement.disabled = !selectedBlock;
        refreshChainElement.disabled = removeChainElement.disabled || addChainElement.disabled;
    }, 400);
    // Format FFmpeg path to show .../bin/ffmpeg.exe format
    function formatFfmpegPath(path) {
        if (!path) return 'ffmpeg';
        
        // If it's just "ffmpeg", return as is
        if (path === 'ffmpeg' || path === 'ffmpeg.exe') return path;
        
        // Extract just the bin/ffmpeg.exe part with ellipsis
        const parts = path.split(/[\\/]/);
        if (parts.length <= 2) return path;
        
        // Get the last two parts (bin and ffmpeg.exe)
        const binIndex = parts.findIndex(part => part === 'bin' || part === 'Bin');
        if (binIndex !== -1 && binIndex < parts.length - 1) {
            return `.../${parts[binIndex]}/${parts[binIndex + 1]}`;
        }
        
        // Fallback: show last two path components
        return `.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    // Canvas rendering
    function redrawCanvas() {
        if (!ctx) return;

        // Dynamically set canvas width based on blocks
        chain_canvas.width = Math.max(canvasContainer.clientWidth, commandChain.length * (BLOCK_WIDTH + BLOCK_SPACING) + 40);

        ctx.clearRect(0, 0, chain_canvas.width, chain_canvas.height);

        // Draw connection lines
        if (commandChain.length > 1) {
            ctx.strokeStyle = '#4a5568';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            for (let i = 0; i < commandChain.length - 1; i++) {
                const current = commandChain[i];
                const next = commandChain[i + 1];
                ctx.beginPath();
                ctx.moveTo(current.x + BLOCK_WIDTH, current.y + BLOCK_HEIGHT / 2);
                ctx.lineTo(next.x, next.y + BLOCK_HEIGHT / 2);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        commandChain.forEach((cmd, index) => {
            if (index !== draggedBlock) drawCommandBlock(cmd, false);
        });
        if (draggedBlock !== null) drawCommandBlock(commandChain[draggedBlock], true);

        if (commandChain.length > 0) {
            ctx.fillStyle = '#718096';
            ctx.font = '11px Segoe UI';
            ctx.fillText('Pipeline Flow →', 20, 25);
        }
    }

    function drawCommandBlock(cmd, isBeingDragged) {
        const x = cmd.x;
        const y = cmd.y;
        const width = BLOCK_WIDTH;
        const height = BLOCK_HEIGHT;
        const radius = 12;
        const accent_2 = '#0078D4';
        const accent = '#4dabf7';

        // --- Shadow ---
        ctx.shadowColor = isBeingDragged ? 'transparent' : 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = isBeingDragged ? 0 : 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = isBeingDragged ? 0 : 4;

        // --- Background ---
        ctx.fillStyle = isBeingDragged ? '#1F313F' : '#2d2d2d';
        roundRect(ctx, x, y, width, height, radius, true, false);

        // --- Border ---
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = isBeingDragged ? '#3d3d3d' : '#3a3a3a';
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, width, height, radius, false, true);

        // --- Selection highlight ---
        if (selectedBlock === cmd) {
            ctx.strokeStyle = accent; 
            ctx.lineWidth = 1;
            roundRect(ctx, x - 2, y - 2, width + 4, height + 4, radius, false, true);

            ctx.fillStyle = '#1F313F';
            roundRect(ctx, x, y, width, height, radius, true, false);
        }

        // --- Text Styling ---
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // FFmpeg binary path (top line)
        ctx.fillStyle = selectedBlock === cmd ? '#a5d8ff' : '#e0e0e0';
        ctx.font = '10px Segoe UI';
        const ffmpegText = truncateText(cmd.title, width - 40, ctx);
        ctx.fillText(ffmpegText, x + 10, y + 20);

        // Command (split into 2-3 lines)
        ctx.fillStyle = selectedBlock === cmd ? accent : '#b0b0b0';
        ctx.font = '11px Segoe UI';
        
        const commandLines = splitCommandIntoLines(cmd.command, width + 30);
        commandLines.forEach((line, index) => {
            ctx.fillText(line, x + 10, y + 35 + (index * 15));
        });

        // --- Index indicator ---
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px Segoe UI';
        ctx.textAlign = 'right';
        ctx.fillText(`${commandChain.indexOf(cmd) + 1}`, x + width - 8, y + 15);
    }
    function getCharsPerLine(availableWidth) {
        const testString = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        const testWidth = ctx.measureText(testString).width;
        const avgCharWidth = testWidth / testString.length;
        return Math.floor(availableWidth / avgCharWidth);
    }
    function splitCommandIntoLines(command, width) {
        const charsPerLine = getCharsPerLine(width);
        
        if (command.length <= charsPerLine * 3) {
            const lines = [];
            for (let i = 0; i < Math.min(3, Math.ceil(command.length / charsPerLine)); i++) {
                lines.push(command.substring(i * charsPerLine, (i + 1) * charsPerLine));
            }
            return lines;
        }
        
        // Show: first line, truncated middle, last line
        const firstLine = command.substring(0, charsPerLine);
        const lastLine = command.substring(command.length - charsPerLine);
        const middleContent = command.substring(charsPerLine, charsPerLine + 22) + " ... " +  command.substring(command.length - charsPerLine - 23, command.length - charsPerLine);
        
        return [firstLine, middleContent, lastLine];
    }
    // Helper: truncate text with ellipsis
    function truncateText(text, maxWidth, context) {
        if (context.measureText(text).width <= maxWidth) return text;
        
        let truncated = text;
        while (context.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
            truncated = truncated.substring(0, truncated.length - 1);
        }
        return truncated + '...';
    }
    // Helper: rounded rectangle
    function roundRect(ctx, x, y, w, h, r, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();

        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }
    // Drag + selection functions
    function getMousePos(e) {
        const rect = chain_canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function getBlockAt(x, y) {
        for (let i = commandChain.length-1; i >=0; i--) {
            const b = commandChain[i];
            if (x >= b.x && x <= b.x + BLOCK_WIDTH && y >= b.y && y <= b.y + BLOCK_HEIGHT)
                return i;
        }
        return -1;
    }

    function onCanvasMouseDown(e) {
        const mouse = getMousePos(e);
        const idx = getBlockAt(mouse.x, mouse.y);

        if (idx !== -1) {
            draggedBlock = idx;
            dragOffset.x = mouse.x - commandChain[idx].x;
            dragOffset.y = mouse.y - commandChain[idx].y;
            chain_canvas.style.cursor = 'grabbing';

            // Select clicked block
            selectedBlock = commandChain[idx];
        } else {
            // Clear selection if clicked empty area
            selectedBlock = null;
        }

        redrawCanvas();
    }

    function onCanvasMouseMove(e) {
        const mouse = getMousePos(e);
        if (draggedBlock !== null) {
            const block = commandChain[draggedBlock];
            block.x = mouse.x - dragOffset.x;
            block.y = mouse.y - dragOffset.y;

            block.x = Math.max(0, Math.min(block.x, chain_canvas.width - BLOCK_WIDTH));
            block.y = Math.max(0, Math.min(block.y, chain_canvas.height - BLOCK_HEIGHT));
            redrawCanvas();
        } else {
            chain_canvas.style.cursor = getBlockAt(mouse.x, mouse.y) !== -1 ? 'grab' : 'default';
        }
    }

    function onCanvasMouseUp(e) {
        if (draggedBlock !== null) {
            // Snap to horizontal slots
            const snapSlots = commandChain.map((_, i) => i*(BLOCK_WIDTH+BLOCK_SPACING)+20);
            const block = commandChain[draggedBlock];
            let closest = 0;
            let minDist = Math.abs(block.x - snapSlots[0]);
            for (let i=1;i<snapSlots.length;i++){
                const d = Math.abs(block.x - snapSlots[i]);
                if(d<minDist){minDist=d;closest=i;}
            }

            if(closest!==draggedBlock){
                const moved = commandChain.splice(draggedBlock,1)[0];
                commandChain.splice(closest,0,moved);
            }

            commandChain.forEach((b,i)=>{ b.x = i*(BLOCK_WIDTH+BLOCK_SPACING)+20; b.y=BLOCK_Y; });
            draggedBlock = null;
            chain_canvas.style.cursor = 'default';
            redrawCanvas();
        }
    }
}


export { startTranscding, get_ffmpeg_command, initializeExecution };