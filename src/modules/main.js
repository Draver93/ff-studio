import * as player from './player/player.js';
import * as workflows from './workflows/workflows.js';
import * as logs from './logs/logs.js';
import * as graph from './graph/graph.js';
const { invoke } = window.__TAURI__.core;


// No spam clicking!
document.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;

    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 350);
});

// No autofill for you
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input, textarea, select').forEach(el => {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
  });
});

// No contex for you
const appContainer = document.getElementById('app-container');
appContainer.addEventListener('contextmenu', function (e) { e.preventDefault(); });

window.addEventListener('resize', function () { });

// Initialize graph
graph.initializeGraph();

// Initialize logs
logs.initLogs();

// Initialize player
player.initPlayer();

// Initialize workflows
workflows.initWorkflows();

// Tab switching functionality
const tabs = document.querySelectorAll('.tab');
const graphZone = document.getElementById('graph-zone');
const playerZone = document.getElementById('player-zone');
const queueZone = document.getElementById('queue-zone');
const logsZone = document.getElementById('logs-zone');
const errorBadge = document.getElementById('error-badge');
const version_full = document.querySelector('.version-full #vf-text');
const version_short = document.querySelector('.version-short #vs-text');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        graphZone.style.display = 'none';
        playerZone.style.display = 'none';
        logsZone.style.display = 'none';
        queueZone.style.display = 'none';
        const tabType = tab.getAttribute('data-tab');
        if (tabType === 'graph') {
            graphZone.style.display = 'block';
        } else if (tabType === 'player') {
            playerZone.style.display = 'flex';
        } else if (tabType === 'queue') {
            queueZone.style.display = 'flex';
        } else if (tabType === 'logs') {
            logsZone.style.display = 'flex';
            errorBadge.style.display = "none";
        }
    });
});

// Set initial active tab
document.querySelector('.tab.active').click();

// Sidebar collapse functionality
const sidebar = document.getElementById('right-sidebar');
const collapseBtn = document.getElementById('collapse-btn');
collapseBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    collapseBtn.innerHTML = sidebar.classList.contains('collapsed') ? 
        '<i class="fas fa-chevron-left"></i>' : 
        '<i class="fas fa-chevron-right"></i>';
});

async function getAppVersion() {
    return await invoke('app_version', { });
}
getAppVersion().then((ver) => {
    version_full.textContent = ver;
    version_short.textContent = `v${ver}`;
});