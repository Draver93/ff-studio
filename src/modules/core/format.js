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

// Convert text to a simple hash
function textToHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Convert hash to a pastel color (HSL)
function hashToPastelColor(hash) {
  const hue = hash % 360;        // Hue between 0–360
  const saturation = 70 + (hash % 10); // Keep saturation soft (~70–80%)
  const lightness = 80;          // High lightness = pastel look
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Combine both steps
export function textToPastelColor(text) {
  const hash = textToHash(text);
  return hashToPastelColor(hash);
}