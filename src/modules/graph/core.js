// graph/core.js
// Core graph functionality and canvas management

import { GraphUndoManager } from './undo_redo.js';

// Global (per graph/workflow) undo manager instance attached to window for cross-module access
window.__GRAPH_UNDO_MGR__ = null;
window.__CURRENT_GRAPH__ = null;

// DOM elements
const graph_zone = document.getElementById('graph-zone');
const litegraph_canvas = document.getElementById("litegraph-canvas");
const no_workflow_message = document.getElementById("no-workflows-message");

// Graph and canvas instances
let graph = new LGraph();
let canvas = new LGraphCanvas("#litegraph-canvas", graph);

// Initialize canvas properties
function initializeCanvas() {
    // Important: allow the canvas to receive keyboard events
    litegraph_canvas.setAttribute("tabindex", "0");
    
    // Focus canvas when clicked
    litegraph_canvas.addEventListener("click", () => { 
        litegraph_canvas.focus(); 
    });
    
    // Setup resize observer
    const resizeObserver = new ResizeObserver((entries) => {
        const positionInfo = graph_zone.getBoundingClientRect();
        litegraph_canvas.width = positionInfo.width;
        litegraph_canvas.height = positionInfo.height - 2; // -2 because of the rounding issue
        canvas.setDirty(true, true);
    });
    resizeObserver.observe(graph_zone);

  // Initialize or rebind per-graph undo/redo manager (in-memory, capped history)
  function ensureGraphUndoManager() {
    if (window.__CURRENT_GRAPH__ === graph && window.__GRAPH_UNDO_MGR__) {
      return;
    }
    window.__GRAPH_UNDO_MGR__ = new GraphUndoManager(graph, { maxHistory: 10 });
    window.__CURRENT_GRAPH__ = graph;
    const existingAfter = graph.onAfterChange;
    graph.onAfterChange = function(g, info) {
      if (typeof existingAfter === 'function') existingAfter(g, info);
      if (window.__GRAPH_UNDO_MGR__ && !window.__GRAPH_UNDO_MGR__.isApplying) {
        window.__GRAPH_UNDO_MGR__.enqueueSnapshot();
      }
    };
  }
  try {
      ensureGraphUndoManager();

      // Keyboard shortcuts: Undo/Redo (Cmd/Ctrl+Z / Cmd/Ctrl+Y)
      document.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toLowerCase().includes('mac');
        const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
        if (!ctrlOrCmd) return;
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            window.__GRAPH_UNDO_MGR__ && window.__GRAPH_UNDO_MGR__.redo();
          } else {
            window.__GRAPH_UNDO_MGR__ && window.__GRAPH_UNDO_MGR__.undo();
          }
        } else if (key === 'y') {
          e.preventDefault();
          window.__GRAPH_UNDO_MGR__ && window.__GRAPH_UNDO_MGR__.redo();
        }
      });

      // Workflow change watcher: ensure undo manager rebinds if graph object changes
      // (actual reset happens in workflows.js when workflow loads)
      try {
          let _lastGraph = window.__CURRENT_GRAPH__ || null;
          setInterval(() => {
              if (graph && graph !== _lastGraph) {
                  _lastGraph = graph;
                  ensureGraphUndoManager();
              }
          }, 1000);
      } catch (e) {
          console.warn('GraphUndoManager workflow watcher failed:', e);
      }
  } catch (e) {
      console.warn('GraphUndoManager initialization failed:', e);
  }
}

// Canvas visibility management
function updateCanvasVisibility() {
    if (window.selectedWorkflow) {
        litegraph_canvas.style.display = 'flex';
        no_workflow_message.style.display = 'none';
    } else {
        litegraph_canvas.style.display = 'none';
        no_workflow_message.style.display = 'flex';
    }
}

export { graph, canvas, updateCanvasVisibility, initializeCanvas };