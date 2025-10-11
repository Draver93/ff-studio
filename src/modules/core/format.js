export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function fmtTime(sec) {
    const s = Math.floor(Math.abs(sec));
    const ms = Math.round((Math.abs(sec) - s) * 1000);
    const m = Math.floor(s / 60); const s2 = s % 60;
    return `${sec < 0 ? '-' : ''}${m}:${String(s2).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}
