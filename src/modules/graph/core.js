// graph/core.js
// Core graph functionality and canvas management

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