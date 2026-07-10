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
  UNLOCK_ALL: 'com.francesco.fotr.unlock_all',   // €4.99 — Sblocca tutti i giochi
  FILM_QUIZ:  'com.francesco.fotr.film_quiz',    // €1.99 — Solo Film Quiz
  MUSIC_BUZZ: 'com.francesco.fotr.music_buzz',   // €1.99 — Solo Music Buzz
  HOT_PACK:   'com.francesco.fotr.hot_pack',     // €2.99 — Pack HOT (Trivia + Rather)
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

/* ── Log diagnostico persistente ────────────────────────────────
   Traccia ogni evento del ciclo di vita IAP (ordine, approvazione,
   verifica, finish, errori) in console + in un buffer localStorage,
   così se un acquisto resta bloccato si può capire a che punto è
   arrivato anche senza avere Xcode collegato in quel momento.
   Recupero log: Safari → Sviluppo → [dispositivo] → pagina → Console,
   oppure da localStorage.getItem('_fotr_iap_log') via Web Inspector.
   ─────────────────────────────────────────────────────────── */
var _IAP_LOG_KEY = '_fotr_iap_log';
function _iapLog(event, data) {
  try { console.log('[IAP]', event, data || ''); } catch (e) {}
  try {
    var log = JSON.parse(localStorage.getItem(_IAP_LOG_KEY) || '[]');
    log.push({ t: new Date().toISOString(), event: event, data: data || null });
    if (log.length > 150) { log = log.slice(-150); }
    localStorage.setItem(_IAP_LOG_KEY, JSON.stringify(log));
  } catch (e) {}
}

