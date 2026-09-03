import { addLogEntry } from '../logs/logs.js';
import { showLoading, hideLoading, updateLoadingProgress, updateLoadingDetails } from '../ui/loading.js';
import { showAddModal, showEditModal, hideModal, resetForm } from '../ui/modal.js';
import { exportGraph, importGraph } from '../graph/import_export.js';
import { make_nodes, make_io_nodes, make_control_node } from '../graph/nodes.js';
import { graph, canvas, updateCanvasVisibility } from '../graph/core.js';
import { GraphUndoManager } from '../graph/undo_redo.js';

const { listen, once } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

// Default preset graph loaded for newly created workflows (input -> video/audio
// stream selectors -> output). Stored in the graph.configure() serialized format
// so both positions and connections are applied exactly.
const DEFAULT_GRAPH = {
  "last_node_id":11,"last_link_id":15,
  "nodes":[
    {"id":8,"type":"ffmpeg/input","pos":[39,353],"size":[210,166],"flags":{},"order":0,"mode":0,"inputs":[{"name":"globals","type":"ioopt","link":null},{"name":"dec:v","type":"dec","link":null},{"name":"dec:a","type":"dec","link":null},{"name":"demuxer","type":"fmt","link":null}],"outputs":[{"name":"n-streams","type":"streams","links":[8,9],"slot_index":0}],"title":"IN","properties":{"src_path":"your_input.mov"},"widgets_values":["your_input.mov","",""],"mediaInfoText":"","mediaInfoLines":[]},
    {"id":11,"type":"ffmpeg/output","pos":[788,245],"size":{"0":210,"1":202},"flags":{},"order":3,"mode":0,"inputs":[{"name":"globals","type":"ioopt","link":null},{"name":"enc:v","type":"enc","link":null},{"name":"enc:a","type":"enc","link":null},{"name":"muxer","type":"fmt","link":null},{"name":"stream","type":"maps","link":14},{"name":"stream","type":"maps","link":15},{"name":"stream","type":"maps","link":null}],"title":"OUT","properties":{"dst_path":"desire_output.mp4"},"widgets_values":["desire_output.mp4",""]},
    {"id":9,"type":"ffmpeg/stream selector","pos":[410,256],"size":{"0":210,"1":106},"flags":{},"order":1,"mode":0,"inputs":[{"name":"n-streams","type":"streams","link":8}],"outputs":[{"name":"stream","type":"maps","links":[14],"slot_index":0}],"properties":{"Select by":"type","Type":"video","Id":""},"widgets_values":["type","video",""]},
    {"id":10,"type":"ffmpeg/stream selector","pos":[408,446],"size":{"0":210,"1":106},"flags":{},"order":2,"mode":0,"inputs":[{"name":"n-streams","type":"streams","link":9,"slot_index":0}],"outputs":[{"name":"stream","type":"maps","links":[15],"slot_index":0}],"properties":{"Select by":"type","Type":"audio","Id":""},"widgets_values":["type","audio",""]}
  ],
  "links":[[8,8,0,9,0,"streams"],[9,8,0,10,0,"streams"],[14,9,0,11,4,"maps"],[15,10,0,11,5,"maps"]],
  "groups":[],"config":{},"extra":{},"version":0.4
};

// Inject the default preset graph into the current (empty) graph by configuring
// it directly, preserving exact node positions and connections.
export function injectDefaultGraph() {
    graph.configure(DEFAULT_GRAPH);
}

// Serialize the current graph into a persisted string for the given workflow.
export function defaultGraphString() {
    return JSON.stringify(graph.serialize());
}

