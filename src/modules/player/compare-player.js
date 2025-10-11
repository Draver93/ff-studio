import { formatTime } from '../core/format.js';

const { open } = window.__TAURI__.dialog;

export class ComparePlayer {
    constructor() {
        this.splitContainer = document.getElementById('split-container');
        this.splitDivider = document.getElementById('split-divider');
        this.videoWrapperA = document.getElementById('video-wrapper-a');
        this.videoWrapperB = document.getElementById('video-wrapper-b');
        
        this.videoA = document.getElementById('compare-video-a');
        this.videoPathA = document.getElementById('compare-url-a');
        this.browseA = document.getElementById('browse-a');
        
        this.videoB = document.getElementById('compare-video-b');
        this.videoPathB = document.getElementById('compare-url-b');
        this.browseB = document.getElementById('browse-b');

        this.playBtn = document.getElementById('compare-play-btn');
        this.resetBtn = document.getElementById('compare-reset-btn');
        this.timeline = document.getElementById('global-timeline');
        this.offsetInput = document.getElementById('offset-input');
        this.timeDisplay = document.getElementById('compare-time-display');
        
        this.splitPosition = 50; // percentage
        this.isDragging = false;
        this.offsetMs = 0;
        this.isPlaying = false;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateSplitPosition(50);
    }

    setupEventListeners() {
        this.setupSplitDivider();
        this.setupPlaybackControls();
        this.setupFileInputs();
        this.setupTimelineControls();
    }

    setupSplitDivider() {
        // Draggable divider
        this.splitDivider.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            
            const rect = this.splitContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = (x / rect.width) * 100;
            
            this.updateSplitPosition(percentage);
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
    }

    setupPlaybackControls() {
        // Play/Pause
        this.playBtn.addEventListener('click', () => {
            if (!this.isPlaying) {
                this.videoA.play();
                this.videoB.play();
                this.playBtn.innerHTML = '<i class="fas fa-pause"></i>';
            } else {
                this.videoA.pause();
                this.videoB.pause();
                this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
            }
            const currentTime = Math.min(this.videoA.currentTime, this.videoB.currentTime);
            this.videoA.currentTime = currentTime;
            this.videoB.currentTime = currentTime + this.offsetMs / 1000;

            this.isPlaying = !this.isPlaying;
        });

        this.videoA.addEventListener('play', this.updatePlayPauseIcon.bind(this));
        this.videoA.addEventListener('pause', this.updatePlayPauseIcon.bind(this));

        // Reset
        this.resetBtn.addEventListener('click', () => {
            this.videoA.pause();
            this.videoB.pause();
            this.videoA.currentTime = 0;
            this.videoB.currentTime = this.offsetMs / 1000;
            this.timeline.value = 0;
            this.playBtn.innerHTML = '<i class="fas fa-play"></i>';
            this.isPlaying = false;
            this.updatePlayPauseIcon();
        });

        // Time sync
        this.videoA.addEventListener('timeupdate', () => {
            if (Math.abs(this.videoA.currentTime - this.videoB.currentTime) > 0.1) {
                this.videoB.currentTime = this.videoA.currentTime + this.offsetMs / 1000;
            }
            
            this.timeDisplay.textContent = formatTime(this.videoA.currentTime);
        });

        this.videoA.addEventListener('seeked', () => {
            this.videoB.currentTime = this.videoA.currentTime + this.offsetMs / 1000;
        });
    }

    setupFileInputs() {
        // Browse buttons
        this.browseA.addEventListener('click', () => {
            open({}).then((filePath) => {
                if(filePath) {
                    this.videoA.src = `http://127.0.0.1:8893/${encodeURIComponent(filePath)}`;
                    this.videoA.load();
                    this.videoPathA.value = filePath;
                }
            });
        });

        this.videoPathA.addEventListener('change', () => {
            this.videoA.src = `http://127.0.0.1:8893/${encodeURIComponent(this.videoPathA.value)}`;
            this.videoA.load();
        });

        this.browseB.addEventListener('click', () => {
            open({}).then((filePath) => {
                if(filePath) {
                    this.videoB.src = `http://127.0.0.1:8893/${encodeURIComponent(filePath)}`;
                    this.videoB.load();
                    this.videoPathB.value = filePath;
                }
            });
        });

        this.videoPathB.addEventListener('change', () => {
            this.videoB.src = `http://127.0.0.1:8893/${encodeURIComponent(this.videoPathB.value)}`;
            this.videoB.load();
        });
    }

    setupTimelineControls() {
        // Listen for offset changes
        this.offsetInput.addEventListener('input', () => {
            this.offsetMs = parseInt(this.offsetInput.value) || 0;
            const newTime = (this.timeline.value / 100) * this.videoA.duration;
            if(isNaN(newTime)) return; 
            
            this.videoA.currentTime = newTime;
            this.videoB.currentTime = newTime + this.offsetMs / 1000;
            this.updateTimeline();
        });

        // Seek both videos via timeline
        this.timeline.addEventListener('input', () => {
            if (!this.videoA.duration) return;
            const newTime = (this.timeline.value / 100) * this.videoA.duration;
            this.videoA.currentTime = newTime;
            this.videoB.currentTime = newTime + this.offsetMs / 1000;
        });

        // Update global timeline as videos play
        this.videoA.addEventListener('play', this.updateTimeline.bind(this));
    }

    updateSplitPosition(percentage) {
        this.splitPosition = Math.max(0, Math.min(100, percentage));
        
        // Update divider position
        this.splitDivider.style.left = this.splitPosition + '%';
        
        // Update video B clipping
        this.videoWrapperB.style.clipPath = `inset(0 0 0 ${this.splitPosition}%)`;
        this.videoWrapperA.style.clipPath = `inset(0 ${100 - this.splitPosition}% 0 0)`;
    }

    updatePlayPauseIcon() {
        const icon = this.playBtn.querySelector('i');
        if (this.videoA.paused) {
            icon.classList.remove('fa-pause');
            icon.classList.add('fa-play');
        } else {
            icon.classList.remove('fa-play');
            icon.classList.add('fa-pause');
        }
    }

    updateTimeline() {
        if (!this.videoA.duration) return;
        const progress = (this.videoA.currentTime / this.videoA.duration) * 100;
        this.timeline.value = progress;
        requestAnimationFrame(this.updateTimeline.bind(this));
    }

    // Public API methods
    getVideoA() {
        return this.videoA;
    }

    getVideoB() {
        return this.videoB;
    }

    getSplitPosition() {
        return this.splitPosition;
    }

    setSplitPosition(percentage) {
        this.updateSplitPosition(percentage);
    }

    getOffset() {
        return this.offsetMs;
    }

    setOffset(offsetMs) {
        this.offsetMs = offsetMs;
        this.offsetInput.value = offsetMs;
    }
}
