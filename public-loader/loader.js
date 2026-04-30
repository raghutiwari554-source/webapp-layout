/* =====================================================================
   LOADER  —  PUBLIC GitHub repo (served via jsDelivr CDN)
   ---------------------------------------------------------------------
   1. Replace SERVER and HOMEPAGE values below with YOUR URLs.
   2. (Recommended) Run this file through https://obfuscator.io
      using "High obfuscation" preset before committing.
   3. Push to a PUBLIC GitHub repo. Then jsDelivr URL is:
        https://cdn.jsdelivr.net/gh/<USER>/<REPO>@<BRANCH>/loader.js
   ===================================================================== */
(function () {
  var SERVER   = 'https://token-auth-server.onrender.com';
  var HOMEPAGE = 'https://token-auth-server.onrender.com/keygen';
  var HEARTBEAT_MS      = 5000;
  var CHECK_MS          = 3000;
  var REDIRECT_DELAY_MS = 6000;

  // -------- Device fingerprint (must match homepage logic) --------
  function fp() {
    try {
      var c = document.createElement('canvas');
      var ctx = c.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 100, 30);
      ctx.fillStyle = '#069'; ctx.fillText('fp-' + navigator.userAgent, 2, 2);
      var data = c.toDataURL();
      var raw = [
        navigator.userAgent, navigator.language,
        screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 0,
        navigator.deviceMemory || 0,
        navigator.platform, data,
      ].join('|');
      var h = 0;
      for (var i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
      return 'fp_' + Math.abs(h).toString(36) + '_' + raw.length.toString(36);
    } catch (e) {
      return 'fp_fallback_' + (navigator.userAgent || '').length;
    }
  }

  // -------- UI overlays --------
  function injectStyles() {
    if (document.getElementById('__tokstyle')) return;
    var s = document.createElement('style');
    s.id = '__tokstyle';
    s.textContent =
      '#__tokoverlay{position:fixed;inset:0;background:#0b0b14;color:#fff;z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}' +
      '#__tokoverlay .box{text-align:center;max-width:420px;padding:32px;}' +
      '#__tokoverlay .spin{width:46px;height:46px;border:3px solid #2a2a44;border-top-color:#7c5cff;border-radius:50%;margin:0 auto 18px;animation:tokspin 0.9s linear infinite;}' +
      '#__tokoverlay h2{margin:0 0 8px;font-weight:600;font-size:18px;}' +
      '#__tokoverlay p{margin:0;color:#a8a8c0;font-size:14px;line-height:1.5;}' +
      '#__tokpopup{position:fixed;inset:0;background:rgba(8,8,15,0.92);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}' +
      '#__tokpopup .card{background:#15151f;border:1px solid #ff4d6d33;border-radius:14px;padding:28px;max-width:440px;text-align:center;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.5);}' +
      '#__tokpopup .ic{width:56px;height:56px;border-radius:50%;background:#ff4d6d22;color:#ff4d6d;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 14px;}' +
      '#__tokpopup h3{margin:0 0 8px;font-size:20px;}' +
      '#__tokpopup .reason{margin:6px 0 16px;color:#ffb4c1;font-size:14px;}' +
      '#__tokpopup .count{color:#9090aa;font-size:13px;}' +
      '@keyframes tokspin{to{transform:rotate(360deg);}}';
    document.documentElement.appendChild(s);
  }

  function showVerifying(msg) {
    injectStyles();
    var el = document.getElementById('__tokoverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = '__tokoverlay';
      el.innerHTML = '<div class="box"><div class="spin"></div><h2>Verifying access</h2><p id="__tokmsg"></p></div>';
      document.documentElement.appendChild(el);
    }
    document.getElementById('__tokmsg').textContent = msg || 'Please wait...';
  }

  function hideVerifying() {
    var el = document.getElementById('__tokoverlay');
    if (el) el.remove();
  }

  function showRevoked(reason) {
    injectStyles();
    var pop = document.getElementById('__tokpopup');
    if (pop) pop.remove();
    pop = document.createElement('div');
    pop.id = '__tokpopup';
    pop.innerHTML =
      '<div class="card"><div class="ic">!</div><h3>Access Revoked</h3>' +
      '<div class="reason"></div>' +
      '<div class="count">Redirecting in <span id="__toksec">' + (REDIRECT_DELAY_MS / 1000) + '</span>s...</div></div>';
    document.documentElement.appendChild(pop);
    pop.querySelector('.reason').textContent = reason || 'Session ended.';

    var s = REDIRECT_DELAY_MS / 1000;
    var t = setInterval(function () {
      s--;
      var el = document.getElementById('__toksec');
      if (el) el.textContent = s;
      if (s <= 0) clearInterval(t);
    }, 1000);

    setTimeout(function () {
      try {
        sessionStorage.removeItem('__tok_session');
        sessionStorage.removeItem('__tok_key');
      } catch (e) {}
      window.location.href = HOMEPAGE;
    }, REDIRECT_DELAY_MS);
  }

  // -------- Networking --------
  function post(p, body) {
    return fetch(SERVER + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit', cache: 'no-store',
    }).then(function (r) { return r.json(); });
  }
  function getCheck(token) {
    return fetch(SERVER + '/api/check?t=' + encodeURIComponent(token), {
      credentials: 'omit', cache: 'no-store',
    }).then(function (r) { return r.json(); });
  }

  // -------- State --------
  var fingerprint = fp();
  var sessionToken = null;
  var heartbeatTimer = null;
  var checkTimer = null;
  var stopped = false;
  var consecFail = 0;

  function stopAll(reason) {
    if (stopped) return;
    stopped = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (checkTimer) clearInterval(checkTimer);
    showRevoked(reason);
  }

  function startLoops() {
    heartbeatTimer = setInterval(function () {
      post('/api/heartbeat', { sessionToken: sessionToken, fingerprint: fingerprint })
        .then(function (r) {
          if (!r.ok) stopAll(r.reason || 'Session ended');
          else consecFail = 0;
        })
        .catch(function () {
          consecFail++;
          if (consecFail >= 3) stopAll('Network error — connection lost');
        });
    }, HEARTBEAT_MS);

    checkTimer = setInterval(function () {
      getCheck(sessionToken).then(function (r) {
        if (!r.ok) stopAll(r.reason || 'Session ended');
      }).catch(function () {});
    }, CHECK_MS);

    window.addEventListener('pagehide', function () {
      try {
        var data = JSON.stringify({ sessionToken: sessionToken });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(SERVER + '/api/end-session',
            new Blob([data], { type: 'application/json' }));
        }
      } catch (e) {}
    });
  }

  // -------- main.js fetch + inject --------
  function injectMain() {
    var url = SERVER + '/api/main.js?t=' + encodeURIComponent(sessionToken)
            + '&f=' + encodeURIComponent(fingerprint)
            + '&_=' + Date.now();
    return fetch(url, { credentials: 'omit', cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (code) {
        if (!code || code.indexOf('main_denied:') !== -1) {
          throw new Error('main.js denied by server');
        }
        // Execute in global scope
        try {
          (1, eval)(code);
        } catch (e) {
          var s = document.createElement('script');
          s.textContent = code;
          (document.head || document.documentElement).appendChild(s);
        }
      });
  }

  // -------- Bootstrap --------
  function init() {
    showVerifying('Validating your session...');

    var key = null;
    try {
      var params = new URLSearchParams(window.location.search);
      key = params.get('key');
      if (key) {
        sessionStorage.setItem('__tok_key', key);
        params.delete('key');
        var newUrl = window.location.pathname + (params.toString() ? '?' + params : '') + window.location.hash;
        window.history.replaceState({}, '', newUrl);
      } else {
        key = sessionStorage.getItem('__tok_key');
      }
    } catch (e) {}

    var existing = null;
    try { existing = sessionStorage.getItem('__tok_session'); } catch (e) {}

    if (existing) {
      sessionToken = existing;
      getCheck(sessionToken).then(function (r) {
        if (r.ok) {
          afterAuth();
        } else {
          try { sessionStorage.removeItem('__tok_session'); } catch (e) {}
          if (key) startNew(key);
          else stopAll('Session expired. Please generate a new key.');
        }
      }).catch(function () { stopAll('Cannot reach auth server.'); });
      return;
    }

    if (!key) {
      stopAll('No access key found. Please generate one from the homepage.');
      return;
    }
    startNew(key);
  }

  function startNew(key) {
    post('/api/start-session', { key: key, fingerprint: fingerprint })
      .then(function (r) {
        if (!r.ok) { stopAll(r.error || 'Could not start session'); return; }
        sessionToken = r.sessionToken;
        try { sessionStorage.setItem('__tok_session', sessionToken); } catch (e) {}
        afterAuth();
      })
      .catch(function () { stopAll('Cannot reach auth server.'); });
  }

  function afterAuth() {
    injectMain()
      .then(function () {
        hideVerifying();
        startLoops();
      })
      .catch(function (e) {
        stopAll('Could not load app code: ' + (e && e.message || 'unknown'));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
 
