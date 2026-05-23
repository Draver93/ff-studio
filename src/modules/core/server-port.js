export function serverUrl(path) {
    const port = window.__SERVER_PORT__ || 9200;
    return `http://127.0.0.1:${port}/${encodeURIComponent(path)}`;
}
