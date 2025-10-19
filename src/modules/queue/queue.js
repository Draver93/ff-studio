const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

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

    queueContent.scrollTop = queueContent.scrollHeight;
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

    // Listen for job-specific events
    listen(`transcode_${job.id}`, (event) => {
        handleJobProgress(job.id, event.payload);
    });

    return {
        element: entry,
        id: job.id,
        status: job.status,
        startTime: time
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

    if (payload === 'EOT') {
        // Job completed successfully
        entry.status = 'Completed';
        updateJobEntry(entry, { id: jobId, status: 'Completed' });
        progressText.textContent = 'Completed';
        progressFill.style.width = '100%';
        progressFill.style.backgroundColor = 'var(--success)';
        return;
    }

    if (payload === 'EOT_FAILED') {
        // Job failed
        entry.status = 'Failed';
        updateJobEntry(entry, { id: jobId, status: 'Failed' });
        progressText.textContent = 'Failed';
        progressFill.style.width = '100%';
        progressFill.style.backgroundColor = 'var(--error)';
        return;
    }

    if (payload === 'Pipeline started') {
        progressText.textContent = 'Processing...';
        progressFill.style.width = '10%';
        progressFill.style.backgroundColor = 'var(--info)';
        return;
    }

    // Parse FFmpeg progress
    if (typeof payload === 'string') {
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

// Import addLogEntry from logs module if needed
function addLogEntry(type, message) {
    if (window.addLogEntry) {
        window.addLogEntry(type, message);
    }
}