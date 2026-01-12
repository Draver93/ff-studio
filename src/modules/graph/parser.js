import * as graph_consts from './constants.js';


function splitArgs(cmd) {
    // First, normalize line continuations by removing backslash + newline/whitespace
    // This handles both Unix (\\\n) and Windows (\\\r\n) line continuations
    cmd = cmd.replace(/\\\s*[\r\n]+\s*/g, ' ');

    const args = [];
    let current = '';
    let inDoubleQuotes = false;
    let inSingleQuotes = false;
    let i = 0;
    
    while (i < cmd.length) {
        const char = cmd[i];
        const nextChar = cmd[i + 1];
        
        // Handle escape sequences
        if (char === '\\' && !inSingleQuotes) {
            // Check if it's escaping a special character
            if (nextChar === '"' || nextChar === "'" || nextChar === '\\' || nextChar === ' ') {
                current += nextChar;
                i += 2;
                continue;
            }
            // Otherwise, keep the backslash
            current += char;
            i++;
            continue;
        }
        
        // Handle quotes
        if (char === '"' && !inSingleQuotes) {
            inDoubleQuotes = !inDoubleQuotes;
            i++;
            continue;
        }
        
        if (char === "'" && !inDoubleQuotes) {
            inSingleQuotes = !inSingleQuotes;
            i++;
            continue;
        }
        
        // Handle whitespace (argument separator)
        if ((char === ' ' || char === '\t' || char === '\n' || char === '\r') && 
            !inDoubleQuotes && !inSingleQuotes) {
            if (current.length > 0) {
                args.push(current.trim());
                current = '';
            }
            i++;
            continue;
        }
        
        // Regular character
        current += char;
        i++;
    }
    
    // Push the last argument if exists
    if (current.length > 0) {
        args.push(current.trim());
    }
    return args;
}

function splitPipedFFmpeg(cmd) {
    const segments = [];
    let current = "";
    let inDoubleQuotes = false;
    let inSingleQuotes = false;

    for (let i = 0; i < cmd.length; i++) {
        const char = cmd[i];

        if (char === '"' && !inSingleQuotes) inDoubleQuotes = !inDoubleQuotes;
        else if (char === "'" && !inDoubleQuotes) inSingleQuotes = !inSingleQuotes;
        else if (char === "|" && !inDoubleQuotes && !inSingleQuotes) {
            segments.push(current.trim());
            current = "";
            continue;
        }

        current += char;
    }

    if (current) segments.push(current.trim());
    return segments;
}

function generateHash() {
    return Math.random().toString(36).substring(2, 8);
}

function parseFilterOptions(optsString) {
    const options = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let parenDepth = 0;
    
    for (let i = 0; i < optsString.length; i++) {
        const char = optsString[i];
        const prevChar = i > 0 ? optsString[i - 1] : '';
        
        // Handle escape sequences
        if (char === '\\' && i + 1 < optsString.length) {
            current += char + optsString[i + 1];
            i++;
            continue;
        }
        
        // Track quote state FIRST (before checking for colon)
        if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
            inSingleQuote = !inSingleQuote;
            current += char;
            continue;
        }
        if (char === '"' && !inSingleQuote && prevChar !== '\\') {
            inDoubleQuote = !inDoubleQuote;
            current += char;
            continue;
        }
        
        // Track parentheses depth (only outside quotes)
        if (!inSingleQuote && !inDoubleQuote) {
            if (char === '(') parenDepth++;
            else if (char === ')') parenDepth--;
        }
        
        // Only split on : if outside quotes and parentheses
        if (char === ':' && !inSingleQuote && !inDoubleQuote && parenDepth === 0) {
            if (current.trim()) {
                options.push(parseFilterOption(current.trim()));
                current = '';
            }
            continue;
        }
        
        current += char;
    }
    
    if (current.trim()) {
        options.push(parseFilterOption(current.trim()));
    }
    
    return options;
}

function parseFilterOption(optString) {
    const eqIndex = optString.indexOf('=');
    if (eqIndex === -1) {
        return { val: optString };
    }
    return { 
        name: optString.substring(0, eqIndex).trim(), 
        val: optString.substring(eqIndex + 1).trim() 
    };
}

