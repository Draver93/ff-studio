const { invoke } = window.__TAURI__.core;

const NODE_WIDTH = 210;
const NODE_HEIGHT = 100;
const HORIZONTAL_SPACING = 250;
const VERTICAL_SPACING = 150;
const MARGIN = 50;


/**
 * Expands ffmpeg command wildcards by calling Tauri backend (expand_wildcard_path)
 * and generates per-input output filenames automatically.
 *
 * Automatically determines injection strategy:
 *  - Multiple -i wildcards → {name} = input1_input2
 *  - Single -i wildcard → {name} = input basename
 *  - If no placeholder found → appends short hash before extension
 */
async function expandFfmpegCommand(ffmpegCommand, options = {}) {
    const { hashLength = 8, indexPadding = 0 } = options;
    const argv = splitArgs(ffmpegCommand);

    // ---- find input wildcards ----
    const inputWildcards = [];
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === '-i' && argv[i + 1].includes('*')) {
            inputWildcards.push(argv[i + 1]);
        }
    }

    // ---- find output pattern ----
    const placeholderRegex = /\{(hash|name|index)\}/;
    let outputPattern = null;
    for (let i = argv.length - 1; i >= 0; i--) {
        const a = argv[i];
        if (a.includes('*') || placeholderRegex.test(a)) {
            outputPattern = a;
            break;
        }
    }
    if (!outputPattern) {
        const lastArg = argv[argv.length - 1];
        outputPattern = !lastArg.startsWith('-') ? lastArg : '*';
    }

    if (inputWildcards.length === 0) return [ffmpegCommand];

    // ---- expand all wildcards via tauri command ----
    const expansions = {};
    await Promise.all(
        inputWildcards.map(async (pattern) => {
            const list = await invoke('expand_wildcard_path', { pattern });
            expansions[pattern] = Array.isArray(list) ? list : [];
        })
    );

    // ---- determine number of combinations ----
    const lengths = inputWildcards.map((p) => expansions[p].length);
    const comboCount = Math.min(...lengths);

    // ---- detect injection mode automatically ----
    const outputHasName = outputPattern.includes('{name}') || outputPattern.includes('*');
    const outputHasHash = outputPattern.includes('{hash}');
    const outputHasIndex = outputPattern.includes('{index}');
    let injectionMode = 'hash';
    if (outputHasIndex) injectionMode = 'index';
    else if (inputWildcards.length >= 1) injectionMode = 'name';
    else if (outputHasHash) injectionMode = 'hash';

    const commands = [];
    for (let idx = 0; idx < comboCount; idx++) {
        const inputs = inputWildcards.map((p) => expansions[p][idx]);
        const inputBasenames = await Promise.all(inputs.map(basenameNoExt));
        const nameCombined = inputBasenames.join('_');
        const hash = (await sha256Hex(inputs.join('|'))).slice(0, hashLength);
        const indexStr = padIndex(idx, indexPadding);

        // Select actual injection string
        const injection = (() => {
            if (injectionMode === 'name') return nameCombined;
            if (injectionMode === 'index') return indexStr;
            return hash;
        })();

        // ---- build output path ----
        let outPath = outputPattern;
        if (outPath.includes('*')) {
            outPath = outPath.replace(/\*/g, injection);
        } else if (placeholderRegex.test(outPath)) {
            outPath = outPath
                .replace(/\{hash\}/g, hash)
                .replace(/\{name\}/g, nameCombined)
                .replace(/\{index\}/g, indexStr);
        } else {
            outPath = injectBeforeExtension(outPath, injection);
        }

        // ---- replace args ----
        const concreteArgv = argv.map((arg) => {
            if (arg === outputPattern) return quoteIfNeeded(outPath);
            const idxInInputs = inputWildcards.indexOf(arg);
            if (idxInInputs !== -1) return quoteIfNeeded(inputs[idxInInputs]);
            return arg;
        });

        commands.push(concreteArgv.join(' '));
    }

    return commands;
}

/* ---------- Helpers ---------- */

function splitArgs(str) {
    const args = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; }
        else if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; }
        else if (ch === ' ' && !inSingle && !inDouble) {
            if (current !== '') { args.push(current); current = ''; }
        } else current += ch;
    }
    if (current !== '') args.push(current);
    return args;
}

function quoteIfNeeded(p) {
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) return p;
    return p.includes(' ') ? `"${p}"` : p;
}

function padIndex(i, pad) {
    return pad > 0 ? String(i).padStart(pad, '0') : String(i);
}

