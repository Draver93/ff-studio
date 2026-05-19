const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { textToPastelColor } from '../core/format.js';
import { addLogEntry } from '../logs/logs.js';
import { ERROR_REGEX, WARNING_REGEX, PROGRESS_REGEX } from './constants.js';


const queueContent = document.querySelector('.queue-content');
let queueJobs = new Map(); // Store job data by ID
let watchEntries = new Map(); // Store watchfolder entries by ID

export function initializeQueue() {
    // Queue controls
    const queueClearBtn = document.getElementById('queue-zone-clear');
    queueClearBtn.addEventListener('click', (e) => {
        clearCompletedJobs();
    });
    const queueStopBtn = document.getElementById('queue-zone-stop');
    queueStopBtn.addEventListener('click', (e) => {
        cancelAllJobs();
    });
    const queueConcurrencyInput = document.getElementById('queue-concurrency');
    const queueConcurrencyBtn = document.getElementById('queue-concurrency-set');
    
    // Load current concurrency setting
    invoke('get_max_concurrent').then(max => {
        queueConcurrencyInput.value = max;
    });

    queueConcurrencyBtn.addEventListener('click', (e) => {
        const value = parseInt(queueConcurrencyInput.value);
        if (value && value > 0) {
            setMaxConcurrent(value);
        }
    });

    // Listen for queue status changes
    listen('queue_status_changed', (event) => {
        updateQueueDisplay(event.payload);
        refreshTrayMenu();
    });

    // Listen for watchfolder status changes
    listen('watch_status_changed', (event) => {
        updateWatchDisplay(event.payload);
        refreshTrayMenu();
    });

    // Listen for tray menu cancel all
    listen('tray_cancel_all', () => {
        cancelAllJobs();
    });

    // Initial load
    refreshQueueStatus();

    // Auto-refresh every 2 seconds
    setInterval(refreshQueueStatus, 2000);
}

async function refreshQueueStatus() {
    let jobs = [];
    let watches = [];
    try {
        jobs = await invoke('get_queue_status');
        updateQueueDisplay(jobs);
    } catch (err) {
        console.error('Failed to refresh queue:', err);
    }
    try {
        watches = await invoke('get_watchfolders');
        updateWatchDisplay(watches);
    } catch (err) {
        // Silently ignore - watchfolder may not be available
    }
    updateTrayMenu(jobs, watches);
}

let lastQueueText = '';
let lastWfText = '';
let menuDebounce = null;

function pushTrayMenu(queueText, wfText) {
    if (queueText === lastQueueText && wfText === lastWfText) return;
    lastQueueText = queueText;
    lastWfText = wfText;
    if (menuDebounce) clearTimeout(menuDebounce);
    menuDebounce = setTimeout(() => {
        invoke('update_tray_menu', { queueText, wfText });
        menuDebounce = null;
    }, 400);
}

function updateTrayMenu(jobs, watches) {
    const runningCount = jobs.filter(j => j.status === 'Running').length;
    const queuedCount = jobs.filter(j => j.status === 'Queued').length;
    const wfCount = watches.length;

    let queueText = 'Queue: idle';
    if (runningCount > 0 || queuedCount > 0) {
        queueText = `Queue: ${runningCount} running, ${queuedCount} queued`;
    }

    let wfText = 'Watchfolder: idle';
    if (wfCount > 0) {
        wfText = `Watchfolder: ${wfCount} active`;
    }

    pushTrayMenu(queueText, wfText);
}

function refreshTrayMenu() {
    let runningCount = 0;
    let queuedCount = 0;
    for (const [, entry] of queueJobs) {
        if (entry.status === 'Running') runningCount++;
        if (entry.status === 'Queued') queuedCount++;
    }
    const wfCount = watchEntries.size;

    let queueText = 'Queue: idle';
    if (runningCount > 0 || queuedCount > 0) {
        queueText = `Queue: ${runningCount} running, ${queuedCount} queued`;
    }

    let wfText = 'Watchfolder: idle';
    if (wfCount > 0) {
        wfText = `Watchfolder: ${wfCount} active`;
    }

    pushTrayMenu(queueText, wfText);
}

