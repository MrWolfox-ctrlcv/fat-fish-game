const MAX_VOICES = 8;

export function createAudio() {
  let enabled = false;
  let context = null;
  const voices = new Set();
  let lastPartyAt = -Infinity;

  function getContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
  }

  function tone(frequency, duration, { type = "sine", gain = 0.07, delay = 0 } = {}) {
    if (!context || context.state !== "running" || !enabled || voices.size >= MAX_VOICES) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    const voice = { oscillator, envelope };
    voices.add(voice);
    oscillator.onended = () => voices.delete(voice);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }

  async function unlock() {
    if (!enabled) return false;
    const audioContext = getContext();
    if (!audioContext) return false;
    if (audioContext.state === "suspended") await audioContext.resume();
    return audioContext.state === "running";
  }

  function setEnabled(value) {
    enabled = !!value;
    if (!enabled) {
      for (const { oscillator } of voices) {
        try { oscillator.stop(); } catch { /* already stopped */ }
      }
      voices.clear();
    }
    return enabled;
  }

  function play(event) {
    if (!enabled || !context || context.state !== "running" || !event?.type) return;
    const now = context.currentTime;
    switch (event.type) {
      case "launch":
        tone(430, 0.075, { type: "sine", gain: 0.045 });
        break;
      case "hit":
        tone(610 + Math.min(8, event.combo || 0) * 23, 0.055, { type: "triangle", gain: 0.035 });
        break;
      case "break":
        tone(520, 0.11, { type: "sine", gain: 0.055 });
        tone(780, 0.12, { type: "triangle", gain: 0.04, delay: 0.035 });
        break;
      case "return":
        tone(350, 0.12, { type: "sine", gain: 0.04 });
        break;
      case "party": {
        if (now - lastPartyAt < 1) break;
        lastPartyAt = now;
        // Original four-note synth sting, intentionally short and playful.
        [659, 784, 988, 1175].forEach((note, i) => tone(note, 0.18, { type: "triangle", gain: 0.045, delay: i * 0.105 }));
        break;
      }
      case "round":
      case "upgrade":
        tone(587, 0.1, { type: "sine", gain: 0.04 });
        tone(740, 0.12, { type: "triangle", gain: 0.035, delay: 0.08 });
        break;
      case "end":
        tone(event.won ? 784 : 280, event.won ? 0.18 : 0.25, { type: "triangle", gain: 0.045 });
        break;
      default:
        break;
    }
  }

  async function dispose() {
    setEnabled(false);
    if (context) {
      const old = context;
      context = null;
      try { await old.close(); } catch { /* already closed */ }
    }
  }

  return { unlock, setEnabled, play, dispose };
}
