const NODE_WIDTH = 210;
const NODE_HEIGHT = 100;
const HORIZONTAL_SPACING = 250;
const VERTICAL_SPACING = 150;
const MARGIN = 50;

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

export { arrangeNodes };
