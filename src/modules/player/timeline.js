import { clamp, fmtTime, formatTime } from '../core/format.js';

const playerZone = document.getElementById("player-zone");
const video = document.getElementById("main-video");
const frameDisplay = document.getElementById("frame-display");

// Nice tick step for current scale so labels are ~80–140 px apart
function chooseTick(pixPerSec) {
    const targetPx = 100; // desired spacing
    const raw = targetPx / pixPerSec; // seconds between ticks desired
    const base = [1, 2, 5];
    const pow = Math.floor(Math.log10(raw));
    const mult = Math.pow(10, pow);
    for (const b of base) {
        const step = b * mult; if (step >= raw) return step;
    }
    return 10 * mult;
}
function showFrame(path) {
    video.pause();
    video.style.display = "none";
    if(video.src) {
        video.pause();
        video.removeAttribute("src");  
        video.load();    
    }
    frameDisplay.src = path;
    frameDisplay.style.display = "block";
}
function showVideo(src) {
    frameDisplay.style.display = "none";
    video.style.display = "block";
    if (src) {
        video.src = src;
        video.load();
        if(timeline.isPlaying) {
            video.addEventListener(
                "loadedmetadata",
                () => { setTimeout(() => video.play(), 150); },
                { once: true }
            );
        }
    } 
}
function hideMedia() {
    frameDisplay.style.display = "none";
    video.style.display = "none";
}

// ===== Timeline Class =====
export class Timeline {
    constructor(container, options = {}) {
        this.container = container;
        this.width = container.clientWidth; this.height = container.clientHeight;

        // State
        this.pxPerSec = options.pxPerSec ?? 120; // zoom level
        this.minPxPerSec = 10; this.maxPxPerSec = 2000;
        this.viewStart = options.viewStart ?? 0; // left bound time (sec)
        this.playhead = options.playhead ?? 0; // seconds
        this.isPlaying = false;
        this.segments = options.segments ?? [];
        this.selection = null; // {start,end}
        this.activeSegmentIndex = -1;
        // Animation state - ADD THIS
        this._animationInterval = null;
        this._targetFPS = 24;

        // Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        // Interaction helpers
        this.drag = null; // {mode, startX, startT, lastX}
        this.hoverHandle = null; // 'l' | 'r' | null
        this.hoverSegment = null; // index of hovered segment or null
        this.hoverDeleteBtn = null; // index of segment with hovered delete button or null

        this._setupEvents();
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.container);
        this._resize();
        this._raf = null; this._needsDraw = true; this._loop();

