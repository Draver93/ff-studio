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
 * Supports multiple outputs with placeholders.
 *
 * Automatically determines injection strategy:
 *  - Multiple -i wildcards → {name} = input1_input2
 *  - Single -i wildcard → {name} = input basename
 *  - If no placeholder found → appends short hash before extension
 */
async function expandFfmpegCommand(ffmpegCommand, options = {}) {
    const { hashLength = 8, indexPadding = 0 } = options;

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Parse command into arguments
    // ═══════════════════════════════════════════════════════════════════════════
    const argv = splitArgs(ffmpegCommand);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Find all input wildcards (-i with *)
    // ═══════════════════════════════════════════════════════════════════════════
    const inputWildcards = [];
    const inputWildcardIndices = [];
    
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === '-i' && argv[i + 1].includes('*')) {
            inputWildcards.push(argv[i + 1]);
            inputWildcardIndices.push(i + 1);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Find ALL output patterns (args with * or placeholders after last -i)
    // ═══════════════════════════════════════════════════════════════════════════
    const placeholderRegex = /\{(hash|name|index)\}/;
    const outputPatterns = [];
    const outputPatternIndices = [];
    
    // Find last -i position
    let lastInputIndex = -1;
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === '-i') {
            lastInputIndex = i + 1;
        }
    }

    // Find all outputs after last input
    for (let i = lastInputIndex + 1; i < argv.length; i++) {
        const arg = argv[i];
        
        // Skip flags
        if (arg.startsWith('-')) {
            continue;
        }
        
        // Check if this looks like an output (has wildcard, placeholder, or is a file path)
        if (arg.includes('*') || placeholderRegex.test(arg)) {
            outputPatterns.push(arg);
            outputPatternIndices.push(i);
        } else if (!arg.startsWith('[') && !arg.startsWith('-')) {
            // Likely a regular output file (not a stream specifier)
            outputPatterns.push(arg);
            outputPatternIndices.push(i);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Early exit if no wildcards AND no placeholders
    // ═══════════════════════════════════════════════════════════════════════════
    const hasPlaceholders = outputPatterns.some(p => placeholderRegex.test(p));
    const hasInputWildcards = inputWildcards.length > 0;
    const hasOutputWildcards = outputPatterns.some(p => p.includes('*'));
    
    if (!hasInputWildcards && !hasOutputWildcards && !hasPlaceholders) {
        return [ffmpegCommand];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Expand all input wildcards via Tauri backend
    // ═══════════════════════════════════════════════════════════════════════════
    const expansions = {};
    
    if (inputWildcards.length > 0) {
        await Promise.all(
            inputWildcards.map(async (pattern) => {
                const list = await invoke('expand_wildcard_path', { pattern });
                expansions[pattern] = Array.isArray(list) ? list : [];
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Determine combination count
    // ═══════════════════════════════════════════════════════════════════════════
    let comboCount = 1; // Default for placeholder-only mode
    
    if (inputWildcards.length > 0) {
        const lengths = inputWildcards.map((p) => expansions[p].length);
        
        if (lengths.some(len => len === 0)) {
            throw new Error('One or more wildcards expanded to zero files');
        }
        
        if (new Set(lengths).size > 1) {
            console.warn('Wildcard expansion length mismatch:', lengths);
        }
        
        comboCount = Math.min(...lengths);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: Detect injection mode automatically
    // ═══════════════════════════════════════════════════════════════════════════
    const hasNamePlaceholder = outputPatterns.some(p => p.includes('{name}') || p.includes('*'));
    const hasHashPlaceholder = outputPatterns.some(p => p.includes('{hash}'));
    const hasIndexPlaceholder = outputPatterns.some(p => p.includes('{index}'));

    let injectionMode = 'hash'; // default
    
    if (hasIndexPlaceholder) {
        injectionMode = 'index';
    } else if (hasNamePlaceholder && inputWildcards.length >= 1) {
        injectionMode = 'name';
    } else if (hasHashPlaceholder) {
        injectionMode = 'hash';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 8: Generate commands for each combination
    // ═══════════════════════════════════════════════════════════════════════════
    const commands = [];

    for (let idx = 0; idx < comboCount; idx++) {
        // ───────────────────────────────────────────────────────────────────────
        // 8a: Get inputs for this combination (if any wildcards exist)
        // ───────────────────────────────────────────────────────────────────────
        const inputs = inputWildcards.length > 0 
            ? inputWildcards.map((p) => expansions[p][idx])
            : [];
        
        // ───────────────────────────────────────────────────────────────────────
        // 8b: Generate injection values
        // ───────────────────────────────────────────────────────────────────────
        let nameCombined = '';
        let hash = '';
        
        if (inputs.length > 0) {
            const inputBasenames = await Promise.all(inputs.map(basenameNoExt));
            nameCombined = inputBasenames.join('_');
            hash = (await sha256Hex(inputs.join('|'))).slice(0, hashLength);
        } else {
            // No input wildcards - use command itself for hash or generic name
            nameCombined = 'output';
            hash = (await sha256Hex(ffmpegCommand + idx)).slice(0, hashLength);
        }
        
        const indexStr = padIndex(idx, indexPadding);

        // ───────────────────────────────────────────────────────────────────────
        // 8c: Select injection string based on mode
        // ───────────────────────────────────────────────────────────────────────
        const injection = (() => {
            if (injectionMode === 'name') return nameCombined;
            if (injectionMode === 'index') return indexStr;
            return hash;
        })();

        // ───────────────────────────────────────────────────────────────────────
        // 8d: Build concrete output paths for ALL outputs
        // ───────────────────────────────────────────────────────────────────────
        const concreteOutputs = outputPatterns.map((pattern) => {
            let outPath = pattern;

            if (outPath.includes('*')) {
                // Replace wildcards
                outPath = outPath.replace(/\*/g, injection);
            } else if (placeholderRegex.test(outPath)) {
                // Replace placeholders
                outPath = outPath
                    .replace(/\{hash\}/g, hash)
                    .replace(/\{name\}/g, nameCombined)
                    .replace(/\{index\}/g, indexStr);
            } else if (outputPatterns.length === 1) {
                // Single output without placeholder - inject before extension
                outPath = injectBeforeExtension(outPath, injection);
            }
            // Multiple outputs without placeholders stay unchanged

            return outPath;
        });

        // ───────────────────────────────────────────────────────────────────────
        // 8e: Replace arguments with concrete values
        // ───────────────────────────────────────────────────────────────────────
        const concreteArgv = argv.map((arg, i) => {
            // Replace output patterns by position
            const outputIndex = outputPatternIndices.indexOf(i);
            if (outputIndex !== -1) {
                return quoteIfNeeded(concreteOutputs[outputIndex]);
            }

            // Replace input wildcards by position
            const wildcardIndex = inputWildcardIndices.indexOf(i);
            if (wildcardIndex !== -1) {
                return quoteIfNeeded(inputs[wildcardIndex]);
            }

            // Keep all other arguments unchanged
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
