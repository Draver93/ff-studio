import { addNewWorkflow, selectWorkflow } from '../workflows/workflows.js';
import { showLoading, hideLoading, updateLoadingProgress, updateLoadingDetails } from './loading.js';
import { make_nodes, make_io_nodes } from '../graph/nodes.js';
import { canvas, graph } from '../graph/core.js';

const { invoke } = window.__TAURI__.core;
const { once } = window.__TAURI__.event;


// Modal event listeners
const addBtn = document.getElementById('add-workflow-btn');
const cancelBtn = document.getElementById('cancel-btn');
addBtn.addEventListener('click', () => { showAddModal(); });
cancelBtn.addEventListener('click', () => { hideModal(); });

// Loading modal event listeners
const loadingModal = document.getElementById('loading-modal');
loadingModal.addEventListener('click', (e) => {
    if (e.target === loadingModal) {
        hideLoading();
    }
});

document.getElementById("workflow-name").addEventListener("input", function(e) {
    this.value = this.value.replace(/[^A-Za-z0-9_-]/g, "");
});

export function showAddModal() {
    const modal = document.getElementById('workflow-modal');
    modal.style.display = 'block';
    let modal_title = document.getElementById('modal-title');
    modal_title.innerHTML = "Create New Workflow";
    const okBtn = document.getElementById('ok-btn');
    okBtn.innerHTML = "Add Workflow";
    okBtn.onclick = function (e) {
        e.preventDefault();
        const name = document.getElementById('workflow-name').value;
        const path = document.getElementById('ffmpeg-path').value;
        const env = document.getElementById('env-vars').value;
        const desc = document.getElementById('workflow-desc').value;
        let isValid = true;
        if (!name) {
            document.getElementById('name-error').style.display = 'block';
            document.getElementById('workflow-name').classList.add('error');
            isValid = false;
        } else {
            document.getElementById('name-error').style.display = 'none';
            document.getElementById('workflow-name').classList.remove('error');
        }
        if (!path) {
            document.getElementById('path-error').style.display = 'block';
            document.getElementById('ffmpeg-path').classList.add('error');
            isValid = false;
        } else {
            document.getElementById('path-error').style.display = 'none';
            document.getElementById('ffmpeg-path').classList.remove('error');
        }
        if (isValid) {
            if(addNewWorkflow(name, path)) {
                // listen
                once('create_workflow_listener', (event) => {
                    let data = event.payload;
                    clearInterval(window.workflowCreationInterval);

                    LiteGraph.clearRegisteredTypes();
                    graph.configure("{}");
                    
                    canvas.ds.offset = [0, 0];
                    canvas.ds.scale = 1;

                    make_nodes(data["nodes"]);
                    make_io_nodes();

                    selectWorkflow(name);

                    hideLoading();
                });

                // Simulate processing steps
                let progress = 0;
                window.workflowCreationInterval = setInterval(() => {
                    progress += Math.random() * ((75 - progress) / 8.0);
                    if(progress <= 0) progress = 1;
                    updateLoadingProgress(progress);
                }, 600);

                updateLoadingDetails('Parsing FFmpeg...<br>Estimated time: Calculating...');
                showLoading("Litegraph configuring", false, false);
                invoke('create_workflow', {name: name, path: path, env: env, desc: desc });
                resetForm();
            }
            modal.style.display = 'none';
        }
    };
}

export function showEditModal() {
    const modal = document.getElementById('workflow-modal');
    modal.style.display = 'block';
    let workflow_name = document.getElementById('workflow-name');
    workflow_name.disabled = true;
    let modal_title = document.getElementById('modal-title');
    modal_title.innerHTML = "Edit Workflow";
    const okBtn = document.getElementById('ok-btn');
    okBtn.innerHTML = "Edit Workflow";
    okBtn.onclick = function (e) {
        const name = document.getElementById('workflow-name').value;
        const path = document.getElementById('ffmpeg-path').value;
        const env = document.getElementById('env-vars').value;
        const desc = document.getElementById('workflow-desc').value;
        hideModal();
        invoke('edit_workflow', {name: name, path: path, env: env, desc: desc});
        const workflowItem = document.querySelector(`.workflow-item[data-workflow="${name}"]`);
        if (!workflowItem) return null;
        workflowItem.querySelector('.workflow-path').innerHTML = path;
    };
}

export function hideModal() {
    const modal = document.getElementById('workflow-modal');
    let workflow_name = document.getElementById('workflow-name');
    workflow_name.disabled = false;
    modal.style.display = 'none';
    resetForm();
}

export function resetForm() {
    const workflowForm = document.getElementById('workflow-form');
    workflowForm.reset();
    document.querySelectorAll('.error-message').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('.form-input.error').forEach(el => {
        el.classList.remove('error');
    });
}
