// The application chrome contains dark controls. Local editor highlighting is
// independent: only the shell falls back when its palette cannot suit them.
export function luminance(hex) {
  const match = /^#([\da-f]{6})$/i.exec(String(hex));
  if (!match) return null;
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  if (a === null || b === null) return 0;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function readableShell(shell, fallback) {
  // Preserve built-in palettes and readable dark local themes. A light editor
  // can still retain all its native colors without whitening dark-only chrome.
  const lightBackground = luminance(shell?.background);
  const lightPanel = luminance(shell?.panel);
  if (lightBackground === null || lightPanel === null || lightBackground > 0.179 || lightPanel > 0.179
      || contrast(shell.text, shell.background) < 4.5 || contrast(shell.text, shell.panel) < 4.5) return fallback;
  return shell;
}
