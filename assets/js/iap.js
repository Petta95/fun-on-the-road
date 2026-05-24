'use strict';

/* ══════════════════════════════════════════════════════════════
   CONFIGURA I PRODUCT ID PRIMA DI PUBBLICARE SULL'APP STORE
   ══════════════════════════════════════════════════════════════
   Sostituisci i placeholder con gli ID reali da:
   - iOS  → App Store Connect  → My Apps → In-App Purchases
   - Android → Google Play Console → Monetizzazione → Prodotti in-app

   Plugin richiesto (esegui dopo aver creato il progetto Capacitor):
     npm install cordova-plugin-purchase
     npx cap sync
   ══════════════════════════════════════════════════════════════ */
var PRODUCT_ID = {
  UNLOCK_ALL: 'com.yourcompany.fotr.unlock_all',   // €4.99 — Sblocca tutti i giochi
  FILM_QUIZ:  'com.yourcompany.fotr.film_quiz',    // €1.99 — Solo Film Quiz
  MUSIC_BUZZ: 'com.yourcompany.fotr.music_buzz',   // €1.99 — Solo Music Buzz
  HOT_PACK:   'com.yourcompany.fotr.hot_pack',     // €3.49 — Pack HOT (Trivia + Rather)
};
/* ══════════════════════════════════════════════════════════════ */

// Mapping: chiave interna → chiave legacy in localStorage (per compatibilità con il codice esistente)
var _LEGACY_KEY = {
  UNLOCK_ALL: 'all',
  FILM_QUIZ:  'filmQuiz',
  MUSIC_BUZZ: 'musicBuzz',
  HOT_PACK:   'hotPack',
};

/* ── Storage offuscato ──────────────────────────────────────────
   XOR + base64 per rendere più difficile la manomissione del
   localStorage. Non sostituisce la verifica server-side, ma
   impedisce modifiche banali con DevTools.
   ─────────────────────────────────────────────────────────── */
var _LS_KEY  = '_fotr_pu';
var _LS_SALT = 'fotr·2025xK7!mR9#';

