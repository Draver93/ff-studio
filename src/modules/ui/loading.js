const loadingModal = document.getElementById('loading-modal');
const loadingMessage = document.getElementById('loading-message');
const cancelLoadBtn = document.getElementById('cancel-load-btn');
const loadingProgress = document.getElementById('loading-progress');
const loadingDetails = document.getElementById('loading-details');

// Loading modal UI module
export function showLoading(message = "Processing Video", cancelable = false, skipable = true) {
    if (message) {
        loadingMessage.textContent = message;
    }
    loadingModal.style.display = 'flex';
    cancelLoadBtn.style.display = cancelable ? 'inline-flex' : 'none';
    window.allow_skip = skipable;
    updateLoadingProgress(0);
}

export function hideLoading() {
    if(!window.allow_skip) return;
    const loadingModal = document.getElementById('loading-modal');
    loadingModal.style.display = 'none';
    window.allow_skip = true;
}

export function updateLoadingProgress(percent) {
    loadingProgress.style.width = percent + '%';
    const progressBar = document.querySelector('.progress-bar');
    if(progressBar) progressBar.style.width = percent + '%';
}

export function updateLoadingDetails(details) {
    loadingDetails.innerHTML = details;
    const detailsEl = document.querySelector('.loading-details');
    if(detailsEl) detailsEl.innerHTML = details;
}

// Close modal when clicking outside
loadingModal.addEventListener('click', (e) => {
    if (e.target === loadingModal) {
        hideLoading();
    }
});
