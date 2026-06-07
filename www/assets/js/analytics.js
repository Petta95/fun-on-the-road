/* Fun on the Road — Amplitude Analytics */
(function () {
  if (typeof amplitude === 'undefined') return;
  if (window._fotrAmplitudeReady) return;
  window._fotrAmplitudeReady = true;

  amplitude.initAll('b7682fe9e4194d2b2fbdae96fc9a7bab', {
    serverZone: 'EU',
    analytics: { autocapture: true },
    sessionReplay: { sampleRate: 1 },
  });

  /* Lightweight wrapper — swallows errors so analytics never breaks the app */
  window.fotrTrack = function (eventName, props) {
    try {
      amplitude.track(eventName, props || {});
    } catch (_) {}
  };
})();
