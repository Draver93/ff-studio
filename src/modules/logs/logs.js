const { save } = window.__TAURI__.dialog;
const { writeTextFile } = window.__TAURI__.fs;
const logsContent = document.querySelector('.logs-content');

export function initLogs() {
    // logs functionality
    const logsClearBtn = document.getElementById('logs-zone-clear');
    logsClearBtn.addEventListener('click', (e) => {
        clearLogs();
    });

    const logsExportBtn = document.getElementById('logs-zone-export');
    logsExportBtn.addEventListener('click', (e) => {
        exportLogs();
    });
};

// Log system module
export function addLogEntry(type, message) {
    const logsContent = document.querySelector('.logs-content');
    const shouldAutoScroll = logsContent.scrollTop + logsContent.clientHeight >= logsContent.scrollHeight - 50;
    
    const time = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    let icon = 'fas fa-info-circle';
    if (type === 'warning') icon = 'fas fa-exclamation-triangle';
    if (type === 'error') {
        icon = 'fas fa-times-circle';
        let activeTab = document.querySelector('.tab.active');
        if(activeTab && activeTab.getAttribute('data-tab') !== 'logs') {
            const errorBadge = document.getElementById('error-badge');
            if(errorBadge) errorBadge.style.display = 'block';
        }
    }
    if (type === 'debug') icon = 'fas fa-bug';
    if (type === 'success') icon = 'fa fa-check';
    logEntry.innerHTML = `
        <span class="log-time">${time}</span>
        <i class="${icon}"></i>
        <span>${message}</span>
    `;
    logsContent.appendChild(logEntry);

    // Auto-scroll only if user is near the bottom
    if (shouldAutoScroll) logsContent.scrollTop = logsContent.scrollHeight;
    
    const logCount = logsContent.querySelectorAll('.log-entry').length;
    const badge = document.querySelector('.badge');
    if(badge) badge.textContent = `${logCount} entries`;
}

function clearLogs() {
    logsContent.innerHTML = ``;
    logsContent.scrollTop = logsContent.scrollHeight;
    const logCount = logsContent.querySelectorAll('.log-entry').length;
    const badge = document.querySelector('.badge');
    if(badge) badge.textContent = `${logCount} entries`;
}

function exportLogs() {
    const logEntries = logsContent.querySelectorAll('.log-entry');
    let logs = [];
    logEntries.forEach(entry => {
        const time = entry.querySelector('.log-time')?.textContent || "";
        const message = entry.querySelector('span:not(.log-time)')?.textContent || "";
        const type = entry.classList.contains('error') ? 'error' :
                     entry.classList.contains('warning') ? 'warning' :
                     entry.classList.contains('debug') ? 'debug' :
                     entry.classList.contains('success') ? 'success' : 'info';
        logs.push(`[${time}] [${type.toUpperCase()}] ${message}`);
    });
    try {
        save({
            defaultPath: `logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
            filters: [{ name: 'Text file', extensions: ['txt'] }]
        }).then(function(filePath) {
            if (filePath) {
                writeTextFile(filePath, logs.join("\n")).then(function() {
                    addLogEntry('success', `Logs exported to: ${filePath}`);
                });
            } else {
                addLogEntry('warning', `Export cancelled by user.`);
            }
        });
    } catch (err) {
        addLogEntry('error', `Failed to export logs: ${err}`);
    }
}

window.addEventListener("error", function (event) {
    addLogEntry("error", "Caught error:" + event.message + "at" + event.filename + ":" + event.lineno);
    //event.preventDefault();
});
