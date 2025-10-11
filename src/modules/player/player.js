import { TimelinePlayer } from './timeline-player.js';
import { StreamPlayer } from './stream-player.js';
import { ComparePlayer } from './compare-player.js';

export class PlayerManager {
    constructor() {
        this.timelinePlayer = null;
        this.streamPlayer = null;
        this.comparePlayer = null;
        this.currentPlayer = null;
        
        this.init();
    }

    init() {
        this.setupPlayerTabs();
        this.initializePlayers();
    }

    setupPlayerTabs() {
        const playerTabs = document.querySelectorAll('.player-tab');
        const playerViews = document.querySelectorAll('.player-view');

        playerTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Clear stream player when switching tabs
                if (this.streamPlayer) {
                    this.streamPlayer.clear();
                }

                playerTabs.forEach(t => t.classList.remove('active'));
                playerViews.forEach(v => v.classList.remove('active'));
                
                tab.classList.add('active');
                const viewId = tab.getAttribute('data-player-tab') + '-view';
                document.getElementById(viewId)?.classList.add('active');
                
                // Update current player reference
                const playerType = tab.getAttribute('data-player-tab');
                this.switchPlayer(playerType);
            });
        });
    }

    initializePlayers() {
        // Initialize all player types
        this.timelinePlayer = new TimelinePlayer();
        this.streamPlayer = new StreamPlayer();
        this.comparePlayer = new ComparePlayer();
        
        // Set default player
        this.currentPlayer = this.timelinePlayer;
    }

    switchPlayer(playerType) {
        switch(playerType) {
            case 'timeline':
                this.currentPlayer = this.timelinePlayer;
                break;
            case 'stream':
                this.currentPlayer = this.streamPlayer;
                break;
            case 'compare':
                this.currentPlayer = this.comparePlayer;
                break;
        }
    }

    // Public API methods
    getTimelinePlayer() {
        return this.timelinePlayer;
    }

    getStreamPlayer() {
        return this.streamPlayer;
    }

    getComparePlayer() {
        return this.comparePlayer;
    }

    getCurrentPlayer() {
        return this.currentPlayer;
    }

    destroy() {
        if (this.timelinePlayer) {
            this.timelinePlayer.destroy();
        }
        if (this.streamPlayer) {
            this.streamPlayer.destroy();
        }
        if (this.comparePlayer) {
            this.comparePlayer.destroy();
        }
    }
}

// Legacy function for backward compatibility
export function initPlayer() {
    window.playerManager = new PlayerManager();
    return window.playerManager;
}