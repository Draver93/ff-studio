import { Timeline } from './timeline.js';
import { formatTime } from '../core/format.js';
import { get_ffmpeg_command } from '../graph/execution.js';
import { addLogEntry } from '../logs/logs.js';

const { once } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

export class TimelinePlayer {
    constructor() {
        this.video = document.getElementById("main-video");
        this.frameDisplay = document.getElementById("frame-display");
        this.playPauseBtn = document.getElementById("play-pause-btn");
        this.backwardBtn = document.getElementById("backward-btn");
        this.forwardBtn = document.getElementById("forward-btn");
        this.generateBtn = document.getElementById("generate-btn");
        this.resetBtn = document.getElementById("reset-btn");
        this.resetSelectionBtn = document.getElementById("reset-selection-btn");
        this.zoomInBtn = document.getElementById("zoom-in");
        this.zoomOutBtn = document.getElementById("zoom-out");
        this.timelineContainer = document.getElementById("timeline");
        
        this.isSyncing = false;
        this.timeline = null;
        
        this.init();
    }

    init() {
        this.setupTimeline();
        this.setupEventListeners();
        this.setupVideoEvents();
    }

    setupTimeline() {
        this.timeline = new Timeline(this.timelineContainer, {
            viewStart: 0,
            pxPerSec: 120,
            segments: [],
            onTime: (t) => {
                if (Math.abs(this.timeline.getVideoTime() - t) > 0.5) {
                    this.isSyncing = true;
                    this.timeline.setVideoTime(t);
                    setTimeout(() => { this.isSyncing = false; }, 100);
                }
            },
            onRange: (r) => {
                const selDisplay = document.getElementById('selection-display');
                if (r) {
                    selDisplay.textContent = `${formatTime(r.start)} - ${formatTime(r.end)}`;
                } else {
                    selDisplay.textContent = 'No selection';
                }
            },
            onSegmentDelete: (index) => {
                if(index === this.timeline.activeSegmentIndex) {
                    this.timeline.activeSegmentIndex = -1;
                    this.hideMedia();
                }
                addLogEntry("info", `Deleted segment: ${this.timeline.segments[index].label}`);
            },
            onSegmentClick: (index, segment) => {
                addLogEntry("info", `Clicked segment: ${segment.label}`);
            }
        });

        // Expose for debugging
        window.timeline = this.timeline;
        window.video = this.video;
    }

    setupEventListeners() {
        // Play/Pause button
        this.playPauseBtn.addEventListener("click", () => {
            this.isSyncing = true;
            if (!this.timeline.isPlaying) {
                this.video.play().catch(error => { });
                this.timeline.play();
            } else {
                this.video.pause();
                this.timeline.pause();
            }
            setTimeout(() => { this.isSyncing = false; }, 100);
            this.updatePlayPauseIcon();
        });

        // Navigation buttons
        this.backwardBtn.addEventListener("click", () => {
            let time = Math.max(0, this.timeline.getVideoTime() - (100 / this.timeline.pxPerSec));
            this.timeline.setPlayhead(time);
            this.timeline.setVideoTime(time);
        });

        this.forwardBtn.addEventListener("click", () => {
            let time = this.timeline.getVideoTime() + (100 / this.timeline.pxPerSec);
            this.timeline.setPlayhead(time);
            this.timeline.setVideoTime(time);
        });

        // Zoom controls
        this.zoomInBtn.addEventListener("click", () => {
            this.timeline.zoomAt(1.25, this.timeline.timeToX(this.timeline.playhead));
        });

        this.zoomOutBtn.addEventListener("click", () => {
            this.timeline.zoomAt(1 / 1.25, this.timeline.timeToX(this.timeline.playhead));
        });

        // Reset controls
        this.resetBtn.addEventListener("click", () => {
            this.hideMedia();
            this.video.pause();
            this.timeline.pause();
            this.timeline.setPlayhead(0);
            this.timeline.clearSelection();
            this.updatePlayPauseIcon();
        });

        this.resetSelectionBtn.addEventListener("click", () => {
            this.timeline.clearSelection();
        });

        // Generate button
        this.generateBtn.addEventListener("click", () => {
            this.handleGeneratePreview();
        });
    }