/* ── Toast errore visibile senza console ────────────────────── */
function _iapToast(msg) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);'
    + 'background:rgba(220,38,38,0.92);color:#fff;padding:10px 20px;border-radius:14px;'
    + 'font-size:13px;z-index:9999;max-width:80vw;text-align:center;pointer-events:none;'
    + 'box-shadow:0 4px 20px rgba(0,0,0,0.4)';
  document.body.appendChild(t);
  setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 4000);
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
    _iapLog('restore_start');
    return IAP._store.restorePurchases()
      .then(function () {
        _iapLog('restore_done');
        IAP._btnLoading(btn, false);
        return { restored: true };
      })
      .catch(function (e) {
        _iapLog('restore_error', { message: e && e.message ? e.message : String(e) });
        IAP._btnLoading(btn, false);
        return Promise.reject(e);
      });
  },

  /* ── Flusso acquisto nativo (cordova-plugin-purchase v13) ── */
  _native: function (key, btn) {
    return new Promise(function (resolve, reject) {
      var store   = IAP._store;
      var pid     = PRODUCT_ID[key];
      var settled = false;

      function done(result) {
        if (settled) { return; }
        settled = true;
        clearTimeout(safetyTimer);
        IAP._btnLoading(btn, false);
        if (result instanceof Error) { reject(result); } else { resolve(result); }
      }

      IAP._btnLoading(btn, true);
      _iapLog('order_start', { key: key, pid: pid });

      // Traccia se Apple ha già confermato il pagamento (transazione "approved")
      // prima che scada il timer di sicurezza: in tal caso i soldi sono presi
      // e NON dobbiamo invitare l'utente a "riprovare" (rischio doppio addebito),
      // ma solo ad attendere la verifica della ricevuta.
      var paymentApproved = false;
      store.when().approved(function (t) {
        var prods = t && t.products;
        if (!prods) { return; }
        for (var i = 0; i < prods.length; i++) {
          if (prods[i].id === pid) {
            paymentApproved = true;
            _iapLog('approved', { key: key, pid: pid });
            return;
          }
        }
      });

      // Libera il bottone dopo 30s se nessun evento definitivo arriva
      var safetyTimer = setTimeout(function () {
        if (paymentApproved) {
          _iapLog('timeout_pending_verification', { key: key, pid: pid });
          _iapToast('Pagamento ricevuto: verifica in corso, attendi qualche istante...');
          done({ success: false, reason: 'pending_verification' });
        } else {
          _iapLog('timeout_no_payment', { key: key, pid: pid });
          _iapToast('Acquisto non completato. Riprova.');
          done({ success: false, reason: 'timeout' });
        }
      }, 30000);

      // Ascolta il completamento reale della transazione ("finished", non
      // "productUpdated" — quest'ultimo si attiva solo al caricamento dei
      // metadati prodotto, MAI dopo un acquisto, quindi era l'evento sbagliato).
      store.when().finished(function (t) {
        var prods = t && t.products;
        if (!prods) { return; }
        for (var i = 0; i < prods.length; i++) {
          if (prods[i].id !== pid) { continue; }
          var wasAlreadySettled = settled;
          _iapLog('finished', { key: key, pid: pid, lateArrival: wasAlreadySettled });
          _markPurchased(key);
          if (wasAlreadySettled) {
            // Conferma arrivata dopo il timeout: lo sblocco è ora completo.
            // Avvisa l'utente e ricarica la UI.
            _iapToast('Acquisto confermato! Contenuto sbloccato.');
            setTimeout(function () { location.reload(); }, 1200);
          } else {
            done({ success: true, productKey: key });
          }
          return;
        }
      });

      // CdvPurchase v13: order() richiede un oggetto Offer, non solo l'ID stringa
      var product = store.get(pid, CdvPurchase.Platform.APPLE_APPSTORE);
      if (!product) {
        _iapLog('product_not_loaded', { key: key, pid: pid });
        _iapToast('Prodotto non ancora caricato. Attendi qualche secondo e riprova.');
        done({ success: false, reason: 'product_not_loaded' });
        return;
      }
      var offer = product.getOffer ? product.getOffer() : null;
      if (!offer) {
        _iapLog('no_offer', { key: key, pid: pid });
        _iapToast('Offerta non disponibile. Riprova tra un momento.');
        done({ success: false, reason: 'no_offer' });
        return;
      }

      store.order(offer)
        .then(function (res) {
          if (!res || !res.isError) { return; } // attende productUpdated
          var isCdv     = typeof CdvPurchase !== 'undefined';
          var cancelled = isCdv && (res.code === CdvPurchase.ErrorCode.PAYMENT_CANCELLED);
          if (cancelled) {
            _iapLog('order_cancelled', { key: key, pid: pid });
            done({ success: false, reason: 'cancelled' });
          } else {
            _iapLog('order_error', { key: key, pid: pid, code: res.code, message: res.message });
            _iapToast('Errore acquisto: ' + (res.message || res.code || 'sconosciuto'));
            done(Object.assign(new Error('IAP error'), res));
          }
        })
        .catch(function (e) {
          _iapLog('order_exception', { key: key, pid: pid, message: e && e.message ? e.message : String(e) });
          _iapToast('Errore: ' + (e && e.message ? e.message : String(e)));
          done(e instanceof Error ? e : new Error(String(e)));
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
    _iapToast(lang === 'it'
      ? 'Acquisti disponibili solo nell\'app installata dallo Store.'
      : 'In-app purchases are only available in the installed app.');
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

    // Ciclo di vita transazioni: NON usiamo un validator (nessun server di
    // verifica ricevute configurato), quindi l'evento "verified" non si
    // attiverebbe mai (richiede un validator per definizione del plugin) e
    // "finish()" non verrebbe mai chiamato. Chiudiamo la transazione subito
    // all'approvazione, come da pattern ufficiale del plugin per chi non usa
    // un validator (vedi doc di store.when()).
    store.when().approved(function (t) {
      _iapLog('global_approved', { pids: t.products && t.products.map(function (p) { return p.id; }) });
      t.finish();
    });

    // Segnale autoritativo di acquisto completato/riconosciuto da StoreKit.
    store.when().finished(function (t) {
      var pids = t.products && t.products.map(function (p) { return p.id; });
      _iapLog('global_finished', { pids: pids });
      (pids || []).forEach(function (pid) {
        Object.keys(PRODUCT_ID).forEach(function (k) {
          if (PRODUCT_ID[k] === pid) { _markPurchased(k); }
        });
      });
    });

    // Rete di sicurezza: se la ricevuta locale cambia per un altro motivo
    // (restore, sync di un'altra sessione), ricontrolla l'ownership.
    store.when().receiptUpdated(function () {
      _iapLog('global_receipt_updated');
      Object.keys(PRODUCT_ID).forEach(function (k) {
        if (store.owned(PRODUCT_ID[k])) { _markPurchased(k); }
      });
    });

    // Errori a livello di store (rete, configurazione, StoreKit) altrimenti silenti
    if (typeof store.error === 'function') {
      store.error(function (err) {
        _iapLog('store_error', { code: err && err.code, message: err && err.message });
      });
    }

    // Al ritorno in foreground, riconcilia eventuali transazioni rimaste a
    // metà (es. app chiusa mentre la verifica della ricevuta era in corso):
    // store.update() ricontrolla la coda e riemette gli eventi mancanti.
    document.addEventListener('resume', function () {
      if (!IAP._store || typeof IAP._store.update !== 'function') { return; }
      _iapLog('resume_update');
      IAP._store.update();
    }, false);

    var initResult = store.initialize([
      CdvPurchase.Platform.APPLE_APPSTORE,
      CdvPurchase.Platform.GOOGLE_PLAY,
    ]);
    // store.initialize() e' una Promise in CdvPurchase v13; controllo difensivo
    // nel caso l'API non la restituisca, per non rompere l'init in quel caso.
    if (initResult && typeof initResult.then === 'function') {
      initResult.then(function () {
        _iapLog('init_done');
      }).catch(function (e) {
        _iapLog('init_error', { message: e && e.message ? e.message : String(e) });
      });
    }
  },
};

// Avvio automatico quando Capacitor/Cordova è pronto
document.addEventListener('deviceready', IAP._init, false);
