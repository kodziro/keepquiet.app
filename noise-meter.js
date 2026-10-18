/*
  Keep Quiet – free online classroom noise meter (keepquiet.app)
  Plain JS, no framework, no build step. Phase 2, tool 1.
  Layout and controls follow the iOS app (see GEO-LOG 2026-10-18 UI inventory).

  How it works
  - Microphone → getUserMedia → AudioContext → AnalyserNode → RMS of the
    time-domain signal → smoothed loudness 0–100 (internal only; no decibel
    numbers are shown anywhere, the dial and bar carry no text).
  - 3 levels: 0–40 = state 1 (cat happy / park), 40–75 = state 2 (cat sad /
    street), 75–100 = state 3 (ears covered / airport). Going up is instant,
    going down waits ~1 s below the threshold (hysteresis). The sensitivity
    slider scales the loudness (= scaling all thresholds); saved in localStorage.
  - Indicator: speedometer dial (default) or bar with a diamond marker, like
    the app; never both. Saved in localStorage.
  - Privacy: audio never leaves the device — sound is analysed in the
    browser, nothing is recorded, stored or sent. The only network calls are
    TelemetryDeck counts (tool-start, tool-session, visit, pro-view, pro-click,
    mic-error, mic-switch, fullscreen) with no audio, no IDs and no free text —
    every value is a bucketed string.
  - AudioContext is created and resumed only inside the first play click
    (iPad Safari). AGC / noise suppression / echo cancellation are off so
    the meter reflects the room, not the browser's voice processing.

  Markup contract (tool-test.html; index.html uses the same block):
    <div id="noise-meter" class="nm" data-assets="assets/tool/">
      <div class="nm-stage">                              ← goes fullscreen
        <div class="nm-scenes"><picture class="nm-scene is-active" data-level="1">…city-1…</picture></div>
        <div class="nm-chars"><picture class="nm-char is-active" data-state="1">…cat-1…</picture></div>
        <div class="nm-indicator"><svg class="nm-dial">…<g class="nm-needle">…</g></svg></div>
        <p class="nm-msg" role="status"></p>
        <button class="nm-play-big" type="button" aria-label="Start">…play icon…</button>   ← centre, hidden while running
        <div class="nm-bottom"><button class="nm-play" type="button" aria-label="Start">…play + pause icons…</button></div>
      </div>
      <div class="nm-microw"></div>                       ← mic selector row, filled by this script
    </div>
  This script adds: round fullscreen button (top-left), round settings button
  (top-right), the settings sheet (Character, Background, Indicator,
  Microphone, Sensitivity), the bar indicator, and the mic row.
  Only cat-1 + city-1 are in the HTML (first paint). States 2–3 and scene
  levels 2–3 are added as <picture> elements after start, so the browser
  picks WebP or the fallback itself — PNG/JPEG fallbacks are never preloaded
  by hand. Thumbnails are created only when the settings sheet first opens.

  Stage height: --nm-above (px above the stage: header + hero) is measured on
  load/resize and set on the root; CSS makes the stage max(480px, 100svh - that).
  Every signal is also dispatched as a "kq:signal" CustomEvent on the root
  (detail {type, payload}) so tool-test.html can log it.

  Optional page hooks:
    #pro-card                 → scrolled to + highlighted on a locked-item click;
                                pro-view is sent once when it is ≥ 50 % visible
    [data-kq-notify]          → "Notify me" button: counted pro-click (item "notify"),
                                then shows [data-kq-notify-thanks]
    body[data-td-test="1"]    → TelemetryDeck test mode (used by tool-test.html)
*/
(function () {
  'use strict';

  var root = document.getElementById('noise-meter');
  if (!root) return;

  /* ---------- configuration ---------- */
  var ASSETS = root.getAttribute('data-assets') || 'assets/tool/';
  var THRESH_UP = [40, 75];          // level 1→2 at 40, 2→3 at 75 (0–100 scale)
  var DOWN_MARGIN = 3;               // must drop this far below a threshold …
  var DOWN_HOLD_MS = 1000;           // … for this long before going down a level
  var ATTACK = 0.5, RELEASE = 0.08;  // smoothing per frame (fast up, slow down)
  var DB_FLOOR = -60, DB_SPAN = 45;  // internal: -60 dBFS → 0, -15 dBFS → 100
  var NEEDLE_MIN = -100, NEEDLE_MAX = 100;   // degrees, matches the arc in the SVG
  var STEP_POS = [0, 20, 57, 88];    // reduced motion: one fixed position per level
  var LS_SENS = 'kq-nm-sensitivity', LS_MIC = 'kq-nm-mic', LS_IND = 'kq-nm-indicator';
  var LS_VISITS = 'kq-visits', LS_FIRST = 'kq-first-seen';

  // Names are used ONLY in alt / aria-label text, never as visible labels.
  var CHARACTERS = [
    { id: 'cat', free: true, states: 3, name: 'Cat' },
    { id: 'dog', name: 'Dog' }, { id: 'crocodile', name: 'Crocodile' },
    { id: 'squirrel', name: 'Squirrel' }, { id: 'tiger', name: 'Tiger' },
    { id: 'parrot', name: 'Parrot' }, { id: 'owl', name: 'Owl' }, { id: 'robot', name: 'Robot' }
  ];
  var SCENES = [
    { id: 'city', free: true, levels: 3, name: 'City' },
    { id: 'beach', name: 'Beach' }, { id: 'ice', name: 'Ice and mountains' },
    { id: 'space', name: 'Earth and space' }, { id: 'forest', name: 'Forest' }
  ];
  var JPEG_FIRST = { 'city-2': true, 'city-3': true };   // grain: JPEG smaller than WebP
  var STATE_ALT = ['', 'happy', 'sad, ears down', 'eyes shut, paws on ears'];
  var LEVEL_TEXT = ['', 'Quiet', 'Getting loud', 'Too loud'];

  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.52.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="5" height="17" rx="1.6"/><rect x="14" y="3.5" width="5" height="17" rx="1.6"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3v18M12 3v18M18 3v18"/><circle cx="6" cy="9" r="2.3" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="2.3" fill="currentColor" stroke="none"/><circle cx="18" cy="7" r="2.3" fill="currentColor" stroke="none"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    miniBar: '<svg viewBox="0 0 120 56" aria-hidden="true"><defs><linearGradient id="nm-gb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3ABF5A"/><stop offset=".45" stop-color="#F2D22B"/><stop offset=".72" stop-color="#F58A2A"/><stop offset="1" stop-color="#F0423B"/></linearGradient></defs><rect x="6" y="10" width="108" height="36" rx="10" fill="url(#nm-gb)"/><rect x="50" y="18" width="20" height="20" rx="4" fill="#fff" transform="rotate(45 60 28)"/></svg>',
    miniDial: '<svg viewBox="0 0 120 70" aria-hidden="true"><defs><linearGradient id="nm-gd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3ABF5A"/><stop offset=".45" stop-color="#F2D22B"/><stop offset=".72" stop-color="#F58A2A"/><stop offset="1" stop-color="#F0423B"/></linearGradient></defs><path d="M20 58A42 42 0 1 1 100 58" fill="none" stroke="url(#nm-gd)" stroke-width="13" stroke-linecap="round"/><g transform="rotate(60 60 58)"><line x1="60" y1="58" x2="60" y2="30" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/><path d="M60 22l-5 10h10z" fill="#fff"/><circle cx="60" cy="58" r="3.5" fill="#fff"/></g></svg>'
  };

  /* ---------- DOM ---------- */
  var stage = root.querySelector('.nm-stage');
  var scenesBox = root.querySelector('.nm-scenes');
  var charsBox = root.querySelector('.nm-chars');
  var indicator = root.querySelector('.nm-indicator');
  var needle = root.querySelector('.nm-needle');
  var msg = root.querySelector('.nm-msg');
  var playBtn = root.querySelector('.nm-play');
  var bigBtn = root.querySelector('.nm-play-big');
  var micRow = root.querySelector('.nm-microw');

  var reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reducedMotion) root.classList.add('nm-reduced');

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- TelemetryDeck (same SDK + request as assets/appstore-click.js) ---------- */
  var APP_ID = '43A2ECAF-E4DA-4440-B847-7A1FCE01600C';
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@telemetrydeck/sdk@2.0.4/dist/telemetrydeck.js';
  var td = null, tdQueue = [];
  function pageSlug() {
    var explicit = document.body && document.body.getAttribute('data-td-page');
    if (explicit) return explicit;
    var path = location.pathname.replace(/\/index\.html$/, '/');
    if (path === '' || path === '/') return 'home';
    var name = path.replace(/^.*\//, '').replace(/\.html$/, '');
    return name || 'home';
  }
  function referrerHost() { try { return document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { return ''; } }
  function source() {
    var utm = '';
    try { utm = new URLSearchParams(location.search).get('utm_source') || ''; } catch (e) {}
    if (utm) return utm.toLowerCase().slice(0, 100);
    var host = referrerHost();
    if (host && host !== location.hostname) return host;
    return 'none';
  }
  function randomId() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  }
  function isTestMode() {
    if (document.body && document.body.getAttribute('data-td-test') === '1') return true;
    return /^localhost$|^127(\.\d+){0,2}\.\d+$|^\[::1?]$/.test(location.hostname) || location.protocol === 'file:';
  }
  function signal(type, payload) {
    var body = { page: pageSlug(), source: source(), path: location.pathname, tool: 'noise-meter' };
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    if (td) { try { td.signal(type, body).catch(function () {}); } catch (e) {} }
    else if (tdQueue.length < 20) tdQueue.push([type, body]);
    try { root.dispatchEvent(new CustomEvent('kq:signal', { detail: { type: type, payload: body } })); } catch (e) {}
  }
  try {
    import(SDK_URL).then(function (mod) {
      var instance = new mod.default({ appID: APP_ID, clientUser: randomId(), testMode: isTestMode() });
      instance._post = function (body) {
        return fetch(instance.target, { method: 'POST', mode: 'cors', keepalive: true,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      };
      td = instance;
      try { instance._build('warm-up', {}).catch(function () {}); } catch (e) {}   // caches the hashed clientUser
      tdQueue.forEach(function (q) { signal(q[0], q[1]); });
      tdQueue = [];
    }).catch(function () { /* no SDK: tool works, nothing counted */ });
  } catch (e) { /* dynamic import unsupported: same */ }

  /* ---------- pictures ---------- */
  function makePicture(base, fallbackExt, alt, w, h, cls, jpegFirst) {
    var pic = document.createElement('picture');
    pic.className = cls;
    var src = document.createElement('source');
    var img = document.createElement('img');
    if (jpegFirst) { src.type = 'image/jpeg'; src.srcset = base + '.jpg'; img.src = base + '.webp'; }
    else { src.type = 'image/webp'; src.srcset = base + '.webp'; img.src = base + '.' + fallbackExt; }
    img.alt = alt; img.width = w; img.height = h; img.decoding = 'async';
    pic.appendChild(src); pic.appendChild(img);
    return pic;
  }

  var current = { character: 'cat', scene: 'city', state: 1 };

  function characterName() {
    var name = 'Character';
    CHARACTERS.forEach(function (c) { if (c.id === current.character) name = c.name; });
    return name;
  }
  function ensureCharState(state) {
    if (charsBox.querySelector('.nm-char[data-state="' + state + '"]')) return;
    var pic = makePicture(ASSETS + 'char/' + current.character + '-' + state, 'png',
      characterName() + ', ' + STATE_ALT[state], 1000, 1200, 'nm-char', false);
    pic.setAttribute('data-state', String(state));
    charsBox.appendChild(pic);
  }
  function ensureSceneLevel(level) {
    if (scenesBox.querySelector('.nm-scene[data-level="' + level + '"]')) return;
    var key = current.scene + '-' + level;
    var pic = makePicture(ASSETS + 'scene/' + key, 'jpg', '', 1024, 1024, 'nm-scene', !!JPEG_FIRST[key]);
    pic.setAttribute('data-level', String(level));
    scenesBox.appendChild(pic);
  }
  function preloadAfterStart() { ensureCharState(2); ensureCharState(3); ensureSceneLevel(2); ensureSceneLevel(3); }

  function showState(state) {
    if (state === current.state) return;
    current.state = state;
    ensureCharState(state); ensureSceneLevel(state);
    var i, pics = charsBox.querySelectorAll('.nm-char');
    for (i = 0; i < pics.length; i++) pics[i].classList.toggle('is-active', pics[i].getAttribute('data-state') === String(state));
    pics = scenesBox.querySelectorAll('.nm-scene');
    for (i = 0; i < pics.length; i++) pics[i].classList.toggle('is-active', pics[i].getAttribute('data-level') === String(state));
    root.setAttribute('data-level', String(state));
    if (indicator) indicator.setAttribute('aria-valuetext', LEVEL_TEXT[state]);
    if (reducedMotion) setIndicator(STEP_POS[state]);
  }

  /* ---------- indicator (dial / bar) ---------- */
  var barMarker = null;
  var indicatorKind = lsGet(LS_IND) === 'bar' ? 'bar' : 'dial';

  function buildBar() {
    var bar = document.createElement('div');
    bar.className = 'nm-bar';
    barMarker = document.createElement('span');
    barMarker.className = 'nm-bar-marker';
    bar.appendChild(barMarker);
    indicator.appendChild(bar);
  }
  function applyIndicator(kind) {
    indicatorKind = kind === 'bar' ? 'bar' : 'dial';
    if (indicatorKind === 'bar' && !barMarker) buildBar();
    root.setAttribute('data-indicator', indicatorKind);
    lsSet(LS_IND, indicatorKind);
    setIndicator(reducedMotion ? STEP_POS[current.state] : lastValue);
  }
  var lastValue = 0;
  function setIndicator(value) {
    lastValue = value;
    var v = value < 0 ? 0 : (value > 100 ? 100 : value);
    if (indicator) indicator.setAttribute('aria-valuenow', String(Math.round(v)));
    if (indicatorKind === 'dial' && needle) {
      var deg = NEEDLE_MIN + (NEEDLE_MAX - NEEDLE_MIN) * v / 100;
      needle.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' 100 100)');
    } else if (barMarker) {
      barMarker.style.left = v.toFixed(1) + '%';
    }
  }

  /* ---------- audio ---------- */
  var ctx = null, analyser = null, sourceNode = null, stream = null, track = null;
  var floatBuf = null, byteBuf = null, rafId = 0, running = false;
  var smoothed = 0, belowSince = [0, 0, 0, 0];
  var sensitivity = parseFloat(lsGet(LS_SENS)) || 1;
  if (sensitivity < 0.5 || sensitivity > 2) sensitivity = 1;

  function setMessage(text, kind) {
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'nm-msg' + (kind ? ' is-' + kind : '');
  }

  function errorText(err) {
    var name = (err && err.name) || '';
    var text = (err && err.message) || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      if (/system|policy|denied by/i.test(text)) {
        return { reason: 'blocked-by-policy', text: 'The microphone is blocked on this device. On a school Chromebook, ask your IT admin to allow the microphone for keepquiet.app.' };
      }
      return { reason: 'permission-denied', text: 'Allow the microphone in the address bar, then press play again. On a managed Chromebook the school may have blocked it — ask your IT admin.' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { reason: 'no-mic', text: 'No microphone found. Plug one in or choose another device, then press play again.' };
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return { reason: 'mic-busy', text: 'The microphone is in use by another app or tab. Close it and press play again.' };
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return { reason: 'mic-gone', text: 'The saved microphone is no longer available. Pick another one from the list.' };
    if (name === 'insecure') return { reason: 'insecure', text: 'The browser only allows the microphone on a secure (https) page.' };
    if (name === 'unsupported') return { reason: 'unsupported', text: 'This browser cannot use the microphone. Try a current Chrome, Edge, Safari or Firefox.' };
    return { reason: 'other', text: 'The microphone could not be started. Reload the page and try again.' };
  }

  function constraintsFor(deviceId) {
    var audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return { audio: audio, video: false };
  }
  function getMic(deviceId) {
    return navigator.mediaDevices.getUserMedia(constraintsFor(deviceId)).catch(function (err) {
      if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        lsSet(LS_MIC, '');
        return navigator.mediaDevices.getUserMedia(constraintsFor(''));
      }
      if (err.name === 'TypeError' || err.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ audio: true });
      throw err;
    });
  }
  function attachStream(s) {
    stopTracks();
    stream = s;
    track = s.getAudioTracks()[0];
    if (track) track.onended = onTrackEnded;
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} }
    sourceNode = ctx.createMediaStreamSource(s);
    sourceNode.connect(analyser);
  }
  function stopTracks() {
    if (stream) stream.getTracks().forEach(function (t) { t.onended = null; t.stop(); });
    stream = null; track = null;
  }

  function setBusy(busy) { playBtn.disabled = busy; if (bigBtn) bigBtn.disabled = busy; }
  function setPlayState(on) {
    root.classList.toggle('is-running', on);   // CSS hides the centre button while running
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Start');
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function start() {
    if (running) { stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var e = errorText({ name: location.protocol === 'http:' ? 'insecure' : 'unsupported' });
      setMessage(e.text, 'error'); signal('mic-error', { reason: e.reason }); return;
    }
    setMessage('Starting…');
    setBusy(true);
    try {
      if (!ctx) {   // created and resumed inside the click handler (iPad Safari requirement)
        var AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        floatBuf = analyser.getFloatTimeDomainData ? new Float32Array(analyser.fftSize) : null;
        byteBuf = floatBuf ? null : new Uint8Array(analyser.fftSize);
      }
      ctx.resume().catch(function () {});
    } catch (err) {
      setBusy(false);
      var ue = errorText({ name: 'unsupported' });
      setMessage(ue.text, 'error'); signal('mic-error', { reason: ue.reason }); return;
    }
    getMic(lsGet(LS_MIC) || '').then(function (s) {
      attachStream(s);
      running = true;
      smoothed = 0;
      sessionStart = Date.now(); sessionReported = false;
      setPlayState(true);
      setBusy(false);
      setMessage('');
      preloadAfterStart();
      fillMicList();
      requestWakeLock();
      signal('tool-start', { character: current.character, scene: current.scene, indicator: indicatorKind });
      rafId = requestAnimationFrame(tick);
    }).catch(function (err) {
      setBusy(false);
      var e2 = errorText(err);
      setMessage(e2.text, 'error');
      signal('mic-error', { reason: e2.reason });
    });
  }

  function stop(reason) {
    reportSession();
    running = false;
    cancelAnimationFrame(rafId);
    stopTracks();
    releaseWakeLock();
    if (ctx && ctx.state === 'running') ctx.suspend().catch(function () {});
    setPlayState(false);
    setBusy(false);
    smoothed = 0;
    showState(1);
    setIndicator(reducedMotion ? STEP_POS[1] : 0);
    if (reason) setMessage(reason, 'error'); else setMessage('');
  }

  /* ---------- tool-session: once per running session, bucketed minutes ---------- */
  var sessionStart = 0, sessionReported = false;
  function minutesBucket(ms) {
    var m = ms / 60000;
    return m < 1 ? '<1' : (m < 5 ? '1-5' : (m < 15 ? '5-15' : (m < 30 ? '15-30' : '30+')));
  }
  function reportSession() {
    if (!running || sessionReported || !sessionStart) return;
    sessionReported = true;
    // Sent through the SDK's fetch(keepalive) post (same mechanism as appstore-click.js), which
    // survives pagehide; the hashed clientUser is cached, so no async work is left at that point.
    signal('tool-session', { minutes: minutesBucket(Date.now() - sessionStart) });
  }
  window.addEventListener('pagehide', reportSession);
  window.addEventListener('beforeunload', reportSession);

  /* ---------- visit: once per page load, from localStorage counters ---------- */
  function visitBucket(n) { return n <= 1 ? '1' : (n === 2 ? '2' : (n <= 5 ? '3-5' : (n <= 10 ? '6-10' : '11+'))); }
  function daysBucket(d) { return d < 1 ? '0' : (d <= 7 ? '1-7' : (d <= 30 ? '8-30' : '31+')); }
  function reportVisit() {
    var nth = '1', days = '0';
    try {
      var n = parseInt(localStorage.getItem(LS_VISITS), 10) || 0;
      n += 1;
      localStorage.setItem(LS_VISITS, String(n));
      var first = parseInt(localStorage.getItem(LS_FIRST), 10) || 0;
      if (!first) { first = Date.now(); localStorage.setItem(LS_FIRST, String(first)); }
      nth = visitBucket(n);
      days = daysBucket(Math.floor((Date.now() - first) / 86400000));
    } catch (e) { /* storage blocked: counts as a first visit */ }
    signal('visit', { nth: nth, daysSinceFirst: days });
  }

  /* ---------- pro-view: once per page load when #pro-card is ≥ 50 % visible ---------- */
  function watchProCard() {
    var card = document.getElementById('pro-card');
    if (!card || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && en.intersectionRatio >= 0.5) { signal('pro-view', {}); io.disconnect(); }
      });
    }, { threshold: [0.5] });
    io.observe(card);
  }

  /* ---------- stage height: viewport minus everything above the stage ---------- */
  var aboveTimer = 0;
  function measureAbove() {
    var top = Math.max(0, Math.round(stage.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0)));
    root.style.setProperty('--nm-above', top + 'px');
  }
  function measureAboveSoon() { clearTimeout(aboveTimer); aboveTimer = setTimeout(measureAbove, 120); }
  window.addEventListener('resize', measureAboveSoon);
  window.addEventListener('load', measureAbove);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureAbove).catch(function () {});

  function onTrackEnded() {
    if (!running) return;
    stop('The microphone was disconnected. Press play to try again.');
    signal('mic-error', { reason: 'ended' });
    fillMicList();
  }

  function readRms() {
    var i, v, sum = 0, n = analyser.fftSize;
    if (floatBuf) {
      analyser.getFloatTimeDomainData(floatBuf);
      for (i = 0; i < n; i++) { v = floatBuf[i]; sum += v * v; }
    } else {
      analyser.getByteTimeDomainData(byteBuf);
      for (i = 0; i < n; i++) { v = (byteBuf[i] - 128) / 128; sum += v * v; }
    }
    return Math.sqrt(sum / n);
  }
  function loudnessFromRms(rms) {
    var db = 20 * Math.log10(rms || 1e-6);
    var out = (db - DB_FLOOR) / DB_SPAN * 100 * sensitivity;
    return out < 0 ? 0 : (out > 100 ? 100 : out);
  }

  function tick(now) {
    if (!running) return;
    var level = loudnessFromRms(readRms());
    smoothed += (level - smoothed) * (level > smoothed ? ATTACK : RELEASE);
    if (!reducedMotion) setIndicator(smoothed);

    var target = smoothed >= THRESH_UP[1] ? 3 : (smoothed >= THRESH_UP[0] ? 2 : 1);
    if (target > current.state) {
      showState(target);
      belowSince[current.state] = 0;
    } else if (target < current.state) {
      var th = THRESH_UP[current.state - 2] - DOWN_MARGIN;
      if (smoothed < th) {
        if (!belowSince[current.state]) belowSince[current.state] = now;
        else if (now - belowSince[current.state] >= DOWN_HOLD_MS) {
          belowSince[current.state] = 0;
          showState(current.state - 1);
        }
      } else belowSince[current.state] = 0;
    } else belowSince[current.state] = 0;

    rafId = requestAnimationFrame(tick);
  }

  /* ---------- tab hidden / resume ---------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !running) return;
    if (ctx && ctx.state !== 'running') ctx.resume().catch(function () {});
    smoothed = 0;
    requestWakeLock();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  });

  /* ---------- wake lock ---------- */
  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }

  /* ---------- controls: round buttons, settings sheet, mic row ---------- */
  var fsBtn, settingsBtn, sheet, closeBtn, sheetBuilt = false;
  var micSelects = [], sensSlider;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;   // trusted constants only (ICON.*)
    return n;
  }
  function roundButton(cls, label, icon) {
    var b = el('button', 'nm-round ' + cls, icon);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }
  function makeMicSelect() {
    var s = document.createElement('select');
    s.className = 'nm-select';
    s.setAttribute('aria-label', 'Microphone');
    var o = document.createElement('option'); o.value = ''; o.textContent = 'Default microphone (press play to list)';
    s.appendChild(o);
    s.addEventListener('change', function () { switchMic(s.value); });
    micSelects.push(s);
    return s;
  }

  function buildControls() {
    fsBtn = roundButton('nm-fs', 'Fullscreen', ICON.full);
    fsBtn.addEventListener('click', toggleFullscreen);
    if (!fullscreenSupported()) fsBtn.hidden = true;
    settingsBtn = roundButton('nm-settings-btn', 'Settings', ICON.sliders);
    settingsBtn.setAttribute('aria-expanded', 'false');
    settingsBtn.setAttribute('aria-controls', 'nm-settings');
    settingsBtn.addEventListener('click', function () { if (sheet && !sheet.hidden) closeSheet(); else openSheet(); });
    stage.appendChild(fsBtn);
    stage.appendChild(settingsBtn);

    sheet = el('div', 'nm-sheet');
    sheet.id = 'nm-settings'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Settings'); sheet.setAttribute('aria-modal', 'false');
    stage.appendChild(sheet);

    if (micRow) {
      var lab = el('label', 'nm-microw-label');
      lab.appendChild(el('span', 'nm-microw-text', 'Microphone'));
      lab.appendChild(makeMicSelect());
      micRow.appendChild(lab);
    }
    root.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && sheet && !sheet.hidden) closeSheet(); });
  }

  function buildSheet() {
    sheetBuilt = true;
    closeBtn = roundButton('nm-close', 'Close settings', ICON.close);
    closeBtn.addEventListener('click', closeSheet);
    sheet.appendChild(closeBtn);

    sheet.appendChild(el('h3', 'nm-h', 'Character'));
    var charGrid = el('div', 'nm-grid'); charGrid.setAttribute('role', 'group'); charGrid.setAttribute('aria-label', 'Character');
    fillGrid(charGrid, 'char', CHARACTERS);
    sheet.appendChild(charGrid);

    sheet.appendChild(el('h3', 'nm-h', 'Background'));
    var sceneGrid = el('div', 'nm-grid'); sceneGrid.setAttribute('role', 'group'); sceneGrid.setAttribute('aria-label', 'Background');
    fillGrid(sceneGrid, 'scene', SCENES);
    sheet.appendChild(sceneGrid);

    sheet.appendChild(el('h3', 'nm-h', 'Indicator'));
    var indGrid = el('div', 'nm-grid nm-ind'); indGrid.setAttribute('role', 'group'); indGrid.setAttribute('aria-label', 'Indicator');
    [['bar', 'Bar', ICON.miniBar], ['dial', 'Dial', ICON.miniDial]].forEach(function (opt) {
      var b = el('button', 'nm-thumb nm-ind-opt', opt[2]);
      b.type = 'button';
      b.setAttribute('aria-label', opt[1]);
      b.setAttribute('aria-pressed', indicatorKind === opt[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        applyIndicator(opt[0]);
        var all = indGrid.querySelectorAll('[aria-pressed]');
        for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      indGrid.appendChild(b);
    });
    sheet.appendChild(indGrid);

    var micLab = el('h3', 'nm-h', 'Microphone');
    sheet.appendChild(micLab);
    sheet.appendChild(makeMicSelect());
    if (running) fillMicList();

    var sensId = 'nm-sens';
    var sensLab = el('label', 'nm-h', 'Sensitivity'); sensLab.setAttribute('for', sensId);
    sheet.appendChild(sensLab);
    sensSlider = document.createElement('input');
    sensSlider.type = 'range'; sensSlider.id = sensId; sensSlider.className = 'nm-range';
    sensSlider.min = '50'; sensSlider.max = '200'; sensSlider.step = '5';
    sensSlider.value = String(Math.round(sensitivity * 100));
    sensSlider.addEventListener('input', function () {
      sensitivity = parseInt(sensSlider.value, 10) / 100;
      lsSet(LS_SENS, String(sensitivity));
    });
    sheet.appendChild(sensSlider);
  }

  function thumbPicture(kind, item) {
    var base = ASSETS + 'thumb/' + item.id + (item.free ? '-1' : '');
    var pic = makePicture(base, kind === 'char' ? 'png' : 'jpg', '', 160, 160, 'nm-thumb-pic', false);
    pic.querySelector('img').loading = 'lazy';
    return pic;
  }
  function fillGrid(grid, kind, items) {
    items.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'nm-thumb' + (item.free ? '' : ' is-locked');
      var selected = (kind === 'char' ? current.character : current.scene) === item.id;
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
      b.setAttribute('aria-label', item.name + (item.free ? '' : ' (Pro, coming soon)'));
      b.setAttribute('data-item', kind + '-' + item.id);
      b.appendChild(thumbPicture(kind, item));
      if (!item.free) b.appendChild(el('span', 'nm-lock', ICON.lock));
      b.addEventListener('click', function () {
        if (!item.free) { proClick(kind + '-' + item.id); return; }
        var all = grid.querySelectorAll('[aria-pressed]');
        for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      grid.appendChild(b);
    });
  }

  function openSheet() {
    if (!sheetBuilt) buildSheet();     // thumbnails load only now
    sheet.hidden = false;
    settingsBtn.setAttribute('aria-expanded', 'true');
    root.classList.add('is-settings');
    if (closeBtn) closeBtn.focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-settings');
    settingsBtn.focus();
  }

  /* ---------- Pro card ---------- */
  function proClick(item) {
    signal('pro-click', { item: item });
    closeSheet();
    var card = document.getElementById('pro-card');
    if (!card) return;
    if (isFullscreen()) exitFullscreen();
    card.classList.add('is-highlighted');
    if (card.scrollIntoView) {
      try { card.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); }
    }
    var focusable = card.querySelector('button, a');
    if (focusable) setTimeout(function () { try { focusable.focus({ preventScroll: true }); } catch (e) {} }, reducedMotion ? 0 : 450);
    try { root.dispatchEvent(new CustomEvent('kq:pro-click', { bubbles: true, detail: { item: item } })); } catch (e) {}
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-kq-notify]') : null;
    if (!t) return;
    ev.preventDefault();
    signal('pro-click', { item: 'notify' });
    t.disabled = true;
    var thanks = document.querySelector('[data-kq-notify-thanks]');
    if (thanks) { thanks.hidden = false; thanks.setAttribute('role', 'status'); }
  });

  /* ---------- microphone list (all selects stay in sync) ---------- */
  function fillMicList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var inputs = devices.filter(function (d) { return d.kind === 'audioinput'; });
      var currentId = (track && track.getSettings && track.getSettings().deviceId) || lsGet(LS_MIC) || '';
      micSelects.forEach(function (sel) {
        sel.innerHTML = '';
        if (!inputs.length) {
          var o = document.createElement('option'); o.value = ''; o.textContent = 'No microphone found'; sel.appendChild(o); return;
        }
        inputs.forEach(function (d, i) {
          var o = document.createElement('option');
          o.value = d.deviceId;
          o.textContent = d.label || ('Microphone ' + (i + 1));
          if (d.deviceId === currentId || (!currentId && d.deviceId === 'default')) o.selected = true;
          sel.appendChild(o);
        });
      });
    }).catch(function () {});
  }
  function switchMic(id) {
    lsSet(LS_MIC, id);
    micSelects.forEach(function (sel) { if (sel.value !== id) sel.value = id; });
    if (!running || !ctx) return;          // applied on the next start
    getMic(id).then(function (s) {
      attachStream(s);
      smoothed = 0;
      setMessage('');
      signal('mic-switch', {});
      fillMicList();
    }).catch(function (err) {
      var e = errorText(err);
      setMessage(e.text, 'error');
      signal('mic-error', { reason: e.reason });
    });
  }
  if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', function () { if (running) fillMicList(); });
  }

  /* ---------- fullscreen ---------- */
  function fullscreenSupported() { return !!(stage.requestFullscreen || stage.webkitRequestFullscreen); }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    if (isFullscreen()) { exitFullscreen(); return; }
    var p;
    try { p = stage.requestFullscreen ? stage.requestFullscreen() : stage.webkitRequestFullscreen(); } catch (e) { return; }
    if (p && p.catch) p.catch(function () {});
    signal('fullscreen', {});
  }
  function exitFullscreen() {
    try {
      var p = document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen && document.webkitExitFullscreen());
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  function onFsChange() {
    var on = isFullscreen();
    root.classList.toggle('is-fullscreen', on);
    if (fsBtn) fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  /* ---------- init ---------- */
  buildControls();
  playBtn.addEventListener('click', start);
  if (bigBtn) bigBtn.addEventListener('click', function () { if (!running) start(); });
  setPlayState(false);
  if (indicator) {
    indicator.setAttribute('role', 'meter'); indicator.setAttribute('aria-label', 'Room loudness');
    indicator.setAttribute('aria-valuemin', '0'); indicator.setAttribute('aria-valuemax', '100');
    indicator.setAttribute('aria-valuetext', LEVEL_TEXT[1]);
  }
  applyIndicator(indicatorKind);
  root.setAttribute('data-level', '1');
  measureAbove();
  root.classList.add('is-ready');
  reportVisit();
  watchProCard();
  window.addEventListener('pagehide', function () { if (running) stop(); });
})();
