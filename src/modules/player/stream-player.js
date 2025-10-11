import { addLogEntry } from '../logs/logs.js';

const { open } = window.__TAURI__.dialog;

export class StreamPlayer {
    constructor() {
        this.loadStreamBtn = document.getElementById('load-stream-btn');
        this.streamUrlInput = document.getElementById('stream-url');
        this.qualitySelect = document.getElementById('quality-select');
        this.browseStreamBtn = document.getElementById('browse-stream');
        this.streamVideo = document.getElementById('stream-video');
        this.protocolType = document.getElementById('protocol-type');
        
        this.player = null;
        
        this.init();
    }

    init() {
        this.setupVideoJS();
        this.setupEventListeners();
    }

    setupVideoJS() {
        this.player = videojs('stream-video', {
            fluid: false,
            autoplay: false,
            preload: 'metadata',
            controls: true,
            controlBar: { pictureInPictureToggle: false },
            html5: {
                vhs: {
                    overrideNative: true,
                    bandwidth: 0, // disables auto bitrate switching
                }
            }
        });

        // Setup request hook for local file serving
        this.player.on('xhr-hooks-ready', () => {
            const playerRequestHook = (options) => {
                if (options.uri && !options.uri.startsWith('http')) {
                    options.uri = `http://127.0.0.1:8893/${encodeURIComponent(options.uri)}`;
                }
                return options;
            };
            this.player.tech({ IWillNotUseThisInPlugins: true }).vhs.xhr.onRequest(playerRequestHook);
        });
    }

    setupEventListeners() {
        this.loadStreamBtn.addEventListener('click', () => {
            const url = this.streamUrlInput.value.trim();
            if (!url) return;
            this.loadSource(url);
        });

        this.browseStreamBtn.addEventListener('click', () => {
            open({}).then((filePath) => {
                if(filePath) this.streamUrlInput.value = filePath;
            });
        });
    }

    loadSource(url) {
        let path = url;
        if(!path.startsWith("http")) {
            path = `http://127.0.0.1:8893/${encodeURIComponent(url)}`;
        }

        let protocol = '';
        if (url.endsWith('.m3u8')) {
            this.player.src({ src: path, type: 'application/x-mpegURL' });
            protocol = 'HLS';
        } else if (url.endsWith('.mpd')) {
            this.player.src({ src: path, type: 'application/dash+xml' });
            protocol = 'DASH';
        } else {
            addLogEntry("error", `Unsupported stream format: ${url}`);
            return;
        }

        this.protocolType.textContent = protocol;

        this.player.ready(() => {
            this.setupQualitySelector(protocol);
        });
    }

    setupQualitySelector(protocol) {
        // Clear previous options except "Auto"
        this.qualitySelect.innerHTML = '<option value="auto">Auto</option>';
        while (this.qualitySelect.options.length > 1) {
            this.qualitySelect.remove(1);
        }

        this.player.one('loadedmetadata', () => {           
            if (protocol === 'HLS' || protocol === 'DASH') {
                const qualityLevels = this.player.qualityLevels();

                for (let i = 0; i < qualityLevels.length; i++) {
                    const q = qualityLevels[i];
                    const label = `${q.height}p (${Math.round(q.bitrate / 1000)} kbps)`;
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = label;
                    this.qualitySelect.appendChild(opt);
                }

                this.qualitySelect.value = 'auto';
                this.qualitySelect.onchange = null;
                this.qualitySelect.addEventListener('change', () => {
                    const val = this.qualitySelect.value;
                    for (let i = 0; i < qualityLevels.length; i++) {
                        qualityLevels[i].enabled = (val === 'auto' || i == val);
                    }
                });
            }
        });
    }

    clear() {
        if (this.player) {
            this.player.pause();
            this.player.reset();
            this.player.load();
            this.player.poster(''); // optional, clears poster
        }
        
        // Clear quality selector
        while (this.qualitySelect.options.length > 1) {
            this.qualitySelect.remove(1);
        }

        this.protocolType.textContent = '-';
    }

    // Public API methods
    getPlayer() {
        return this.player;
    }

    destroy() {
        if (this.player) {
            this.player.dispose();
        }
    }
}