function _xor(str, key) {
  var r = '';
  for (var i = 0; i < str.length; i++) {
    r += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return r;
}

function _loadState() {
  try {
    var raw = localStorage.getItem(_LS_KEY);
    if (!raw) return {};
    return JSON.parse(_xor(decodeURIComponent(escape(atob(raw))), _LS_SALT));
  } catch (e) { return {}; }
}

function _saveState(s) {
  try {
    localStorage.setItem(_LS_KEY, btoa(unescape(encodeURIComponent(_xor(JSON.stringify(s), _LS_SALT)))));
  } catch (e) {}
  // Retrocompatibilità: mantiene aggiornate le chiavi legacy lette da ogni pagina di gioco
  localStorage.setItem('isPremium', (s.all || s.hotPack) ? 'true' : 'false');
  var legacy = {};
  if (s.all)       { legacy.all       = true; }
  if (s.filmQuiz)  { legacy.filmQuiz  = true; }
  if (s.musicBuzz) { legacy.musicBuzz = true; }
  localStorage.setItem('fotr_purchases', JSON.stringify(legacy));
}

function _markPurchased(key) {
  var s  = _loadState();
  var lk = _LEGACY_KEY[key];
  if (lk) { s[lk] = true; }
  if (key === 'UNLOCK_ALL') { s.all = true; }  // UNLOCK_ALL include anche isPremium
  _saveState(s);
}

/* ── Modulo IAP ─────────────────────────────────────────────── */
var IAP = {
  _store: null,

  /** Controlla se un prodotto è già sbloccato */
  isPurchased: function (key) {
    var s = _loadState();
    return !!(s[_LEGACY_KEY[key]] || s.all);
  },

  /**
   * Avvia il flusso di acquisto nativo.
   * @param {string} key   - Chiave prodotto (es. 'FILM_QUIZ', 'HOT_PACK', 'UNLOCK_ALL')
   * @param {Element} btn  - Pulsante trigger (opzionale, riceve stato loading)
   * @returns {Promise<{success: boolean, reason?: string}>}
   */
  purchase: function (key, btn) {
    if (!IAP._store) { return IAP._fallback(); }
    return IAP._native(key, btn);
  },

  /**
   * Ripristina acquisti precedenti — obbligatorio per iOS App Store.
   * @param {Element} btn - Pulsante trigger (opzionale)
   */
  restore: function (btn) {
    if (!IAP._store) { return IAP._fallback(); }
    IAP._btnLoading(btn, true);
    return IAP._store.restorePurchases()
      .then(function () {
        IAP._btnLoading(btn, false);
        return { restored: true };
      })
      .catch(function (e) {
        IAP._btnLoading(btn, false);
        return Promise.reject(e);
      });
  },

  /* ── Flusso acquisto nativo (cordova-plugin-purchase v13) ── */
  _native: function (key, btn) {
    return new Promise(function (resolve, reject) {
      var store = IAP._store;
      var pid   = PRODUCT_ID[key];
      IAP._btnLoading(btn, true);

      // Ascolta ownership del prodotto specifico
      var unsub = store.when().productUpdated(function (p) {
        if (p.id !== pid || !p.owned) { return; }
        unsub();
        _markPurchased(key);
        IAP._btnLoading(btn, false);
        resolve({ success: true, productKey: key });
      });

      // Avvia l'ordine sullo store
      store.order(pid)
        .then(function (res) {
          if (!res || !res.isError) { return; }
          IAP._btnLoading(btn, false);
          var cancelled = (typeof CdvPurchase !== 'undefined') &&
                          (res.code === CdvPurchase.ErrorCode.PAYMENT_CANCELLED);
          cancelled
            ? resolve({ success: false, reason: 'cancelled' })
            : reject(res);
        })
        .catch(function (e) {
          IAP._btnLoading(btn, false);
          reject(e);
        });
    });
  },

  /* ── UI helper: stato loading sul pulsante ─────────────── */
  _btnLoading: function (btn, on) {
    if (!btn) { return; }
    if (on) {
      btn._iapHTML = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      btn.disabled  = true;
    } else {
      btn.innerHTML = btn._iapHTML || btn.innerHTML;
      btn.disabled  = false;
    }
  },

  /* ── Fallback web/browser ──────────────────────────────── */
  _fallback: function () {
    var lang = localStorage.getItem('fotr_lang') || 'en';
    alert(lang === 'it'
      ? 'Gli acquisti in-app sono disponibili solo nell\'app installata dallo Store.'
      : 'In-app purchases are available only in the installed app. Download it from the Store!');
    return Promise.resolve({ success: false, reason: 'web_mode' });
  },

  /* ── Inizializzazione plugin (chiamato da deviceready) ─── */
  _init: function () {
    if (IAP._store || typeof CdvPurchase === 'undefined') { return; }
    var store  = CdvPurchase.store;
    IAP._store = store;

    // Registra tutti i prodotti per entrambe le piattaforme
    var list = [];
    Object.keys(PRODUCT_ID).forEach(function (k) {
      [CdvPurchase.Platform.APPLE_APPSTORE, CdvPurchase.Platform.GOOGLE_PLAY].forEach(function (pl) {
        list.push({
          id:       PRODUCT_ID[k],
          type:     CdvPurchase.ProductType.NON_CONSUMABLE,
          platform: pl,
        });
      });
    });
    store.register(list);

    // Ciclo di vita transazioni: verifica e conferma automatica
    store.when()
      .approved(function (t) { t.verify(); })
      .verified(function (r) { r.finish(); });

    // Applica ownership al caricamento e al restore
    store.when().productUpdated(function (p) {
      if (!p.owned) { return; }
      Object.keys(PRODUCT_ID).forEach(function (k) {
        if (PRODUCT_ID[k] === p.id) { _markPurchased(k); }
      });
    });

    store.initialize([
      CdvPurchase.Platform.APPLE_APPSTORE,
      CdvPurchase.Platform.GOOGLE_PLAY,
    ]);
  },
};

// Avvio automatico quando Capacitor/Cordova è pronto
document.addEventListener('deviceready', IAP._init, false);
