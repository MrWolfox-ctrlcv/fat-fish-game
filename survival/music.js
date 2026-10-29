export function createMusic() {
  let context = null, master = null, timer = null, enabled = false, destroyed = false;
  let nextNoteAt = 0, noteIndex = 0;
  const melody = [392, 494, 587, 494, 440, 523, 659, 523, 392, 494, 587, 784, 659, 587, 494, 440];

  function ensureAudio() {
    if (context || destroyed) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    context = new AudioContextClass();
    master = context.createGain(); master.gain.value = 0.035; master.connect(context.destination);
  }
  function schedule() {
    if (!enabled || !context || context.state !== 'running') return;
    const now = context.currentTime;
    while (nextNoteAt < now + 0.4) {
      const start = Math.max(nextNoteAt, now + 0.02);
      const osc = context.createOscillator(), gain = context.createGain();
      osc.type = 'sine'; osc.frequency.value = melody[noteIndex++ % melody.length];
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.65, start + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
      osc.connect(gain); gain.connect(master); osc.start(start); osc.stop(start + 0.34);
      nextNoteAt = start + 0.36;
    }
  }
  async function toggle() {
    if (destroyed) return false;
    ensureAudio(); if (!context) return false;
    if (enabled) { enabled = false; clearInterval(timer); timer = null; await context.suspend(); return false; }
    enabled = true; await context.resume(); nextNoteAt = context.currentTime + 0.03;
    schedule(); timer = setInterval(schedule, 180); return true;
  }
  async function pause() { if (context && context.state === 'running') await context.suspend(); }
  async function resume() { if (enabled && context && context.state !== 'running') { await context.resume(); nextNoteAt=context.currentTime+0.02; schedule(); } }
  async function destroy() { destroyed=true;enabled=false;clearInterval(timer);timer=null;if(context){try{await context.close();}catch{}context=null;master=null;} }
  return { toggle, isEnabled: () => enabled, pause, resume, destroy };
}