function updateQueueDisplay(jobs) {
    // Update or add job entries
    jobs.forEach(job => {
        let entry = queueJobs.get(job.id);
        
        if (!entry) {
            // Create new entry
            entry = createJobEntry(job);
            queueJobs.set(job.id, entry);
            queueContent.appendChild(entry.element);
        } else {
            // Update existing entry
            updateJobEntry(entry, job);
        }
    });

    // Jobs that are no longer in the queue have already completed/failed
    // Don't modify their status here - it was set by the event listener

    // Update badge count
    const badge = document.querySelector('.queue-badge');
    const runningCount = jobs.filter(j => j.status === 'Running').length;
    const queuedCount = jobs.filter(j => j.status === 'Queued').length;
    if (badge) {
        badge.textContent = `${runningCount} running, ${queuedCount} queued`;
    }
    
    // Update tab badge
    updateQueueTabBadge(runningCount, queuedCount);

    // Update tray icon status
    updateTrayStatus(jobs);
}

function updateTrayStatus(jobs) {
    const running = jobs.some(j => j.status === 'Running');
    const queued = jobs.some(j => j.status === 'Queued');
    const watching = watchEntries.size > 0;
    const color = running ? 'green' : queued ? 'blue' : watching ? 'blue' : 'gray';
    invoke('set_tray_status', { color });
}

function updateWatchDisplay(watches) {
    const currentIds = new Set(watches.map(w => `watch-${w.id}`));

    // Remove watch entries that are no longer active
    for (const [id, entry] of watchEntries.entries()) {
        if (!currentIds.has(id)) {
            entry.element.remove();
            watchEntries.delete(id);
        }
    }

    // Add or update watch entries
    watches.forEach(w => {
        const key = `watch-${w.id}`;
        let entry = watchEntries.get(key);

        if (!entry) {
            entry = createWatchEntry(w);
            watchEntries.set(key, entry);
            // Insert at the top of the queue
            if (queueContent.firstChild) {
                queueContent.insertBefore(entry.element, queueContent.firstChild);
            } else {
                queueContent.appendChild(entry.element);
            }
        } else {
            updateWatchEntry(entry, w);
        }
    });
}

function createWatchEntry(watch) {
    const entry = document.createElement('div');
    entry.className = 'queue-entry watch-entry';
    entry.dataset.watchId = watch.id;

    const time = new Date().toLocaleTimeString();
    const statusClass = watch.status === 'Watching' ? 'status-watching' : 'status-paused';

    // Build workflow tag if available
    let workflowHTML = '';
    if (watch.workflow) {
        const baseColor = textToPastelColor(watch.workflow);
        const hslMatch = baseColor.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/);
        let bgColor = baseColor;
        let borderColor = baseColor;
        if (hslMatch) {
            const [_, h, s, l] = hslMatch.map(Number);
            bgColor = `hsla(${h}, ${s}%, ${Math.max(0, l - 20)}%, 0.15)`;
            borderColor = `hsla(${h}, ${s}%, ${Math.max(0, l - 15)}%, 0.4)`;
        }
        workflowHTML = `
            <span class="queue-workflow" style="border:1px solid ${borderColor};background:${bgColor};color:${baseColor}">
                ${watch.workflow}
            </span>
        `;
    }

    entry.innerHTML = `
        <div class="queue-entry-header">
            <span class="queue-time">${time}</span>
            <div class="queue-status-group">
                <span class="queue-status ${statusClass}">
                    <i class="fas fa-eye"></i>
                    ${watch.status}
                </span>
            </div>
            <span class="queue-id">W-${watch.id}</span>
            <div class="queue-meta">
                <span class="queue-tag queue-tag-watchfolder">watchfolder</span>
                ${workflowHTML}
            </div>
        </div>
        <div class="queue-entry-progress">
            <span class="progress-text" style="font-size: 11px; color: var(--text-secondary);">
                <i class="fas fa-folder-open"></i> ${watch.watch_dir} (${watch.pattern})
            </span>
        </div>
        <div class="queue-entry-info" style="display: flex;">
            <i class="fas fa-arrow-right"></i>
            <span class="info-text">→ ${watch.output_dir}/${watch.output_name} | Files queued: ${watch.files_queued}</span>
        </div>
        <div class="queue-entry-actions">
            <button class="watch-stop-btn" data-watch-id="${watch.id}">
                <i class="fas fa-stop"></i> Stop
            </button>
        </div>
    `;

    // Stop button listener
    const stopBtn = entry.querySelector('.watch-stop-btn');
    stopBtn.addEventListener('click', () => {
        stopWatch(watch.id);
    });

    return {
        element: entry,
        id: watch.id,
        key: `watch-${watch.id}`,
    };
}