        // External API events
        this.onTime = options.onTime || (() => { });
        this.onRange = options.onRange || (() => { });
        this.onSegmentDelete = options.onSegmentDelete || (() => { });
        this.onSegmentClick = options.onSegmentClick || (() => { });
    }
    _checkAndStartAnimation() {
        const hasLoadingSegments = this.segments.some(s => s.state === 'loading');
        
        if (hasLoadingSegments && !this._animationInterval) {
            // Start animation interval for loading indicators
            this._animationInterval = setInterval(() => {
                this.invalidate(); // Force redraw for animations
            }, 1000 / this._targetFPS);
        } else if (!hasLoadingSegments && this._animationInterval) {
            // Stop animation interval if no loading segments
            clearInterval(this._animationInterval);
            this._animationInterval = null;
        }
    }
    _checkSegmentPlayback() {
        // Find if playhead is inside any segment
        let idx = this.segments.findIndex( s => this.playhead >= s.start && this.playhead <= s.end );

        if (idx !== this.activeSegmentIndex) {
            this.activeSegmentIndex = idx;

            if (this.activeSegmentIndex !== -1) {
                const seg = this.segments[this.activeSegmentIndex];

                if(seg.path.endsWith(".png")) showFrame(seg.path);
                else showVideo(seg.path);

                // Show correct frame when playhead is inside a segment
                this.setVideoTime(this.playhead);
                if (!this.isPlaying) {
                    video.pause(); // paused unless user hit play
                }
                else video.play().catch(error => { });
            } 
            else hideMedia(); //just turn off
        }
    }

    // ===== Public API =====
    setSegments(segments) { this.segments = segments || []; this.invalidate(); }
    setPlayhead(t) { 
        if (Math.abs(this.playhead - t) > 0.01) {
            this.playhead = t;
            this.onTime(this.playhead);
            this._maybeAutoScroll();
            this._checkSegmentPlayback();
            this.invalidate();
        }
    }
    setVideoTime(newTime) {
        if(this.activeSegmentIndex === -1) {
            video.currentTime = newTime;
            return;
        };
        const seg = this.segments[this.activeSegmentIndex];
        video.currentTime = newTime - seg.start;
    }
    getVideoTime() {
        if(this.activeSegmentIndex === -1)
             return this.playhead;

        const seg = this.segments[this.activeSegmentIndex];
        return seg.start + video.currentTime;
    }
    reset() {
        hideMedia();
        this.activeSegmentIndex = -1;
        this.segments =  [];
        this.invalidate();
    }

    play() { if (this.isPlaying) return; this.isPlaying = true; this._lastTick = performance.now(); this.invalidate(); }
    pause() { this.isPlaying = false; this.invalidate(); }
    toggle() { this.isPlaying ? this.pause() : this.play(); }
    zoomAt(factor, anchorX) {
        const anchorTime = this.xToTime(anchorX);
        const prev = this.pxPerSec; this.pxPerSec = clamp(prev * factor, this.minPxPerSec, this.maxPxPerSec);
        // keep anchorTime under cursor
        this.viewStart = anchorTime - (anchorX / this.pxPerSec);
        this.invalidate();
    }
    panByPixels(dx) { this.viewStart -= dx / this.pxPerSec; this.invalidate(); }
    clearSelection() { this.selection = null; this.onRange(null); this.invalidate(); }

    // Update segment state (loading/ready)
    updateSegmentState(index, state) {
        if (index >= 0 && index < this.segments.length) {
            this.segments[index].state = state;
            this.invalidate();
        }
    }

    // Add a new segment
    addSegment(segment) {
        this.segments.push(segment);
        this.invalidate();
    }

    // Remove a segment by index
    removeSegment(index) {
        if (index >= 0 && index < this.segments.length) {
            this.segments.splice(index, 1);
            this.invalidate();
            this.activeSegmentIndex = -1;
            hideMedia();
            return true;
        }
        return false;
    }

    fitToSegments(padSec = 1) {
        if (!this.segments.length) { return; }
        let min = Infinity, max = -Infinity; for (const s of this.segments) { min = Math.min(min, s.start); max = Math.max(max, s.end); }
        if (!isFinite(min) || !isFinite(max)) return;
        const span = Math.max(1e-6, max - min);
        const viewSpan = (this.container.clientWidth || 1000) / this.pxPerSec;
        const desiredPxPerSec = (this.container.clientWidth - 80) / (span + padSec * 2);
        this.pxPerSec = clamp(desiredPxPerSec, this.minPxPerSec, this.maxPxPerSec);
        this.viewStart = (min - padSec);
        this.invalidate();
    }

    // ===== Internals =====
    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(100, this.container.clientWidth);
        const h = Math.max(120, this.container.clientHeight);
        this.width = w; this.height = h;
        this.canvas.width = Math.floor(w * dpr); this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.invalidate();
    }

    invalidate() { 
        this._checkAndStartAnimation();
        this._needsDraw = true; 
    }

    _loop() {
        const tick = (now) => {
            if (this.isPlaying) {
                const dt = (now - (this._lastTick || now)) / 1000; this._lastTick = now;
                this.playhead += dt; 
                this.onTime(this.playhead); 
                this._maybeAutoScroll();
                this._checkSegmentPlayback();
                this._needsDraw = true;
            }
            if (this._needsDraw) { this._draw(); this._needsDraw = false; }
            this._raf = requestAnimationFrame(tick);
        }
        this._raf = requestAnimationFrame(tick);
    }

    destroy() { 
        cancelAnimationFrame(this._raf); 
        this._resizeObserver.disconnect(); 
        this.container.innerHTML = ''; 
        clearInterval(this._animationInterval); 
    }

    timeToX(t) { return (t - this.viewStart) * this.pxPerSec; }
    xToTime(x) { return this.viewStart + x / this.pxPerSec; }

    _maybeAutoScroll() {
        const x = this.timeToX(this.playhead);
        const margin = 80;
        if (x > this.width - margin) { this.viewStart += (x - (this.width - margin)) / this.pxPerSec; this.invalidate(); }
        if (x < margin) { this.viewStart -= (margin - x) / this.pxPerSec; this.invalidate(); }
    }

    _hitTestHandles(x) {
        if (!this.selection) return null;
        const l = this.timeToX(this.selection.start), r = this.timeToX(this.selection.end);
        const pad = 6, w = 8;
        if (Math.abs(x - l) <= pad + w) return 'l';
        if (Math.abs(x - r) <= pad + w) return 'r';
        return null;
    }

    _hitTestSegments(x, y) {
        const laneTop = 28;
        const laneHeight = this.height - laneTop - 8;
        
        // Check if we're in the segment lane
        if (y < laneTop || y > laneTop + laneHeight) return null;
        
        // Check each segment
        for (let i = 0; i < this.segments.length; i++) {
            const s = this.segments[i];
            const segX = this.timeToX(s.start);
            const segWidth = this.timeToX(s.end) - segX;
            
            // Check if cursor is within segment bounds
            if (x >= segX && x <= segX + segWidth) {
                return i;
            }
        }
        
        return null;
    }

    _hitTestDeleteButton(x, y, segmentIndex) {
        const s = this.segments[segmentIndex];
        if (!s) return false;
        
        const segX = this.timeToX(s.start);
        const segWidth = this.timeToX(s.end) - segX;
        const laneTop = 28;
        const btnSize = 32;
        const btnPadding = 4;
        
        // Delete button is in the top-right corner of the segment
        const btnX = segX + segWidth - btnSize - btnPadding;
        const btnY = laneTop + btnPadding;
        
        return (x >= btnX && x <= btnX + btnSize && 
                y >= btnY && y <= btnY + btnSize);
    }

    _setupEvents() {
        const el = this.canvas;

        const onPointerDown = (e) => {
            el.setPointerCapture(e.pointerId);
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            const t = this.xToTime(x);
            const handle = this._hitTestHandles(x);
            const segmentIndex = this._hitTestSegments(x, y);
            const deleteBtnHit = segmentIndex !== null ? this._hitTestDeleteButton(x, y, segmentIndex) : false;

            // Area division: top 40px ruler, rest workspace
            const inRuler = (y < 40);

            if (e.button === 0 && deleteBtnHit) {
                // Delete segment on click
                if(segmentIndex === this.activeSegmentIndex) {
                    this.activeSegmentIndex = -1;
                    hideMedia();
                }
                this.onSegmentDelete(segmentIndex);
                this.removeSegment(segmentIndex);
                return;
            } else if (e.button === 0 && segmentIndex !== null) {
                // Segment clicked
                this.onSegmentClick(segmentIndex, this.segments[segmentIndex]);
                return;
            } else if (handle) {
                this.drag = { mode: handle === 'l' ? 'resizeL' : 'resizeR', startX: x };
            } else if (this.selection && x > this.timeToX(this.selection.start) + 6 && x < this.timeToX(this.selection.end) - 6) {
                this.drag = { mode: 'moveSel', startX: x, startSel: { ...this.selection } };
            } else if (!inRuler && e.buttons === 1) {
                if(t >= 0) {
                    // start potential range drag
                    this.drag = { mode: 'range', startX: x, anchorT: t };
                    this.selection = { start: t, end: t };
                    this.onRange(this.selection);
                }
            } else {
                // ruler or background click: set playhead, allow pan drag if moved
                this.setPlayhead(t);
                this.drag = { mode: 'panOrClick', startX: x, startT: this.viewStart, moved: false };
            }
            this.invalidate();
        };

        const onPointerMove = (e) => {
            if(!playerZone.style.display || playerZone.style.display === 'none') return;

            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left; 
            const y = e.clientY - rect.top;

            // Hover for handles
            this.hoverHandle = this._hitTestHandles(x);
            
            // Hover for segments and delete buttons
            const prevHoverSegment = this.hoverSegment;
            const prevHoverDeleteBtn = this.hoverDeleteBtn;
            
            this.hoverSegment = this._hitTestSegments(x, y);
            this.hoverDeleteBtn = this.hoverSegment !== null ? 
                this._hitTestDeleteButton(x, y, this.hoverSegment) : false;
            
            // Update cursor style
            //if (this.hoverDeleteBtn) {
            //    el.style.cursor = 'pointer';
            //} else if (this.hoverSegment !== null) {
            //    el.style.cursor = 'move';
            //} else if (this.hoverHandle) {
            //    el.style.cursor = 'ew-resize';
            //} else {
            //    el.style.cursor = 'default';
            //}
            
            // Redraw if hover state changed
            if (prevHoverSegment !== this.hoverSegment || prevHoverDeleteBtn !== this.hoverDeleteBtn) {
                this.invalidate();
            }

            if (!this.drag) return;
            const dx = x - this.drag.startX;

            if (this.drag.mode === 'range') {
                const t = this.xToTime(x);
                const a = this.drag.anchorT, b = t;
                // Ensure neither start nor end goes negative
                this.selection = {
                    start: Math.max(0, Math.min(a, b)),
                    end: Math.max(0, Math.max(a, b))
                };
                this.onRange(this.selection);
                this.invalidate();
                return;
            }

            if (this.drag.mode === 'panOrClick') {
                if (Math.abs(dx) > 3) { this.drag.moved = true; }
                if (this.drag.moved) {
                    this.viewStart = this.drag.startT - dx / this.pxPerSec; // pan
                    this.invalidate();
                }
                return;
            }

            if (this.drag.mode === 'moveSel' && this.selection) {
                const dt = dx / this.pxPerSec;
                // Calculate new start time, ensuring it doesn't go negative
                const newStart = Math.max(0, this.drag.startSel.start + dt);
                // Adjust dt if we hit the limit to keep selection size consistent
                const adjustedDt = newStart - this.drag.startSel.start;
                this.selection = {
                    start: newStart,
                    end: this.drag.startSel.end + adjustedDt
                };
                this.onRange(this.selection);
                this.invalidate();
                return;
            }

            if (this.drag.mode === 'resizeL' && this.selection) {
                const t = this.xToTime(x);
                // Ensure the start time doesn't go negative and doesn't exceed the end time
                this.selection = {
                    start: Math.max(0, Math.min(t, this.selection.end - 1e-6)),
                    end: this.selection.end
                };
                this.onRange(this.selection);
                this.invalidate();
                return;
            }

            if (this.drag.mode === 'resizeR' && this.selection) {
                const t = this.xToTime(x);
                // Ensure the end time doesn't go negative and is at least 1e-6 after start
                this.selection = {
                    start: this.selection.start,
                    end: Math.max(this.selection.start + 1e-6, t)
                };
                this.onRange(this.selection);
                this.invalidate();
                return;
            }
        };

        const onPointerUp = (e) => {
            if(!playerZone.style.display || playerZone.style.display === 'none') return;

            if (!this.drag) return;
            if (this.drag.mode === 'panOrClick' && !this.drag.moved) {
                // simple click already set playhead in pointerdown; nothing else
            }
            this.drag = null; this.invalidate();
        };

        const onDblClick = (e) => { this.clearSelection(); };

        const onWheel = (e) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (e.ctrlKey || e.metaKey) { // zoom
                const factor = Math.pow(1.0015, -e.deltaY);
                this.zoomAt(factor, x);
            } else { // pan
                // natural-feel: horizontal wheel pans, vertical pans too
                const dx = (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ? e.deltaX : e.deltaY;
                this.panByPixels(dx);
            }
        };

        const onKey = (e) => {
            if(!playerZone.style.display || playerZone.style.display === 'none') return;

            if (['ArrowLeft', 'ArrowRight', ' ', '+', '-', '=', '_'].includes(e.key)) e.preventDefault();
            const nudgeSmall = 1 / 30; // ~1 frame at 30fps
            const nudgeBig = 0.5;
            if (e.key === ' ') { this.toggle(); return; }
            if (e.key === 'ArrowLeft') this.setPlayhead(this.playhead - (e.shiftKey ? nudgeBig : nudgeSmall));
            if (e.key === 'ArrowRight') this.setPlayhead(this.playhead + (e.shiftKey ? nudgeBig : nudgeSmall));
            if (e.key === '+' || e.key === '=') this.zoomAt(1.15, this.timeToX(this.playhead));
            if (e.key === '-' || e.key === '_') this.zoomAt(1 / 1.15, this.timeToX(this.playhead));
            
            // Delete key to remove selected segment
            if (e.key === 'Delete' && this.hoverSegment !== null) {
                this.onSegmentDelete(this.hoverSegment);
                this.removeSegment(this.hoverSegment);
            }
            if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
                isSyncing = true; 
                setTimeout(() => { isSyncing = false; }, 100);
                e.preventDefault();
                e.stopPropagation();
                if (video.paused) {
                    video.play().catch(error => { });
                    timeline.play();
                } else {
                    video.pause();
                    timeline.pause();
                }
            }
        };
        
        el.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        el.addEventListener('dblclick', onDblClick);
        el.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKey);

        // expose removal if needed
        this._cleanup = () => {
            el.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            el.removeEventListener('dblclick', onDblClick);
            el.removeEventListener('wheel', onWheel);
            window.removeEventListener('keydown', onKey);
        }
    }

    _draw() {
        const ctx = this.ctx; 
        const w = this.width, h = this.height;
        ctx.clearRect(0, 0, w, h);

        // Background grid
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel');
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid');
        ctx.fillRect(0, 40, w, 1); // ruler line

        // Ruler ticks
        const step = chooseTick(this.pxPerSec);
        const startT = this.xToTime(0);
        const endT = this.xToTime(w);
        const firstTick = Math.floor(startT / step) * step;
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--tick');
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '12px ui-sans-serif, system-ui';
        for (let t = firstTick; t <= endT + step; t += step) {
            const x = this.timeToX(t);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 20); ctx.stroke();
            const label = fmtTime(t);
            ctx.fillText(label, x + 4, 4);
        }

        // Segments lane area
        const laneTop = 28;
        const laneHeight = h - laneTop - 8;

        // Segments
        for (let i = 0; i < this.segments.length; i++) {
            const s = this.segments[i];
            const x = this.timeToX(s.start), x2 = this.timeToX(s.end);
            if (x2 < 0 || x > w) continue; // out of view
            const y = laneTop + 8;
            const hh = laneHeight - 16;
            
            // Determine segment color based on state
            let segmentColor;
            if (s.state === 'loading') {
                segmentColor = getComputedStyle(document.documentElement).getPropertyValue('--loading') || '#888888';
            } else if (s.state === 'ready') {
                segmentColor = s.color || getComputedStyle(document.documentElement).getPropertyValue('--seg');
            } else {
                segmentColor = s.color || getComputedStyle(document.documentElement).getPropertyValue('--seg');
            }
            
            const radius = 6;
            const width = x2 - x;
            const minWidth = 12; // Minimum width before clipping delete button
            
            // Create rounded rectangle path
            const createRoundedRect = (x, y, width, height, radius) => {
                const r = Math.min(radius, Math.abs(width) / 2, height / 2);
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + width - r, y);
                ctx.quadraticCurveTo(x + width, y, x + width, y + r);
                ctx.lineTo(x + width, y + height - r);
                ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
                ctx.lineTo(x + r, y + height);
                ctx.quadraticCurveTo(x, y + height, x, y + height - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
            };
            
            // Draw segment with transparency and border
            ctx.save();
            
            // Fill with transparency
            ctx.globalAlpha = 0.6;
            createRoundedRect(x, y, width, hh, radius);
            ctx.fillStyle = segmentColor;
            ctx.fill();
            
            // Border with full opacity
            ctx.globalAlpha = 1.0;
            createRoundedRect(x, y, width, hh, radius);
            ctx.strokeStyle = segmentColor;
            ctx.lineWidth = 5;
            ctx.stroke();
            
            ctx.restore();

            // Loading indicator (spinner)
            if (s.state === 'loading') {
                let angle = Date.now() / 10 % 360 * Math.PI / 180;
                ctx.save();
                ctx.translate(x + width / 2, y + hh / 2);
                ctx.rotate(angle);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, Math.min(12, hh / 3), 0, Math.PI * 1.5);
                ctx.stroke();
                ctx.restore();
                this.invalidate();
            }

            if (s.type === "VidSegment") {
                // Video tape pattern - repeating film strip
                const tapeHeight = hh * 0.6; // Taller tape
                const tapeY = y + hh / 2 - tapeHeight / 2;
                const sprocketSize = 4;
                const sprocketSpacing = 6; // Closer sprockets
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.fillRect(x, tapeY, width, tapeHeight);
                
                // Film sprockets
                ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                for (let sprocketX = x; sprocketX < x + width; sprocketX += sprocketSpacing) {
                    ctx.fillRect(sprocketX, tapeY + 1, sprocketSize, 2);
                    ctx.fillRect(sprocketX, tapeY + tapeHeight - 3, sprocketSize, 2);
                }
                
                // Central film frames - wider frames
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                const frameWidth = tapeHeight; // Wider frames
                const frameSpacing = frameWidth * 1.3; // More spacing between frames
                for (let frameX = x + 2; frameX < x + width - frameWidth; frameX += frameSpacing) {
                    ctx.strokeRect(frameX, tapeY + 3, frameWidth, tapeHeight - 6);
                }
                
            } else if (s.type === "VidFrame") {
                // Picture/image glyph pattern
                const imgSize = hh * 0.6; // Larger minimum size
                const imgSpacing = imgSize * 1.1;
                const totalIcons = Math.floor(width / imgSpacing);
                const totalWidth = totalIcons * imgSpacing - 6; // Remove last spacing
                const startX = x + (width - totalWidth) / 2; // Center the pattern
                
                for (let i = 0; i < totalIcons; i++) {
                    const imgX = startX + i * imgSpacing;
                    const imgY = y + hh / 2 - imgSize / 2;
                    
                    // Picture frame
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(imgX, imgY, imgSize, imgSize);
                    
                    // Mountain/landscape icon
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
                    ctx.beginPath();
                    ctx.moveTo(imgX + 3, imgY + imgSize - 3);
                    ctx.lineTo(imgX + imgSize * 0.25, imgY + imgSize * 0.35);
                    ctx.lineTo(imgX + imgSize * 0.5, imgY + imgSize * 0.55);
                    ctx.lineTo(imgX + imgSize * 0.75, imgY + imgSize * 0.25);
                    ctx.lineTo(imgX + imgSize - 3, imgY + imgSize - 3);
                    ctx.closePath();
                    ctx.fill();
                    
                    // Sun/circle
                    const sunRadius = Math.max(2, imgSize * 0.12);
                    ctx.beginPath();
                    ctx.arc(imgX + imgSize * 0.75, imgY + imgSize * 0.3, sunRadius, 0, Math.PI * 2);
                    ctx.fill();
                }
                
            } else if (s.type === "AudioSegment") {
                // Audio waveform pattern
                const waveHeight = hh - 8;
                const waveY = y + 4;
                const waveStep = 2;
                
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                
                let isFirst = true;
                for (let waveX = x; waveX <= x + width; waveX += waveStep) {
                    // Create pseudo-random but deterministic wave
                    const seed = (waveX - x) * 0.08;
                    const amplitude = (Math.sin(seed) * 0.4 + Math.sin(seed * 2.3) * 0.3 + Math.sin(seed * 5.7) * 0.2) * waveHeight / 2;
                    const waveYPos = waveY + waveHeight / 2 + amplitude;
                    
                    if (isFirst) {
                        ctx.moveTo(waveX, waveYPos);
                        isFirst = false;
                    } else {
                        ctx.lineTo(waveX, waveYPos);
                    }
                }
                ctx.stroke();
                
                // Add some vertical bars for more audio-like appearance
                ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                const barSpacing = 4;
                const totalBars = Math.floor(width / barSpacing);
                for (let i = 0; i < totalBars; i++) {
                    const barX = x + i * barSpacing;
                    const barHeight = Math.abs(Math.sin((barX - x) * 0.05)) * (waveHeight - 4) + 2;
                    ctx.fillRect(barX, waveY + (waveHeight - barHeight) / 2, 2, barHeight);
                }
            }

            // Label with better contrast
            if (s.label && width > 40) { // Only show label if segment is wide enough
                ctx.save();
                // Clip to segment bounds
                createRoundedRect(x, y, width, hh, radius);
                ctx.clip();
                
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 2;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = '12px ui-sans-serif, system-ui';
                ctx.fillText(s.label, x + width / 2, y + hh / 2);
                ctx.restore();
            }
            
            // Delete button (X) - only show on hover and when segment is wide enough
            if (this.hoverSegment === i && width >= minWidth) {
                const btnSize = 14;
                const btnPadding = 6;
                const btnX = Math.min(x + width - btnSize - btnPadding, x + width - 6);
                const btnY = y + btnPadding;
                
                ctx.save();
                // Clip delete button to segment bounds
                createRoundedRect(x, y, width, hh, radius);
                ctx.clip();
                
                // Background circle for better visibility
                ctx.fillStyle = this.hoverDeleteBtn ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.7)';
                ctx.beginPath();
                ctx.arc(btnX + btnSize / 2, btnY + btnSize / 2, btnSize / 2, 0, Math.PI * 2);
                ctx.fill();
                
                // X mark
                ctx.strokeStyle = this.hoverDeleteBtn ? '#ff4444' : '#666666';
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                const crossSize = 4;
                const centerX = btnX + btnSize / 2;
                const centerY = btnY + btnSize / 2;
                ctx.moveTo(centerX - crossSize, centerY - crossSize);
                ctx.lineTo(centerX + crossSize, centerY + crossSize);
                ctx.moveTo(centerX + crossSize, centerY - crossSize);
                ctx.lineTo(centerX - crossSize, centerY + crossSize);
                ctx.stroke();
                
                ctx.restore();
            }
        }

        // Selection range
        if (this.selection) {
            const l = this.timeToX(this.selection.start), r = this.timeToX(this.selection.end);
            const selColor = getComputedStyle(document.documentElement).getPropertyValue('--sel');
            const edge = getComputedStyle(document.documentElement).getPropertyValue('--sel-edge');
            ctx.fillStyle = selColor; 
            ctx.strokeStyle = edge; 
            ctx.globalAlpha = 0.8;
            ctx.fillRect(Math.min(l, r), laneTop, Math.abs(r - l), laneHeight);
            ctx.globalAlpha = 1;
            // edges
            ctx.fillStyle = edge;
            ctx.fillRect(l - 1, laneTop, 2, laneHeight);
            ctx.fillRect(r - 1, laneTop, 2, laneHeight);
            // handles
            const handle = (x) => {
                ctx.fillStyle = edge; 
                ctx.fillRect(x - 6, laneTop + laneHeight / 2 - 12, 12, 24);
            }
            handle(l); 
            handle(r);
        }

        // Playhead
        const phx = this.timeToX(this.playhead);
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
        ctx.lineWidth = 2; 
        ctx.beginPath(); 
        ctx.moveTo(phx, 0); 
        ctx.lineTo(phx, h); 
        ctx.stroke();

        // Heads-up readouts (top-left)
        const hud = `${fmtTime(this.playhead)}`;
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink');
        ctx.font = 'bold 13px ui-sans-serif, system-ui'; 
        ctx.textAlign = 'left'; 
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(hud, 8, h - 8);

        // Update DOM readouts
        document.getElementById('time-display').textContent =
            `${formatTime(this.playhead)} / ${formatTime(video.duration || 0)}`;
        const sel = this.selection ?
            `${formatTime(this.selection.start)} - ${formatTime(this.selection.end)}` :
            'No selection';
        document.getElementById('selection-display').textContent = sel;
    }
}