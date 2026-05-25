(function (global) {
  'use strict';

  const TOKEN_KEY = 'nkbk_ai_token';
  const PROFILE_KEY = 'nkbk_ai_profile';

  function readStore(store, key) {
    try {
      return store.getItem(key) || '';
    } catch (_) {
      return '';
    }
  }

  function writeStore(store, key, value) {
    try {
      if (value) store.setItem(key, value);
      else store.removeItem(key);
    } catch (_) {}
  }

  function migrateFromSession(key) {
    const legacy = readStore(sessionStorage, key);
    if (!legacy) return '';
    writeStore(localStorage, key, legacy);
    try {
      sessionStorage.removeItem(key);
    } catch (_) {}
    return legacy;
  }

  const NkbkAiAuthStore = {
    getToken() {
      let token = readStore(localStorage, TOKEN_KEY);
      if (!token) token = migrateFromSession(TOKEN_KEY);
      return token;
    },
    setToken(token) {
      writeStore(localStorage, TOKEN_KEY, token || '');
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch (_) {}
    },
    getProfileRaw() {
      let raw = readStore(localStorage, PROFILE_KEY);
      if (!raw) raw = migrateFromSession(PROFILE_KEY);
      return raw;
    },
    setProfile(profile) {
      const raw = profile ? JSON.stringify(profile) : '';
      writeStore(localStorage, PROFILE_KEY, raw);
      try {
        sessionStorage.removeItem(PROFILE_KEY);
      } catch (_) {}
    },
    getProfile() {
      try {
        return JSON.parse(this.getProfileRaw() || '{}');
      } catch (_) {
        return {};
      }
    },
    clear() {
      this.setToken('');
      this.setProfile(null);
    }
  };

  global.NkbkAiAuthStore = NkbkAiAuthStore;
})(typeof window !== 'undefined' ? window : globalThis);