function updateWatchEntry(entry, watch) {
    const statusSpan = entry.element.querySelector('.queue-status');
    const statusClass = watch.status === 'Watching' ? 'status-watching' : 'status-paused';
    statusSpan.className = `queue-status ${statusClass}`;
    statusSpan.innerHTML = `<i class="fas fa-eye"></i> ${watch.status}`;

    const infoText = entry.element.querySelector('.info-text');
    infoText.textContent = `${watch.output_dir}/${watch.output_name} | Files found: ${watch.files_queued}`;
}

async function stopWatch(id) {
    try {
        const result = await invoke('stop_watchfolder', { id });
        if (result) {
            addLogEntry('info', `Watch folder ${id} stopped`);
        }
    } catch (err) {
        addLogEntry('error', `Failed to stop watch folder: ${err}`);
    }
}

function updateQueueTabBadge(runningCount, queuedCount) {
    const queueTab = document.querySelector('.tab[data-tab="queue"]');
    if (!queueTab) return;
    
    const badge = queueTab.querySelector('.queue-badge');
    const icon = queueTab.querySelector('.queue-icon');
    if (!badge || !icon) return;
    
    const totalActive = runningCount + queuedCount;
    const oldValue = parseInt(badge.textContent) || 0;
    
    badge.textContent = totalActive;
    
    // Update icon based on running state
    if (runningCount > 0) {
        // Switch to spinner
        icon.className = 'queue-icon fas fa-spinner fa-spin';
    } else {
        // Switch back to list
        icon.className = 'queue-icon fas fa-list';
    }
    
    // Update states
    queueTab.classList.toggle('has-jobs', totalActive > 0);
    queueTab.classList.toggle('running', runningCount > 0);
    
    // Pulse animation for any count change
    if (oldValue !== totalActive) {
        badge.classList.remove('pulse');
        void badge.offsetWidth;
        badge.classList.add('pulse');
        
        setTimeout(() => badge.classList.remove('pulse'), 400);
    }
}