function parseFilterComplex(expr) {
    const filters = [];
    
    // Replace commas with intermediate labels, but NOT inside quotes, brackets, or parentheses
    let processedExpr = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBracket = false;
    let parenDepth = 0;
    
    for (let i = 0; i < expr.length; i++) {
        const char = expr[i];
        const prevChar = i > 0 ? expr[i - 1] : '';
        
        // Track escape sequences
        if (char === '\\' && i + 1 < expr.length) {
            processedExpr += char + expr[i + 1];
            i++;
            continue;
        }
        
        // Track quotes
        if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
            inSingleQuote = !inSingleQuote;
        }
        if (char === '"' && !inSingleQuote && prevChar !== '\\') {
            inDoubleQuote = !inDoubleQuote;
        }
        
        // Track brackets and parentheses (only outside quotes)
        if (!inSingleQuote && !inDoubleQuote) {
            if (char === '[') inBracket = true;
            if (char === ']') inBracket = false;
            if (char === '(') parenDepth++;
            if (char === ')') parenDepth--;
        }
        
        // Replace comma only if outside quotes, brackets, and parentheses
        if (char === ',' && !inSingleQuote && !inDoubleQuote && !inBracket && parenDepth === 0) {
            const hash = generateHash();
            processedExpr += `[${hash}];[${hash}]`;
        } else {
            processedExpr += char;
        }
    }

    const chains = processedExpr.split(';').filter(chain => chain.trim());
    
    for (const chain of chains) {
        const filterObj = {
            inputs: [],
            filter: '',
            options: [],
            outputs: [],
            id: null // Add ID field
        };
        
        let current = chain.trim();
        
        // Parse inputs (all [labels] at the beginning)
        while (current.startsWith('[')) {
            const match = current.match(/^\[([^\]]+)\]/);
            if (match) {
                filterObj.inputs.push(match[1]);
                current = current.substring(match[0].length).trim();
            } else {
                break;
            }
        }
        
        // Parse the filter name and options
        let filterEnd = current.indexOf('[');
        if (filterEnd === -1) {
            filterEnd = current.length;
        }
        
        let filterPart = current.substring(0, filterEnd).trim();
        
        if (filterPart) {
            // Check if filter has an ID (format: filtername@id)
            const idMatch = filterPart.match(/^([^@=]+)@([^=]+)(.*)$/);
            if (idMatch) {
                filterObj.filter = idMatch[1].trim();
                filterObj.id = idMatch[2].trim();
                filterPart = idMatch[1] + idMatch[3]; // Reconstruct without ID for option parsing
            }

            // Find first = to split filter name from options
            const firstEqIndex = filterPart.indexOf('=');
            filterObj.filter = filterPart.substring(0, firstEqIndex);
            if (firstEqIndex !== -1) {
                const optsString = filterPart.substring(firstEqIndex + 1);
                
                parseFilterOptions(optsString).forEach((opt, opt_id) => {
                    const {name, val} = opt;
                    if (name && val) {
                        filterObj.options.push({name: name.trim(), val: val});
                    } else if (val) {
                        filterObj.options.push({val: val});
                    }
                });
            }
        }
        
        // Parse outputs (all [labels] at the end)
        let remainingPart = current.substring(filterEnd);
        while (remainingPart.includes('[')) {
            const match = remainingPart.match(/\[([^\]]+)\]/);
            if (match) {
                filterObj.outputs.push(match[1]);
                remainingPart = remainingPart.substring(match.index + match[0].length);
            } else {
                break;
            }
        }
        
        filters.push(filterObj);
    }
    
    return filters;
}

