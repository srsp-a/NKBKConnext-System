/**
 * Shared chime for new Monee chat messages (member widget + staff inboxes).
 */
(function () {
  'use strict';
  var audioCache = null;
  var lastPlayedAt = 0;
  var unlocked = false;

  function soundCandidates() {
    return ['/sounds/monee-notify-chime.mp3', 'sounds/monee-notify-chime.mp3'];
  }

  function ensureAudio() {
    if (audioCache) return audioCache;
    var paths = soundCandidates();
    for (var i = 0; i < paths.length; i++) {
      try {
        audioCache = new Audio(paths[i]);
        audioCache.volume = 0.5;
        audioCache.preload = 'auto';
        return audioCache;
      } catch (_) {}
    }
    return null;
  }

  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      var a = ensureAudio();
      if (!a) return;
      a.volume = 0.01;
      var p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          a.pause();
          a.currentTime = 0;
          a.volume = 0.5;
        }).catch(function () {
          a.volume = 0.5;
        });
      } else {
        a.volume = 0.5;
      }
    } catch (_) {}
  }

  window.playMoneeChatNotifySound = function () {
    try {
      var now = Date.now();
      if (now - lastPlayedAt < 900) return;
      lastPlayedAt = now;
      var a = ensureAudio();
      if (!a) return;
      a.volume = 0.5;
      a.currentTime = 0;
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {}
  };

  window.unlockMoneeChatNotifySound = unlockAudio;

  function bindUnlockOnce() {
    var done = function () {
      unlockAudio();
      document.removeEventListener('click', done, true);
      document.removeEventListener('keydown', done, true);
      document.removeEventListener('touchstart', done, true);
    };
    document.addEventListener('click', done, true);
    document.addEventListener('keydown', done, true);
    document.addEventListener('touchstart', done, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUnlockOnce);
  } else {
    bindUnlockOnce();
  }
})();