function createJobEntry(job) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'queue-entry';
    entry.dataset.jobId = job.id;
    
    const statusClass = getStatusClass(job.status);
    const icon = getStatusIcon(job.status);
    
    // Parse description if available
    let descData = {};
    try {
        if (job.desc) {
            descData = typeof job.desc === 'string' ? JSON.parse(job.desc) : job.desc;
        }
    } catch (e) {
        console.warn('Failed to parse job description:', e);
    }
    
    // Build tag elements from tags array
    const tags = descData.tags || (descData.tag ? [descData.tag] : []);
    const tagsHTML = tags.map(t => `
        <span class="queue-tag queue-tag-${t.replace(' ', '-')}">${t}</span>
    `).join('');
    
    // Build workflow element if available
    let workflowHTML = ``;
    if (descData.workflow) {
        const baseColor = textToPastelColor(descData.workflow); 
        
        // Extract H, S, L from HSL
        const hslMatch = baseColor.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/);
        let bgColor = baseColor;
        let borderColor = baseColor;

        if (hslMatch) {
            const [_, h, s, l] = hslMatch.map(Number);
            bgColor = `hsla(${h}, ${s}%, ${Math.max(0, l - 20)}%, 0.15)`; // darker, transparent background
            borderColor = `hsla(${h}, ${s}%, ${Math.max(0, l - 15)}%, 0.4)`; // darker, semi-transparent border
        }
        workflowHTML = `
            <span 
            class="queue-workflow" 
            style="
                border: 1px solid ${borderColor};
                background: ${bgColor};
                color: ${baseColor};
            "
            >
            ${descData.workflow}
            </span>
        `;
    }
    
    // Build command button if available
    const cmdHTML = descData.cmd ? `
        <button class="queue-cmd-btn" data-cmd="${escapeHtml(descData.cmd)}" title="Click to copy command">
            <i class="fas fa-terminal"></i>
        </button>
    ` : '';
    
    entry.innerHTML = `
        <div class="queue-entry-header">
            <span class="queue-time">${time}</span>
            <div class="queue-status-group">
                <span class="queue-status ${statusClass}">
                    <i class="${icon}"></i>
                    ${job.status}
                </span>
                ${cmdHTML}
            </div>
            <span class="queue-id">${job.id}</span>
            <div class="queue-meta">
                ${tagsHTML}
                ${workflowHTML}
            </div>
        </div>
        <div class="queue-entry-progress">
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <span class="progress-text">Waiting...</span>
        </div>
        <div class="queue-entry-info" style="display: none;">
            <i class="fas fa-info-circle"></i>
            <span class="info-text"></span>
        </div>
        <div class="queue-entry-actions">
            <button class="queue-cancel-btn" data-job-id="${job.id}">
                <i class="fas fa-times"></i> Cancel
            </button>
        </div>
    `;

    // Add cancel button listener
    const cancelBtn = entry.querySelector('.queue-cancel-btn');
    cancelBtn.addEventListener('click', () => {
        cancelJob(job.id);
    });
    
    // Add command button listener if present
    const cmdBtn = entry.querySelector('.queue-cmd-btn');
    if (cmdBtn) {
        // Show full command on hover
        cmdBtn.addEventListener('mouseenter', () => {
            showCommandTooltip(cmdBtn, descData.cmd);
        });
        
        cmdBtn.addEventListener('mouseleave', () => {
            hideCommandTooltip();
        });
        
        // Copy to clipboard on click
        cmdBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(descData.cmd);
                cmdBtn.classList.add('copied');
                cmdBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    cmdBtn.classList.remove('copied');
                    cmdBtn.innerHTML = '<i class="fas fa-terminal"></i>';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy command:', err);
            }
        });
    }

    // Listen for job-specific events and forward to both queue and logs
    listen(`transcode_${job.id}`, (event) => {
        const payload = event.payload;
        handleJobProgress(job.id, payload);
        
        // Forward to logs tab
        forwardToLogs(job.id, payload);
    });

    return {
        element: entry,
        id: job.id,
        status: job.status,
        startTime: Date.now(),
        errorLogs: []
    };
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Tooltip management for command preview
let commandTooltip = null;

function showCommandTooltip(button, command) {
    hideCommandTooltip();
    
    commandTooltip = document.createElement('div');
    commandTooltip.className = 'command-tooltip';
    commandTooltip.textContent = command;
    document.body.appendChild(commandTooltip);
    
    const rect = button.getBoundingClientRect();
    commandTooltip.style.top = `${rect.bottom + 8}px`;
    commandTooltip.style.left = `${rect.left}px`;
    
    // Adjust if tooltip goes off screen
    setTimeout(() => {
        const tooltipRect = commandTooltip.getBoundingClientRect();
        if (tooltipRect.right > window.innerWidth) {
            commandTooltip.style.left = `${window.innerWidth - tooltipRect.width - 16}px`;
        }
    }, 0);
}

function hideCommandTooltip() {
    if (commandTooltip) {
        commandTooltip.remove();
        commandTooltip = null;
    }
}