export function addNewWorkflow(name, path, select = false) {
    let workflowItems = document.querySelectorAll('.workflow-item');
    for (const item of workflowItems) {
        const itemId = item.getAttribute('data-workflow');
        if(itemId === name) {
            addLogEntry('error', `A workflow with this name already exists`);
            return false;
        }
    }
    const workflowsContainer = document.querySelector('.workflows-container');
    const newWorkflow = document.createElement('div');
    newWorkflow.className = 'workflow-item';
    newWorkflow.setAttribute('data-workflow', name);
    newWorkflow.innerHTML = `
        <div class="workflow-header">
            <span class="workflow-name">${name}</span>
            <div class="workflow-actions">
                <button class="action-btn edit" title="Edit" style="display:none"><i class="fas fa-pen"></i></button>
                <button class="action-btn save" title="Save" style="display:none"><i class="fas fa-save"></i></button>
                <button class="action-btn export" title="Export .ffgraph" style="display:none"><i class="fas fa-file-export"></i></button>
                <button class="action-btn import" title="Import .ffgraph" style="display:none"><i class="fas fa-file-import"></i></button>
                <div> </div>
                <button class="action-btn delete" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
        </div>
        <div class="workflow-details">
            <span class="workflow-path">${path}</span>
        </div>
    `;
    workflowsContainer.appendChild(newWorkflow);
    const workflowIcons = document.querySelector('.workflow-icons');
    const newIcon = document.createElement('div');
    newIcon.className = 'workflow-icon';
    newIcon.setAttribute('data-workflow', name);
    newIcon.setAttribute('data-tooltip', name);
    newIcon.innerHTML = '<i class="fas fa-film"></i>';
    workflowIcons.appendChild(newIcon);
    newWorkflow.addEventListener('click', () => { selectWorkflow(name); });
    newIcon.addEventListener('click', () => { selectWorkflow(name); });
    newWorkflow.querySelector('.action-btn.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteWorkflow(name);
    });
    newWorkflow.querySelector('.action-btn.save').addEventListener('click', (e) => {
        e.stopPropagation();
        saveWorkflow(name);
    });
    newWorkflow.querySelector('.action-btn.edit').addEventListener('click', (e) => {
        e.stopPropagation();
        editWorkflow(name);
    });
    newWorkflow.querySelector('.action-btn.export').addEventListener('click', (e) => {
        e.stopPropagation();
        exportGraph();
    });
    newWorkflow.querySelector('.action-btn.import').addEventListener('click', (e) => {
        e.stopPropagation();
        importGraph();
    });
    if(select) selectWorkflow(name);
    return true;
}


// listen
listen('get_workflow_listener', (event) => {
    LiteGraph.clearRegisteredTypes();
    graph.configure("{}");
    canvas.ds.offset = [0, 0];
    canvas.ds.scale = 1;

    clearInterval(window.loadingInterval);
    updateLoadingProgress(100);
    updateLoadingDetails('Initializing FFmpeg Graph...<br>Complete');
    // Simulate cancellation delay
    setTimeout(() => {
        hideLoading();
    }, 800);

    let data = event.payload;
    if(data.message !== "OK") {
        window.FFMPEG_BIN = "";
        window.FFMPEG_ENV = "";

        addLogEntry('error', data.message);
        return;
    }

    window.FFMPEG_BIN = data.path;
    window.FFMPEG_ENV = data.env;

    make_nodes(data["nodes"]);
    make_io_nodes();
    make_control_node();
    if(data["graph"]) graph.configure(JSON.parse(data["graph"]));

    // Reset undo history when loading new workflow
    if (window.__GRAPH_UNDO_MGR__) {
        window.__GRAPH_UNDO_MGR__.resetHistory();
    }
});

export async function selectWorkflow(name) {
    if(window.selectedWorkflow === undefined) window.selectedWorkflow = '';
    if(name === window.selectedWorkflow) {
        addLogEntry('warning', `Workflow "${name}" already selected`);
        return;
    }
    if(window.timeline) window.timeline.reset();
    invoke('delete_cache_request', {});
    let workflowItems = document.querySelectorAll('.workflow-item');
    let workflowIcons = document.querySelectorAll('.workflow-icon');
    window.selectedWorkflow = name;
    workflowItems.forEach(item => {
        if (item.getAttribute('data-workflow') === name) {
            item.classList.add('selected');
            item.querySelector('.action-btn.edit').style.display = "block";
            item.querySelector('.action-btn.save').style.display = "block";
            item.querySelector('.action-btn.export').style.display = "block";
            item.querySelector('.action-btn.import').style.display = "block";
        } else {
            item.querySelector('.action-btn.edit').style.display = "none";
            item.querySelector('.action-btn.save').style.display = "none";
            item.querySelector('.action-btn.export').style.display = "none";
            item.querySelector('.action-btn.import').style.display = "none";
            item.classList.remove('selected');
        }
    });
    workflowIcons.forEach(icon => {
        if (icon.getAttribute('data-workflow') === name) {
            icon.classList.add('selected');
        } else {
            icon.classList.remove('selected');
        }
    });
    showLoading("Switching workflow!", false);
    let progress = 0;
    window.loadingInterval = setInterval(() => {
        progress += Math.random() * ((75 - progress) / 8.0);
        if(progress <= 0) progress = 1;
        updateLoadingProgress(progress);
    }, 600);
    updateLoadingDetails('Initializing FFmpeg Graph...<br>Estimated time: Calculating...');
    invoke('get_workflow', {name: name});
    addLogEntry('info', `Switched to "${name}" workflow`);
    updateCanvasVisibility();
}

