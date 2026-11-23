// Keyboard decoding is independent of iframe transport and renderer state.
const commands = Object.freeze({ ArrowLeft: 'previous', ArrowRight: 'next', k: 'previous', j: 'next', ' ': 'toggle' });
export function animationCommandForKey(key) { return commands[key] || null; }