function updateJobEntry(entry, job) {
    const statusSpan = entry.element.querySelector('.queue-status');
    const statusClass = getStatusClass(job.status);
    const icon = getStatusIcon(job.status);
    
    statusSpan.className = `queue-status ${statusClass}`;
    statusSpan.innerHTML = `<i class="${icon}"></i> ${job.status}`;
    
    // Update entry border color via class
    entry.element.className = `queue-entry ${statusClass}`;
    
    entry.status = job.status;

    // Update cancel button visibility
    const cancelBtn = entry.element.querySelector('.queue-cancel-btn');
    if (job.status === 'Completed' || job.status === 'Failed' || job.status === 'Cancelled') {
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
        if (cancelBtn) cancelBtn.style.display = 'flex';
    }
}

function handleJobProgress(jobId, payload) {
    const entry = queueJobs.get(jobId);
    if (!entry) return;

    const progressText = entry.element.querySelector('.progress-text');
    const progressFill = entry.element.querySelector('.progress-fill');
    const infoSection = entry.element.querySelector('.queue-entry-info');
    const infoText = entry.element.querySelector('.info-text');

    if (payload === 'EOT') {
        // Job completed successfully - calculate duration
        const duration = Date.now() - entry.startTime;
        const durationStr = formatDuration(duration);
        
        entry.status = 'Completed';
        updateJobEntry(entry, { id: jobId, status: 'Completed' });
        progressText.textContent = 'Completed';
        progressFill.style.width = '100%';
        progressFill.style.backgroundColor = 'var(--success)';
        
        // Show completion time
        infoSection.style.display = 'flex';
        infoSection.className = 'queue-entry-info info-success';
        infoText.textContent = `Completed in ${durationStr}`;
        return;
    }

    if (payload === 'EOT_FAILED') {
        // Job failed - show error info
        entry.status = 'Failed';
        updateJobEntry(entry, { id: jobId, status: 'Failed' });
        progressText.textContent = 'Failed';
        progressFill.style.width = '100%';
        progressFill.style.backgroundColor = 'var(--error)';
        
        // Show error message
        infoSection.style.display = 'flex';
        infoSection.className = 'queue-entry-info info-error';
        if (entry.errorLogs.length > 0) {
            infoText.textContent = entry.errorLogs[0]; // Show first error
        } else {
            infoText.textContent = 'Job failed with unknown error';
        }
        return;
    }

    if (payload === 'Pipeline started') {
        entry.startTime = Date.now(); // Reset start time when pipeline actually starts
        progressText.textContent = 'Processing...';
        progressFill.style.width = '10%';
        progressFill.style.backgroundColor = 'var(--info)';
        return;
    }

    // Parse FFmpeg progress and detect errors
    if (typeof payload === 'string') {
        if (ERROR_REGEX.test(payload)) {
            // Store error message (keep only first 3 errors to avoid memory issues)
            if (entry.errorLogs.length < 3) {
                entry.errorLogs.push(payload);
            }
        }
        
        // Look for progress indicators
        if (payload.includes('frame=')) {
            const frameMatch = payload.match(/frame=\s*(\d+)/);
            if (frameMatch) {
                progressText.textContent = `Frame: ${frameMatch[1]}`;
            }
        }
        
        if (payload.includes('time=')) {
            const timeMatch = payload.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
            if (timeMatch) {
                progressText.textContent = `Time: ${timeMatch[1]}`;
            }
        }

        if (payload.includes('progress=')) {
            const progressMatch = payload.match(/progress=(\w+)/);
            if (progressMatch && progressMatch[1] === 'end') {
                progressText.textContent = 'Finalizing...';
                progressFill.style.width = '95%';
            }
        }

        // Speed indicator
        if (payload.includes('speed=')) {
            const speedMatch = payload.match(/speed=\s*([\d.]+)x/);
            if (speedMatch) {
                const currentText = progressText.textContent;
                progressText.textContent = `${currentText} (${speedMatch[1]}x)`;
            }
        }
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function getStatusClass(status) {
    switch (status) {
        case 'Running': return 'status-running';
        case 'Queued': return 'status-queued';
        case 'Completed': return 'status-completed';
        case 'Failed': return 'status-failed';
        case 'Cancelled': return 'status-cancelled';
        default: return '';
    }
}

function getStatusIcon(status) {
    switch (status) {
        case 'Running': return 'fas fa-spinner fa-spin';
        case 'Queued': return 'fas fa-clock';
        case 'Completed': return 'fas fa-check-circle';
        case 'Failed': return 'fas fa-times-circle';
        case 'Cancelled': return 'fas fa-ban';
        default: return 'fas fa-circle';
    }
}

async function setMaxConcurrent(value) {
    try {
        await invoke('set_max_concurrent', { max: value });
        addLogEntry('success', `Max concurrent jobs set to ${value}`);
    } catch (err) {
        addLogEntry('error', `Failed to set max concurrent: ${err}`);
    }
}

async function cancelJob(jobId) {
    try {
        const success = await invoke('cancel_job', { jobId });
        if (success) {
            // Update the job status in the UI immediately
            const entry = queueJobs.get(jobId);
            if (entry) {
                entry.status = 'Cancelled';
                updateJobEntry(entry, { id: jobId, status: 'Cancelled' });
                
                const progressText = entry.element.querySelector('.progress-text');
                const progressFill = entry.element.querySelector('.progress-fill');
                progressText.textContent = 'Cancelled';
                progressFill.style.width = '100%';
                progressFill.style.backgroundColor = 'var(--warning)';
            }
            
            addLogEntry('info', `Job ${jobId} cancelled`);
        } else {
            addLogEntry('warning', `Could not cancel job ${jobId}`);
        }
    } catch (err) {
        addLogEntry('error', `Failed to cancel job: ${err}`);
    }
}

async function cancelAllJobs() {
    try {
        const count = await invoke('cancel_all_jobs');
        for (const [jobId, entry] of queueJobs.entries()) {
            if (entry.status === 'Queued' || entry.status === 'Running') {
                entry.status = 'Cancelled';
                updateJobEntry(entry, { id: jobId, status: 'Cancelled' });
                
                const progressText = entry.element.querySelector('.progress-text');
                const progressFill = entry.element.querySelector('.progress-fill');
                progressText.textContent = 'Cancelled';
                progressFill.style.width = '100%';
                progressFill.style.backgroundColor = 'var(--warning)';
            }
        }
        addLogEntry('info', `All ${count} Jobs cancelled`);
    } catch (err) {
        addLogEntry('error', `Failed to cancel all jobs: ${err}`);
    }
}

function clearCompletedJobs() {
    for (const [jobId, entry] of queueJobs.entries()) {
        if (entry.status === 'Completed' || entry.status === 'Failed' || entry.status === 'Cancelled') {
            entry.element.remove();
            queueJobs.delete(jobId);
        }
    }

    const badge = document.querySelector('.queue-badge');
    if (badge) {
        const remaining = queueJobs.size;
        badge.textContent = `${remaining} jobs`;
    }

    addLogEntry('info', 'Cleared completed jobs from queue');
}

// Forward transcode events to logs tab
function forwardToLogs(jobId, payload) {
    if (typeof payload !== 'string') return;
    
    // Special messages
    if (payload === 'EOT') {
        addLogEntry('success', `[${jobId}] Job completed successfully`);
        return;
    }
    
    if (payload === 'EOT_FAILED') {
        addLogEntry('error', `[${jobId}] Job failed`);
        return;
    }
    
    if (payload === 'Pipeline started') {
        addLogEntry('info', `[${jobId}] Pipeline started`);
        return;
    }
    
    // Categorize and log based on content
    if (ERROR_REGEX.test(payload)) {
        addLogEntry('error', `[${jobId}] ${payload}`);
    } else if (WARNING_REGEX.test(payload)) {
        addLogEntry('warning', `[${jobId}] ${payload}`);
    } else if (PROGRESS_REGEX.test(payload)) {
        addLogEntry('debug', `[${jobId}] ${payload}`);
    }
}