function injectBeforeExtension(path, inject) {
    const slashIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const file = path.slice(slashIdx + 1);
    const dir = slashIdx >= 0 ? path.slice(0, slashIdx + 1) : '';
    const dot = file.lastIndexOf('.');
    if (dot === -1) return dir + file + '_' + inject;
    return dir + file.slice(0, dot) + '_' + inject + file.slice(dot);
}

async function basenameNoExt(path) {
    const slashIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const file = path.slice(slashIdx + 1);
    const dot = file.lastIndexOf('.');
    return dot === -1 ? file : file.slice(0, dot);
}

async function sha256Hex(text) {
    const enc = new TextEncoder();
    const data = enc.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function arrangeNodes(graph) {
    const nodes = graph._nodes;
    const links = graph.links;

    // Helper: get all nodes connected to a node (both inputs & outputs)
    const getConnectedNodes = (node) => {
        const connected = new Set();
        if (node.inputs) {
            for (const input of node.inputs) {
                if (input.link !== null && links[input.link]) {
                    const sourceNode = graph.getNodeById(links[input.link].origin_id);
                    if (sourceNode) connected.add(sourceNode);
                }
            }
        }
        if (node.outputs) {
            for (const output of node.outputs) {
                if (output.links) {
                    for (const linkId of output.links) {
                        if (links[linkId]) {
                            const targetNode = graph.getNodeById(links[linkId].target_id);
                            if (targetNode) connected.add(targetNode);
                        }
                    }
                }
            }
        }
        return Array.from(connected);
    };

    // Step 1: Find connected components
    const visited = new Set();
    const components = [];

    for (const node of nodes) {
        if (!visited.has(node)) {
            const stack = [node];
            const component = new Set();
            while (stack.length) {
                const n = stack.pop();
                if (!visited.has(n)) {
                    visited.add(n);
                    component.add(n);
                    stack.push(...getConnectedNodes(n).filter(cn => !visited.has(cn)));
                }
            }
            components.push(Array.from(component));
        }
    }

    let currentY = MARGIN;

    // Step 2: Arrange each component
    for (const component of components) {

        // Step 2a: Compute levels from source nodes (nodes with no inputs)
        const nodeLevel = new Map();
        const queue = component.filter(n => !n.inputs || n.inputs.every(i => i.link === null));
        queue.forEach(n => nodeLevel.set(n, 0));

        while (queue.length) {
            const node = queue.shift();
            const level = nodeLevel.get(node);
            if (node.outputs) {
                for (const output of node.outputs) {
                    if (output.links) {
                        for (const linkId of output.links) {
                            const targetNode = graph.getNodeById(links[linkId].target_id);
                            if (targetNode && component.includes(targetNode)) {
                                const nextLevel = level + 1;
                                if (!nodeLevel.has(targetNode) || nodeLevel.get(targetNode) < nextLevel) {
                                    nodeLevel.set(targetNode, nextLevel);
                                    queue.push(targetNode);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Step 2b: Group nodes by level
        const levels = {};
        for (const node of component) {
            const lvl = nodeLevel.get(node) ?? 0;
            if (!levels[lvl]) levels[lvl] = [];
            levels[lvl].push(node);
        }

        // Step 2c: Calculate bounding box heights per level
        const levelHeights = {};
        for (const lvl in levels) {
            levelHeights[lvl] = levels[lvl].reduce((sum, n) => sum + (n.size?.[1] || NODE_HEIGHT) + VERTICAL_SPACING, 0);
        }

        // Step 2d: Place nodes
        const maxLevel = Math.max(...Object.keys(levels).map(Number));
        const levelX = {};
        for (let l = 0; l <= maxLevel; l++) {
            levelX[l] = MARGIN + l * (NODE_WIDTH + HORIZONTAL_SPACING);
        }

        // Vertically center nodes per level
        const levelY = {};
        for (const lvl in levels) {
            const nodesInLevel = levels[lvl];
            const totalHeight = nodesInLevel.reduce((sum, n) => sum + (n.size?.[1] || NODE_HEIGHT) + VERTICAL_SPACING, -VERTICAL_SPACING);
            let startY = currentY + (Math.max(...Object.values(levelHeights)) - totalHeight) / 2;
            for (const n of nodesInLevel) {
                if (!n.pos) n.pos = [0,0];
                n.pos[0] = levelX[lvl];
                n.pos[1] = startY;
                startY += (n.size?.[1] || NODE_HEIGHT) + VERTICAL_SPACING;
            }
        }

        // Step 2e: Update Y for next component
        currentY += Math.max(...Object.values(levelHeights)) + MARGIN;
    }

    // Refresh the canvas
    if (graph.canvas) graph.canvas.draw(true);
}

export { arrangeNodes, expandFfmpegCommand };