export function deleteWorkflow(name) {
    let workflowItems = document.querySelectorAll('.workflow-item');
    let workflowIcons = document.querySelectorAll('.workflow-icon');
    let next_workflow = '';
    if(name !== window.selectedWorkflow) next_workflow = window.selectedWorkflow;
    else {
        window.selectedWorkflow = '';
        if(graph) graph.configure("{}");
        canvas.ds.offset = [0, 0];
        canvas.ds.scale = 1;
    }
    workflowItems.forEach(item => { 
        if( item.getAttribute('data-workflow') === name ) 
            item.remove();  
        else {
            if(!next_workflow) next_workflow = item.getAttribute('data-workflow');
        }
    });
    workflowIcons.forEach(item => { if( item.getAttribute('data-workflow') === name ) item.remove(); });
    invoke('delete_workflow', {name: name});
    if(next_workflow && next_workflow !== window.selectedWorkflow) selectWorkflow(next_workflow);
    updateCanvasVisibility();
}

export function saveWorkflow(name) {
    once('save_graph_listener', (event) => {
        addLogEntry('success', `Graph successfuly saved for:  "${name}" workflow`);
        hideLoading();
    });
    let graph_str = JSON.stringify(graph ? graph.serialize() : {});
    invoke('save_graph', {name: name, graph: graph_str});
    showLoading();
}

export async function editWorkflow(name) {
    once('get_workflow_listener', (event) => {
        let data = event.payload;
        let workflow_name = document.getElementById('workflow-name');
        let env_vars = document.getElementById('env-vars');
        let ffmpeg_path = document.getElementById('ffmpeg-path');
        let workflow_desc = document.getElementById('workflow-desc');
        workflow_name.value = name;
        ffmpeg_path.value = data["path"];
        env_vars.value = data["env"];
        workflow_desc.value = data["desc"];
        showEditModal();
    });
    invoke('get_workflow', {name: name});
}

export async function reconfig_graph(path) {
    once('get_nodes_listener', (event) => {
        let data = event.payload;
        if(window.LiteGraph) window.LiteGraph.clearRegisteredTypes();
        if(graph) graph.configure("{}");
        canvas.ds.offset = [0, 0];
        canvas.ds.scale = 1;
        
        make_nodes(data);
        make_io_nodes();
        make_control_node();
        addLogEntry('info', `Succesfuly reconfigured litegraph for: ` + path);
        hideLoading();
    });
    updateLoadingDetails("Trying as fast as possible!");
    invoke('get_nodes_request', {ffmpeg_path: path});
}

export async function initWorkflows() {
    let workflowItems = document.querySelectorAll('.workflow-item');
    let workflowIcons = document.querySelectorAll('.workflow-icon');
    workflowItems.forEach(item => { item.remove(); });
    workflowIcons.forEach(item => { item.remove(); });
    let data = await invoke('get_workflow_list');
    let first = true;
    data.forEach(item => {
        addNewWorkflow(item["name"], item["path"], first);
        first = false;
    });
    // Handle workflow selection in expanded sidebar
    workflowItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't select if clicking on action buttons
            if (e.target.closest('.workflow-actions')) return;
            
            const name = item.getAttribute('data-workflow');
            selectWorkflow(name);
        });
    });

    // Handle workflow selection in collapsed sidebar
    workflowIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            const name = icon.getAttribute('data-workflow');
            selectWorkflow(name);
        });
    });
}
