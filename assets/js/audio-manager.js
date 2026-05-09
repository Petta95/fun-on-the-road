/* ============================================================
   Fun on the Road — Audio Manager
   Genera suoni sintetici via Web Audio API (no file esterni).
   Legge fotr_sfx da localStorage: "false" = disattivato.
   ============================================================ */

const AudioManager = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume se il browser l'ha sospeso (policy autoplay)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function isEnabled() {
    return localStorage.getItem('fotr_sfx') !== 'false';
  }

  function tone(frequency, type, duration, gain, delay = 0) {
    if (!isEnabled()) return;
    try {
      const ac   = getCtx();
      const osc  = ac.createOscillator();
      const env  = ac.createGain();
      osc.connect(env);
      env.connect(ac.destination);

      osc.type            = type;
      osc.frequency.value = frequency;

      const start = ac.currentTime + delay;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(gain, start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.start(start);
      osc.stop(start + duration + 0.05);
    } catch (_) { /* silenzioso su browser che bloccano AudioContext */ }
  }

  return {
    /* Tap / selezione */
    click() {
      tone(900, 'sine', 0.06, 0.18);
    },

    /* Risposta corretta */
    success() {
      tone(523, 'sine', 0.12, 0.25);
      tone(659, 'sine', 0.12, 0.25, 0.12);
      tone(784, 'sine', 0.20, 0.25, 0.24);
    },

    /* Risposta errata */
    error() {
      tone(280, 'sawtooth', 0.15, 0.22);
      tone(220, 'sawtooth', 0.20, 0.18, 0.15);
    },

    /* Vittoria partita */
    win() {
      const melody = [523, 659, 784, 1047];
      melody.forEach((f, i) => tone(f, 'sine', 0.22, 0.35, i * 0.13));
    },

    /* Countdown tick */
    tick() {
      tone(1200, 'sine', 0.04, 0.12);
    },

    /* Countdown ultimo secondo */
    lastTick() {
      tone(1600, 'sine', 0.08, 0.25);
    },
  };
})();
