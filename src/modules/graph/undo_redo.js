// GraphUndoManager: per-graph in-memory undo/redo (max 10 snapshots)

export class GraphUndoManager {
  constructor(graph, options = {}) {
    this.graph = graph;
    this.maxHistory = options.maxHistory ?? 10;
    this.history = [];
    this.currentIndex = -1;
    this.isApplying = false;
    // Debounce: batch multiple rapid changes into a single snapshot
    this._debounceDelay = 250; // ms
    this._debounceTimer = null;
    this._pendingState = null;
    this._seedInitialState();
  }

  _seedInitialState() {
    const state = this._cloneState(this.graph.serialize());
    this.history = [state];
    this.currentIndex = 0;
  }

  _cloneState(state) {
    return JSON.stringify(state);
  }

  canUndo() {
    return this.currentIndex > 0;
  }

  canRedo() {
    return this.currentIndex < this.history.length - 1;
  }

  // Capture a new snapshot after a change (debounced to batch multiple changes)
  enqueueSnapshot() {
    if (this.isApplying) return;
    // Debounce: store the latest state and commit after a short delay
    this._pendingState = this._cloneState(this.graph.serialize());
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => this._commitPendingSnapshot(), this._debounceDelay);
  }

  _commitPendingSnapshot() {
    const nextState = this._pendingState;
    this._pendingState = null;
    this._debounceTimer = null;
    if (!nextState) return;
    const last = (this.currentIndex >= 0 && this.currentIndex < this.history.length) ? this.history[this.currentIndex] : null;
    if (last && JSON.stringify(nextState) === JSON.stringify(last)) {
      return;
    }
    // If we had undone some steps, truncate the redo path
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }
    this.history.push(nextState);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.currentIndex = this.maxHistory - 1;
    } else {
      this.currentIndex = this.history.length - 1;
    }
  }

  _applySnapshot(state) {
    this.isApplying = true;
    try {
      if (typeof state !== 'string' || state === null) {
        console.warn("GraphUndoManager: invalid snapshot state, skipping restore");
        return;
      }
      this.graph.configure(JSON.parse(state));
      if (typeof this.graph.updateExecutionOrder === 'function') {
        this.graph.updateExecutionOrder();
      }
    } catch (e) {
      console.error("GraphUndoManager: failed to apply snapshot", e);
    } finally {
      this.isApplying = false;
    }
  }

  undo() {
    if (!this.canUndo()) return;
    const targetIndex = this.currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= this.history.length) return;
    const snapshot = this.history[targetIndex];
    this._applySnapshot(snapshot);
    this.currentIndex = targetIndex;
  }

  redo() {
    if (!this.canRedo()) return;
    const targetIndex = this.currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= this.history.length) return;
    const snapshot = this.history[targetIndex];
    this._applySnapshot(snapshot);
    this.currentIndex = targetIndex;
  }

  resetHistory() {
    // Cancel any pending snapshot
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this._pendingState = null;
    }
    const current = this._cloneState(this.graph.serialize());
    this.history = [current];
    this.currentIndex = 0;
  }

  // Optional helper for tests/debugging
  getCurrentState() {
    return this._cloneState(this.history[this.currentIndex]);
  }
}
