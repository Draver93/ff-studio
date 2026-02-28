// graph/import-export.js
// Import/export functionality and drag & drop handling

const { save } = window.__TAURI__.dialog;
const { writeTextFile, readTextFile } = window.__TAURI__.fs;
const { listen } = window.__TAURI__.event;
import { addLogEntry } from '../logs/logs.js';
import { graph } from './core.js';

function exportGraph() {
    const graph_data = JSON.stringify(graph.serialize());

    try {
        save({
            defaultPath: `workflow_${new Date().toISOString().replace(/[:.]/g, '-')}.ffgraph`,
            filters: [{ name: "Graph workflow", extensions: ["ffgraph"] }]
        }).then(function(filePath) {
            if (filePath) {
                writeTextFile(filePath, graph_data).then(function() {
                    addLogEntry('success', `Graph exported successfully: ${filePath}`);
                });
            } else {
                addLogEntry('warning', `Export cancelled by user.`);
            }
        });
    } catch (err) {
        addLogEntry('error', `Failed to export graph: ${err}`);
    }
}

function mergeGraphs(graphA, graphB, jitter = 200) {
    const offsetX = Math.floor(Math.random() * jitter);
    const offsetY = Math.floor(Math.random() * jitter);

    if (!graphA.nodes) graphA.nodes = [];
    if (!graphA.links) graphA.links = [];
    if (!graphB.nodes) graphB.nodes = [];
    if (!graphB.links) graphB.links = [];

    const idMap = {};
    let newId = (graphA.last_node_id || 0) + 1;
    let newLinkId = (graphA.links.length > 0 ? Math.max(...graphA.links.map(l => l[0])) : 0) + 1;

    // Remap nodes
    const newNodes = graphB.nodes.map(node => {
        const newNode = { ...node };
        idMap[node.id] = newId++;
        newNode.id = idMap[node.id];
        if (newNode.pos) newNode.pos = [newNode.pos[0] + offsetX, newNode.pos[1] + offsetY];

        // Remap links inside inputs
        if (newNode.inputs) {
            newNode.inputs = newNode.inputs.map(input => ({
                ...input,
                link: null // clear old links
            }));
        }

        // Remap links inside outputs
        if (newNode.outputs) {
            newNode.outputs = newNode.outputs.map(output => ({
                ...output,
                links: [] // clear old links
            }));
        }

        return newNode;
    });

    // Remap links and assign new link IDs
    const newLinks = (graphB.links || []).map(link => {
        const [, origin_id, origin_slot, target_id, target_slot, type] = link;
        const assignedId = newLinkId++;

        return [
            assignedId,
            idMap[origin_id],
            origin_slot,
            idMap[target_id],
            target_slot,
            type
        ];
    });

    // Update node outputs with correct link IDs
    newLinks.forEach(link => {
        const [link_id, origin_id, origin_slot, target_id, target_slot] = link;
        const originNode = newNodes.find(n => n.id === origin_id);
        if (originNode && originNode.outputs && originNode.outputs[origin_slot]) {
            originNode.outputs[origin_slot].links.push(link_id);
        }
        const targetNode = newNodes.find(n => n.id === target_id);
        if (targetNode && targetNode.inputs && targetNode.inputs[target_slot] !== undefined) {
            targetNode.inputs[target_slot].link = link_id;
        }
    });

    return {
        ...graphA,
        nodes: [...graphA.nodes, ...newNodes],
        links: [...graphA.links, ...newLinks],
        last_node_id: Math.max(graphA.last_node_id || 0, ...newNodes.map(n => n.id)),
        last_link_id: newLinkId - 1
    };
}

function initializeImportExport() {
    let hideModalTimeout;
    const HIDE_DELAY = 1000;
    const importModal = document.getElementById('import-modal');

    // Drag and drop file handling
    listen("tauri://drag-drop", (event) => {
        importModal.style.display = "none";
        if (hideModalTimeout) {
            clearTimeout(hideModalTimeout);
            hideModalTimeout = null;
        }

        if (!event.payload.paths || event.payload.paths.length === 0) return;
        if (event.payload.paths.length > 1) {
            addLogEntry("error", "Caught error: Allowed only one file per import!");
            return;
        }
        if (!event.payload.paths[0].endsWith(".ffgraph")) {
            addLogEntry("error", "Caught error: Unknown file extension. '.ffgraph' required!");
            return;
        }
        if (!window.selectedWorkflow) {
            addLogEntry("error", "Caught error: No workflow selected. Please create or select a workflow before importing a graph.");
            return;
        }

        try {
            readTextFile(event.payload.paths[0]).then(function(content) {
                graph.configure(mergeGraphs(graph.serialize(), JSON.parse(content)));
                addLogEntry("success", "Graph successfully imported!");
                // Reset undo/redo history for the newly loaded graph
                if (window.__GRAPH_UNDO_MGR__) {
                    window.__GRAPH_UNDO_MGR__.resetHistory();
                }
            });
        } catch (error) {
            addLogEntry("error", "Caught error:" + error);
        }
    });

    // Drag over handling
    listen("tauri://drag-over", (event) => {
        importModal.style.display = 'flex';
        
        if (hideModalTimeout) clearTimeout(hideModalTimeout);
        hideModalTimeout = setTimeout(() => {
            importModal.style.display = "none";
        }, HIDE_DELAY);
    });

    // Drag leave handling
    listen("tauri://drag-leave", () => {
        importModal.style.display = 'none';
        if (hideModalTimeout) {
            clearTimeout(hideModalTimeout);
            hideModalTimeout = null;
        }
    });
}

export { mergeGraphs, exportGraph, initializeImportExport };