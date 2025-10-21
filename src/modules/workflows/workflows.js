import { addLogEntry } from '../logs/logs.js';
import { showLoading, hideLoading, updateLoadingProgress, updateLoadingDetails } from '../ui/loading.js';
import { showAddModal, showEditModal, hideModal, resetForm } from '../ui/modal.js';
import { exportGraph } from '../graph/import_export.js';
import { make_nodes, make_io_nodes } from '../graph/nodes.js';
import { graph, updateCanvasVisibility } from '../graph/core.js';

const { listen, once } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

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
                <button class="action-btn export" title="Export" style="display:none"><i class="fas fa-file-export"></i></button>
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
    if(select) selectWorkflow(name);
    return true;
}


// listen
listen('get_workflow_listener', (event) => {
    LiteGraph.clearRegisteredTypes();
    graph.configure("{}");

    clearInterval(window.loadingInterval);
    updateLoadingProgress(100);
    updateLoadingDetails('Initializing FFmpeg Graph...<br>Complete');
    // Simulate cancellation delay
    setTimeout(() => {
        //It's just bad
        allow_skip = true;
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
    if(data["graph"]) graph.configure(JSON.parse(data["graph"]));
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
        } else {
            item.querySelector('.action-btn.edit').style.display = "none";
            item.querySelector('.action-btn.save').style.display = "none";
            item.querySelector('.action-btn.export').style.display = "none";
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
    showLoading("Switching workflow!", false, false);
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
        make_nodes(data);
        make_io_nodes();
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