function isFilename(arg) {
    if (!arg) return false;
    arg = arg.replace(/^['"]|['"]$/g, "");

    const invalidChars = /[<>"/\\|?*\x00]/;
    if (invalidChars.test(arg)) return false;

    if (arg === "-") return true; // stdout or stdin
    if (/^pipe:\d+$/.test(arg)) return true; // pipe:0, pipe:1, etc.
    if (/\.[a-z0-9]{2,5}$/i.test(arg)) return true; // file.ext (mp4, mp3, wav, etc.)
    return false;
}

function splitFFmpegArgs(args) {
    const inputs = [];
    const outputs = [];
    const filters = [];

    let buffer = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "-filter_complex") {
            const expr = args[i + 1];
            filters.push(...parseFilterComplex(expr));
            i++;
            continue;
        }

        buffer.push(arg);

        if (arg === "-i" && args[i + 1]) {
            buffer.push(args[i + 1]);
            inputs.push(buffer);
            buffer = [];
            i++;
            continue;
        }

        if (isFilename(arg)) {
            outputs.push(buffer);
            buffer = [];
            continue;
        }
    }

    return { inputs, outputs, filters };
}

function findAndCreateCodecNode(codecName, type, registeredNodes, graph) {
    const category = type === "encoder" ? "encoders" : "decoders";
    const searchPaths = [
        `ffmpeg/${category}/video/${codecName}`,
        `ffmpeg/${category}/audio/${codecName}`,
        `ffmpeg/${category}/all/${codecName}`,
        `ffmpeg/${category}/${codecName}`,
    ];
    
    for (const path of searchPaths) {
        if (registeredNodes[path]) {
            const node = LiteGraph.createNode(path);
            if (node) {
                graph.add(node);
                return node;
            }
        }
    }
    
    return null;
}

function findAndCreateFormatNode(formatName, type, registeredNodes, graph) {
    const category = type === "muxer" ? "muxers" : "demuxers";
    const searchPaths = [
        `ffmpeg/${category}/${formatName}`,
        `ffmpeg/${category}/video/${formatName}`,
        `ffmpeg/${category}/audio/${formatName}`,
        `ffmpeg/${category}/all/${formatName}`,
    ];
    
    for (const path of searchPaths) {
        if (registeredNodes[path]) {
            const node = LiteGraph.createNode(path);
            if (node) {
                graph.add(node);
                return node;
            }
        }
    }
    
    return null;
}

function createStreamSelectorFromMap(mapValue, registeredNodes, graph) {
    const streamNode = LiteGraph.createNode("ffmpeg/stream selector");
    if (!streamNode) return null;
    
    // Parse different -map formats
    if (mapValue.startsWith("[") && mapValue.endsWith("]")) {
        // Format: [label] - filter output reference
        const label = mapValue.slice(1, -1);
        streamNode.setProperty("Select by", "name");
        streamNode.setProperty("Name", label);
    } else {
        // Parse input:stream format (e.g., "0:v:0", "1:a", "0:0")
        const parts = mapValue.split(":");
        
        if (parts.length >= 2) {
            // Check if it has stream type specifier (v, a, s, d, t)
            const streamType = parts[1];
            if (["v", "a", "s", "d", "t"].includes(streamType)) {
                streamNode.setProperty("Select by", "type");
                const typeMap = { "v": "video", "a": "audio", "s": "subtitle", "d": "data", "t": "attachment" };
                streamNode.setProperty("Type", typeMap[streamType]);
                
                if (parts.length > 2) {
                    streamNode.setProperty("Id", parts[2]);
                }
            } else if (parts[1].startsWith("m:language:")) {
                // Language selector: 0:m:language:eng
                const lang = parts[1].split(":")[2];
                streamNode.setProperty("Select by", "language");
                streamNode.setProperty("Language", lang);
            } else if (parts[1].startsWith("p:")) {
                // Program selector: 0:p:1
                const programId = parts[1].split(":")[1];
                streamNode.setProperty("Select by", "program");
                streamNode.setProperty("Program", programId);
            } else {
                // Simple stream ID: 0:1
                streamNode.setProperty("Select by", "id");
                streamNode.setProperty("Id", parts[1]);
            }
        } else {
            // Just input index, use custom format
            streamNode.setProperty("Select by", "custom");
            streamNode.setProperty("Custom", mapValue);
        }
    }
    
    graph.add(streamNode);
    return streamNode;
}

function createStreamSelector(streamSpec, graph, inputNodes = []) {
    const streamNode = LiteGraph.createNode("ffmpeg/stream selector");
    if (!streamNode) return null;
    
    // Remove brackets if present (for filter output labels)
    const cleanSpec = streamSpec.replace(/[\[\]]/g, '');
    let inputIndex = NaN;
    // Parse the stream specification
    if (streamSpec.includes(':')) {
        // FFmpeg stream specification format: 0:v:0, 1:a, 0:m:language:eng, etc.
        const parts = streamSpec.split(':');
        
        if (parts.length >= 2) {
            // Check for special stream selectors
            if (parts[1] === 'm' && parts[2] === 'language') {
                // Language selector: 0:m:language:eng
                streamNode.setProperty("Select by", "language");
                streamNode.setProperty("Language", parts[3] || "eng");
            } 
            else if (parts[1] === 'p') {
                // Program selector: 0:p:1
                streamNode.setProperty("Select by", "program");
                streamNode.setProperty("Program", parts[2] || "1");
            }
            else if (["v", "a", "s", "d", "t"].includes(parts[1])) {
                // Stream type selector: 0:v, 1:a:0, etc.
                streamNode.setProperty("Select by", "type");
                const typeMap = { 
                    "v": "video", 
                    "a": "audio", 
                    "s": "subtitle", 
                    "d": "data", 
                    "t": "attachment" 
                };
                streamNode.setProperty("Type", typeMap[parts[1]]);
                
                if (parts.length > 2) {
                    streamNode.setProperty("Id", parts[2]);
                }
            }
            else {
                // Simple stream ID: 0:1, 1:2, etc.
                streamNode.setProperty("Select by", "id");
                streamNode.setProperty("Id", parts[1]);
            }
            
            // Set input index if available
            if (parts[0] && inputNodes) {
                // If we have an input node reference, we can set the input index
                inputIndex = parseInt(parts[0]);
            }
        }
    }
    else if (streamSpec.startsWith(':')) {
        // Relative stream type: :v, :a, :s (selects from default input)
        const streamType = streamSpec.substring(1);
        if (["v", "a", "s", "d", "t"].includes(streamType)) {
            streamNode.setProperty("Select by", "type");
            const typeMap = { 
                "v": "video", 
                "a": "audio", 
                "s": "subtitle", 
                "d": "data", 
                "t": "attachment" 
            };
            streamNode.setProperty("Type", typeMap[streamType]);
        }
    }
    else if (!isNaN(parseInt(streamSpec))) {
        // Simple stream index: 0, 1, 2 (selects stream by index from default input)
        streamNode.setProperty("Select by", "id");
        streamNode.setProperty("Id", streamSpec);
    }
    else {
        // Filter output label format: [v0], [out], etc.
        streamNode.setProperty("Select by", "name");
        streamNode.setProperty("Name", cleanSpec);
    }
    
    // Add to graph
    graph.add(streamNode);
    
    if (inputNodes && !isNaN(inputIndex)) {
        inputNodes[inputIndex].connect(0, streamNode, 0);
    }

    return streamNode;
}

function findAndCreateFilterNode(filterName, registeredNodes, graph) {
    const searchPaths = [
        `ffmpeg/filters/video/${filterName}`,
        `ffmpeg/filters/audio/${filterName}`,
        `ffmpeg/filters/all/${filterName}`,
        `ffmpeg/filters/${filterName}`,
    ];
    
    for (const path of searchPaths) {
        if (registeredNodes[path]) {
            const node = LiteGraph.createNode(path);
            if (node) {
                graph.add(node);
                return node;
            }
        }
    }
    
    return null;
}

function findAndCreateFlagNode(flag, value, registeredNodes, graph) {
    // Remove leading dashes and stream specifiers
    const cleanFlag = flag.replace(/^-+/, '').replace(/:[vasd]:\d*$/, '');
    
    // Search in general options categories
    const searchPaths = [
        `ffmpeg/general/${cleanFlag}/${flag}`,
        `ffmpeg/general/${cleanFlag}/${cleanFlag}`,
    ];
    
    for (const path of searchPaths) {
        if (registeredNodes[path]) {
            const node = LiteGraph.createNode(path);
            if (node) {
                if (value !== undefined && !value.startsWith("-")) {
                    node.setProperty(cleanFlag, value);
                }
                graph.add(node);
                return node;
            }
        }
    }
    
    return null;
}

function handleGeneralParameter(param, existingNodes, registeredNodes, graph) {
    const { name, stream_spec, value } = param;
    
    // First, try to create a new global node for this parameter
    // Search through all registered nodes for paths ending with our parameter name
    let foundNodePath = null;
    
    for (const nodePath in registeredNodes) {
        if (nodePath.endsWith(`/${name}`)) {
            foundNodePath = nodePath;
            break;
        }
    }
    
    // Try to create a new node if found
    if (foundNodePath) {
        const node = LiteGraph.createNode(foundNodePath);
        if (node) {
            // Set the value if provided
            if (value && value !== "") {
                // Try different ways to set the value
                if (node.setProperty && typeof node.setProperty === 'function') {
                    // Try the clean name first, then common property names
                    if (node.properties && node.properties.hasOwnProperty(name)) {
                        node.setProperty(name, value);
                    } else if (node.properties && node.properties.hasOwnProperty("value")) {
                        node.setProperty("value", value);
                    }
                }
                
                // Try to find and set widget value
                if (node.widgets) {
                    const widget = node.widgets.find(w => 
                        w.name === name || 
                        w.name === "value" ||
                        w.name === name
                    );
                    if (widget) {
                        widget.value = value;
                    }
                }
            }
            
            graph.add(node);

            if(stream_spec && stream_spec !== "") {
                const stream_spec_node = createStreamSelector(stream_spec, graph);
                stream_spec_node.connect(0, node, 1); //stream is second connection 
            }
            
            return node;
        }
    }
    
    // If no new node created, try to apply parameter to existing nodes
    for (const existingNode of existingNodes) {
        if (!existingNode) continue;
        
        let applied = false;
        
        // Try to set as property
        if (existingNode.properties && existingNode.properties.hasOwnProperty(name)) {
            existingNode.setProperty(name, value || true);
            applied = true;
        }
        
        // Try to set as widget
        if (!applied && existingNode.widgets) {
            const widget = existingNode.widgets.find(w => 
                w.name === name || 
                w.name === name
            );
            if (widget) {
                widget.value = value || true;
                applied = true;
            }
        }
        
        if (applied) {
            return existingNode; // Return the node we applied to
        }
    }
    
    return null; // Couldn't handle this parameter
}

function createInputNode(inputArgs, graph) {
    const inputNode = LiteGraph.createNode("ffmpeg/input");
    if (!inputNode) return null;
    
    let srcPath = "";
    let decoderV = "";
    let decoderA = "";
    let demuxer = "";
    let general = [];

    // Parse input arguments
    for (let i = 0; i < inputArgs.length; i++) {
        const arg = inputArgs[i];
        
        if (arg === "-i" && i + 1 < inputArgs.length) {
            srcPath = inputArgs[i + 1];
            i++;
        } else if (arg === "-c:v" && i + 1 < inputArgs.length) {
            decoderV = inputArgs[i + 1];
            i++;
        } else if (arg === "-c:a" && i + 1 < inputArgs.length) {
            decoderA = inputArgs[i + 1];
            i++;
        } else if (arg === "-f" && i + 1 < inputArgs.length) {
            demuxer = inputArgs[i + 1];
            i++;
        } else if (arg.startsWith("-")) {
            // Parse general parameter
            let hasValue = (i + 1 < inputArgs.length) && !inputArgs[i + 1].trim().startsWith('-');
            let nameInfo = arg.split(/:(.*)/s);
            
            general.push({
                name: nameInfo[0],
                stream_spec: nameInfo.length > 1 ? `:${nameInfo[1]}` : "", 
                value: hasValue ? inputArgs[i + 1] : ""
            }); 
            
            if (hasValue) i++;
        }
    }
    
    // Set basic properties
    if (srcPath) inputNode.setProperty("src_path", srcPath);
    graph.add(inputNode);
    
    // Keep track of nodes we create for this input
    const createdNodes = [inputNode];
    
    // Create and connect decoder/demuxer nodes
    if (decoderV) {
        const decNode = findAndCreateCodecNode(decoderV, "decoder", LiteGraph.registered_node_types, graph);
        if (decNode) {
            decNode.connect(0, inputNode, 1); // dec:v input
            createdNodes.push(decNode);
        }
    }
    
    if (decoderA) {
        const decNode = findAndCreateCodecNode(decoderA, "decoder", LiteGraph.registered_node_types, graph);
        if (decNode) {
            decNode.connect(0, inputNode, 2); // dec:a input
            createdNodes.push(decNode);
        }
    }
    
    if (demuxer) {
        const demuxNode = findAndCreateFormatNode(demuxer, "demuxer", LiteGraph.registered_node_types, graph);
        if (demuxNode) {
            demuxNode.connect(0, inputNode, 3); // demuxer input
            createdNodes.push(demuxNode);
        }
    }
    
    // Handle general parameters
    let lastGlobalNode = null;
    for (const param of general) {
        const resultNode = handleGeneralParameter(param, createdNodes, LiteGraph.registered_node_types, graph);
        if (resultNode && !createdNodes.includes(resultNode)) {
            // This is a new global node
            if(lastGlobalNode) lastGlobalNode.connect(0, resultNode, 0);
            lastGlobalNode = resultNode;
            createdNodes.push(resultNode);
        }
    }
    
    // Connect the last global node to the input node's global input
    if (lastGlobalNode) {
        lastGlobalNode.connect(0, inputNode, 0);
    }
    
    return inputNode;
}

function createFilterNode(filter, graph) {
    const filterNode = findAndCreateFilterNode(filter.filter, LiteGraph.registered_node_types, graph);
    if (!filterNode) return null;
    
    // Set filter options
    filter.options.forEach((opt, idx) => {
        if(opt.name && opt.val) {
            if (filterNode.properties.hasOwnProperty(opt.name)) {
                filterNode.setProperty(opt.name, opt.val);
            } else {
                // Try to find the widget with this name
                const widget = filterNode.widgets.find(w => w.name === opt.name);
                if (widget) {
                    widget.value = opt.val;
                }
            }
        }
        else if(opt.val && idx < filterNode.widgets.length) {
            filterNode.widgets[idx].value = opt.val;
        }
        else {
            //hmm
        }
    });
    
    return filterNode;
}

function connectFilterInputs(filter, filterNode, streamSelectorMap, graph) {
    filter.inputs.forEach((inputLabel, inputIndex) => {
        const streamSelector = streamSelectorMap.get(inputLabel);
        if (streamSelector) {
            // Find available input slot on filter node
            let inputSlot = -1;
            for (let i = 0; i < filterNode.inputs.length; i++) {
                if (filterNode.inputs[i].type ===graph_consts.MAP_STREAM && !filterNode.inputs[i].link) {
                    inputSlot = i;
                    break;
                }
            }
            
            if (inputSlot === -1) {
                // Add new input if needed
                filterNode.addInput("stream",graph_consts.MAP_STREAM);
                inputSlot = filterNode.inputs.length - 1;
            }
            
            streamSelector.connect(0, filterNode, inputSlot);
        }
    });
}

function createStreamSelectorForFilterOutput(outputLabel, graph) {
    const streamNode = LiteGraph.createNode("ffmpeg/stream selector");
    if (!streamNode) return null;
    
    streamNode.setProperty("Select by", "name");
    streamNode.setProperty("Name", outputLabel);
    graph.add(streamNode);
    
    return streamNode;
}

function createOutputNode(outputArgs, graph) {
    const outputNode = LiteGraph.createNode("ffmpeg/output");
    if (!outputNode) return null;
    
    let dstPath = "";
    let encoderV = "";
    let encoderA = "";
    let muxer = "";
    let general = [];

    // Parse output arguments
    for (let i = 0; i < outputArgs.length; i++) {
        const arg = outputArgs[i];
        
        if (isFilename(arg) && i === outputArgs.length - 1) {
            dstPath = arg;
        } else if (arg === "-c:v" && i + 1 < outputArgs.length) {
            encoderV = outputArgs[i + 1];
            i++;
        } else if (arg === "-c:a" && i + 1 < outputArgs.length) {
            encoderA = outputArgs[i + 1];
            i++;
        } else if (arg === "-f" && i + 1 < outputArgs.length) {
            muxer = outputArgs[i + 1];
            i++;
        } else if (arg === "-map" && i + 1 < outputArgs.length) {
            // Skip -map arguments as they're handled elsewhere
            i++;
        } else if (arg.startsWith("-")) {
            // Parse general parameter
            let hasValue = (i + 1 < outputArgs.length) && !outputArgs[i + 1].trim().startsWith('-') && (i + 1 != outputArgs.length - 1);
            let nameInfo = arg.split(/:(.*)/s);
            
            general.push({
                name: nameInfo[0],
                stream_spec: nameInfo.length > 1 ? `:${nameInfo[1]}` : "", 
                value: hasValue ? outputArgs[i + 1] : ""
            }); 
            
            if (hasValue) i++;
        }
    }
    
    // Set basic properties
    if (dstPath) outputNode.setProperty("dst_path", dstPath);
    graph.add(outputNode);
    
    // Keep track of nodes we create for this output
    const createdNodes = [outputNode];
    
    // Create and connect encoder/muxer nodes
    if (encoderV) {
        const encNode = findAndCreateCodecNode(encoderV, "encoder", LiteGraph.registered_node_types, graph);
        if (encNode) {
            encNode.connect(0, outputNode, 1); // enc:v input
            createdNodes.push(encNode);
        }
    }
    
    if (encoderA) {
        const encNode = findAndCreateCodecNode(encoderA, "encoder", LiteGraph.registered_node_types, graph);
        if (encNode) {
            encNode.connect(0, outputNode, 2); // enc:a input
            createdNodes.push(encNode);
        }
    }
    
    if (muxer) {
        const muxNode = findAndCreateFormatNode(muxer, "muxer", LiteGraph.registered_node_types, graph);
        if (muxNode) {
            muxNode.connect(0, outputNode, 3); // muxer input
            createdNodes.push(muxNode);
        }
    }
    
    // Handle general parameters
    let lastGlobalNode = null;
    for (const param of general) {
        const resultNode = handleGeneralParameter(param, createdNodes, LiteGraph.registered_node_types, graph);
        if (resultNode && !createdNodes.includes(resultNode)) {
            // This is a new global node
            if(lastGlobalNode) lastGlobalNode.connect(0, resultNode, 0);
            lastGlobalNode = resultNode;
            createdNodes.push(resultNode);
        }
    }
    
    // Connect the last global node to the output node's global input
    if (lastGlobalNode) {
        lastGlobalNode.connect(0, outputNode, 0);
    }
    
    return outputNode;
}

function connectOutputStreams(outputArgs, outputNode, streamSelectorMap, graph, inputNodes) {
    const explicitMaps = [];
    
    // Parse -map arguments to see what's explicitly mapped
    for (let i = 0; i < outputArgs.length; i++) {
        const arg = outputArgs[i];
        
        if (arg === "-map" && i + 1 < outputArgs.length) {
            const mapValue = outputArgs[i + 1];
            i++;
            explicitMaps.push(mapValue);
            
            // Find existing stream selector or create one
            let streamSelector = null;
            
            if (mapValue.startsWith("[") && mapValue.endsWith("]")) {
                // Filter output reference [label]
                const label = mapValue.slice(1, -1);
                streamSelector = streamSelectorMap.get(label);
            } else {
                // Input stream reference like "0:v", "1:a", etc.
                streamSelector = streamSelectorMap.get(mapValue);
            }
            
            // If no existing stream selector found, create one
            if (!streamSelector) {
                streamSelector = createStreamSelectorFromMap(mapValue, LiteGraph.registered_node_types, graph);
                if (streamSelector && !mapValue.startsWith("[")) {
                    // Connect to appropriate input node for non-filter references
                    const inputIndex = parseInt(mapValue.split(":")[0]) || 0;
                    if (inputNodes[inputIndex]) {
                        inputNodes[inputIndex].connect(0, streamSelector, 0);
                    }
                }
            }
            
            if (streamSelector) {
                // Connect stream selector to output
                let streamInputIndex = -1;
                for (let j = 0; j < outputNode.inputs.length; j++) {
                    if (outputNode.inputs[j].type ===graph_consts.MAP_STREAM && !outputNode.inputs[j].link) {
                        streamInputIndex = j;
                        break;
                    }
                }
                
                if (streamInputIndex === -1) {
                    outputNode.addInput("stream",graph_consts.MAP_STREAM);
                    streamInputIndex = outputNode.inputs.length - 1;
                }
                
                streamSelector.connect(0, outputNode, streamInputIndex);
            }
        }
    }
    
    // If no explicit -map arguments, create default stream selectors
    if (explicitMaps.length === 0) {
        // Create default video and audio stream selectors and connect them
        for (let i = 0; i < inputNodes.length; i++) {
            const defaultSelector = LiteGraph.createNode("ffmpeg/stream selector");
            if (defaultSelector) {
                defaultSelector.setProperty("Select by", "custom");
                graph.add(defaultSelector);
                inputNodes[i].connect(0, defaultSelector, 0);

            
                let streamInputIndex = outputNode.inputs.findIndex(input => 
                    input.type ===graph_consts.MAP_STREAM && !input.link);
                if (streamInputIndex === -1) {
                    outputNode.addInput("stream",graph_consts.MAP_STREAM);
                    streamInputIndex = outputNode.inputs.length - 1;
                }
                defaultSelector.connect(0, outputNode, streamInputIndex);
            }
        }   
    }
}

function processOutputOptions(outputArgs, outputNode, graph, nodes) {
    // Process other output options like -b, -s, -profile, etc.
    for (let i = 0; i < outputArgs.length; i++) {
        const arg = outputArgs[i];
        
        if (arg.startsWith("-") && !["-map", "-c:v", "-c:a", "-f", "-i"].includes(arg)) {
            const flagNode = findAndCreateFlagNode(arg, outputArgs[i + 1], LiteGraph.registered_node_types, graph);
            if (flagNode) {
                nodes.push(flagNode);
                
                if (outputArgs[i + 1] && !outputArgs[i + 1].startsWith("-")) {
                    flagNode.setProperty(flagNode.name, outputArgs[i + 1]);
                    i++;
                }
                
                // Connect to output node's global input
                flagNode.connect(0, outputNode, 0);
            }
        }
    }
}

function createNodesForSegment(parsed, segmentIndex, graph) {
    const nodes = [];
    const inputNodes = [];
    const filterNodes = [];
    const outputNodes = [];
    const streamSelectorMap = new Map();
    
    // Create input nodes
    parsed.inputs.forEach((inputArgs, inputIndex) => {
        const inputNode = createInputNode(inputArgs, graph);
        if (inputNode) {
            nodes.push(inputNode);
            inputNodes.push(inputNode);
        }
    });

    // Create filter nodes
    parsed.filters.forEach((filter, filterIndex) => {
        const filterNode = createFilterNode(filter, graph);
        if (filterNode) {
            nodes.push(filterNode);
            filterNodes.push(filterNode);
            
            // Create output stream selectors
            filter.inputs.forEach((inputLabel, inputIndex)=> {
                if (!streamSelectorMap.get(inputLabel)) { 
                    const streamNode = createStreamSelector(inputLabel, graph, inputNodes);
                    if (streamNode) {
                        nodes.push(streamNode);
                        streamSelectorMap.set(inputLabel, streamNode);
                    }
                }
            });

            // Connect filter inputs
            connectFilterInputs(filter, filterNode, streamSelectorMap, graph);
            
            // Create output stream selectors
            filter.outputs.forEach(outputLabel => {
                const streamNode = createStreamSelectorForFilterOutput(outputLabel, graph);
                if (streamNode) {
                    nodes.push(streamNode);
                    streamSelectorMap.set(outputLabel, streamNode);
                    // Connect filter to stream selector
                    filterNode.connect(0, streamNode, 0);
                }
            });
        }
    });

    // Create output nodes
    parsed.outputs.forEach((outputArgs, outputIndex) => {
        const outputNode = createOutputNode(outputArgs, graph);
        if (outputNode) {
            nodes.push(outputNode);
            outputNodes.push(outputNode);
            
            // Connect output streams - pass inputNodes for default connection logic
            connectOutputStreams(outputArgs, outputNode, streamSelectorMap, graph, inputNodes);
            
            // Handle output-specific options (encoders, muxers, etc.)
            processOutputOptions(outputArgs, outputNode, graph, nodes);
        }
    });

    return nodes;
}

function positionNodes(nodes, segmentIndex) {
    const startX = segmentIndex * 800;
    const startY = 50;
    const nodeWidth = 200;
    const nodeHeight = 150;
    const spacing = 50;
    
    nodes.forEach((node, index) => {
        if (node) {
            const row = Math.floor(index / 4);
            const col = index % 4;
            const x = startX + col * (nodeWidth + spacing);
            const y = startY + row * (nodeHeight + spacing);
            node.pos = [x, y];
        }
    });
}

function parseFFmpegCommand(cmd, graph) {
    // Remove the 'ffmpeg' prefix if present
    if (cmd.startsWith('ffmpeg ')) {
        cmd = cmd.substring(7);
    }
    
    // Split into segments if it's a piped command
    const segments = splitPipedFFmpeg(cmd);
    const allNodes = [];
    
    segments.forEach((segment, segmentIndex) => {
        const args = splitArgs(segment);
        const parsed = splitFFmpegArgs(args);
        
        // Create nodes for this segment
        const segmentNodes = createNodesForSegment(parsed, segmentIndex, graph);
        allNodes.push(...segmentNodes);
        
        // Position nodes for this segment
        positionNodes(segmentNodes, segmentIndex);
    });
    
    return allNodes;
}

export { parseFFmpegCommand };