    setupVideoEvents() {
        this.video.addEventListener("loadedmetadata", () => {});
        
        this.video.addEventListener("timeupdate", () => {
            if (!this.isSyncing && Math.abs(this.timeline.playhead - this.timeline.getVideoTime()) > 0.1) {
                this.timeline.setPlayhead(this.timeline.getVideoTime());
            }
        });

        this.video.addEventListener('play', this.updatePlayPauseIcon.bind(this));
        this.video.addEventListener('pause', this.updatePlayPauseIcon.bind(this));
        document.addEventListener('DOMContentLoaded', this.updatePlayPauseIcon.bind(this));
    }

    updatePlayPauseIcon() {
        const icon = this.playPauseBtn.querySelector('i');
        if (!this.timeline.isPlaying) {
            icon.classList.remove('fa-pause');
            icon.classList.add('fa-play');
        } else {
            icon.classList.remove('fa-play');
            icon.classList.add('fa-pause');
        }
    }

    hideMedia() {
        this.frameDisplay.style.display = "none";
        this.video.style.display = "none";
    }

    handleGeneratePreview() {
        if(!window.selectedWorkflow) { 
            addLogEntry("error", "Caught error: Please, create or select a workflow."); 
            return; 
        }

        let cmd = get_ffmpeg_command();
        if(!cmd) {
            addLogEntry("error", `Failed to execute ffmpeg preview cmd! FFmpeg workflow graph is missing!`);
            return;
        }
        
        if (!this.timeline.selection) {
            addLogEntry("error", "Please select a range first"); 
            return;
        }

        const segmentIndex = this.timeline.segments.length;
        
        if (this.timeline.selection.start !== this.timeline.selection.end) {
            // Add segment with loading state
            this.timeline.addSegment({ 
                start: this.timeline.selection.start, 
                end: this.timeline.selection.end, 
                label: 'Processing Segment...', 
                color: '#a349a4',
                state: 'loading',
                type: 'VidSegment'
            });
        } else {
            this.timeline.addSegment({ 
                start: this.timeline.selection.start - 0.1, 
                end: this.timeline.selection.start + 0.1, 
                label: 'Processing Frame...', 
                color: '#d97b00',
                state: 'loading',
                type: 'VidFrame'
            });
        } 
        
        // Listen for preview completion
        once('render_preview_listener', (event) => { 
            let data = event.payload;
            this.timeline.clearSelection();

            invoke('file_exists', {path: data}).then(exists => {
                if (!exists) {
                    this.timeline.removeSegment(segmentIndex);
                    return;
                } 
                this.timeline.updateSegmentState(segmentIndex, 'ready');

                if(this.timeline.segments[segmentIndex].type == "VidSegment") {
                    this.timeline.segments[segmentIndex].label = "Video Segment";
                } else if(this.timeline.segments[segmentIndex].type == "AudioSegment") {
                    this.timeline.segments[segmentIndex].label = "Audio Segment";
                } else if(this.timeline.segments[segmentIndex].type == "VidFrame") {
                    this.timeline.segments[segmentIndex].label = "Video Frame";
                } else { 
                    this.timeline.segments[segmentIndex].label = "Unknown"; 
                }

                this.timeline.segments[segmentIndex].path = `http://127.0.0.1:8893/${encodeURIComponent(data)}`;
                addLogEntry("info", `${this.timeline.segments[segmentIndex].type} was created. Location: ${data}`);
            });
        }); 
        
        addLogEntry("info", `Executing ffmpeg preview cmd: ${window.FFMPEG_BIN + " " + cmd}`);
        invoke('render_preview_request', { 
            cmd: window.FFMPEG_BIN + " " + cmd, 
            env: window.FFMPEG_ENV, 
            start: formatTime(this.timeline.selection.start), 
            end: formatTime(this.timeline.selection.end) 
        });
    }

    // Public API methods
    getTimeline() {
        return this.timeline;
    }

    getVideo() {
        return this.video;
    }

    destroy() {
        if (this.timeline) {
            this.timeline.destroy();
        }
    }
}
