const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { addLogEntry } from '../logs/logs.js';
import { ERROR_REGEX, WARNING_REGEX, PROGRESS_REGEX } from './constants.js';


const queueContent = document.querySelector('.queue-content');
let queueJobs = new Map(); // Store job data by ID

export function initializeQueue() {
    // Queue controls
    const queueClearBtn = document.getElementById('queue-zone-clear');
    queueClearBtn.addEventListener('click', (e) => {
        clearCompletedJobs();
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
    });

    // Initial load
    refreshQueueStatus();

    // Auto-refresh every 2 seconds
    setInterval(refreshQueueStatus, 2000);
}

async function refreshQueueStatus() {
    try {
        const status = await invoke('get_queue_status');
        updateQueueDisplay(status);
    } catch (err) {
        console.error('Failed to refresh queue:', err);
    }
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

    queueContent.scrollTop = queueContent.scrollHeight;
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
    queueTab.classList.toggle('high-priority', totalActive >= 8);
    
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
    
    entry.innerHTML = `
        <div class="queue-entry-header">
            <span class="queue-time">${time}</span>
            <span class="queue-status ${statusClass}">
                <i class="${icon}"></i>
                ${job.status}
            </span>
            <span class="queue-id">${job.id}</span>
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