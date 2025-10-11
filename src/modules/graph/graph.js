import * as core from './core.js';
import * as clipboard from './clipboard.js';
import * as import_export from './import_export.js';
import * as execution from './execution.js';

export function initializeGraph() {
    core.initializeCanvas();

    execution.initializeExecution();

    import_export.initializeImportExport();

    clipboard.initializeClipboard();
}