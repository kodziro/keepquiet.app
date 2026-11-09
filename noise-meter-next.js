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
    setting-change, mic-error, mic-switch, fullscreen, timer-set, timer-start, timer-done, timer-cancel) with no audio, no IDs and no free text —
    every value is a bucketed string.
  - AudioContext is created and resumed only inside the first play click (iPad Safari;
    ensureAudioContext()). AGC / noise suppression / echo cancellation are off so the meter
    reflects the room, not the browser's voice processing.
  - Quiet-time timer (2026-11-07, bound to the meter since 2026-11-09, inspired by the app): a
    top-right button opens a sheet (presets 1–30 min or a custom 1–90 min, last length in
    localStorage kq-nm-timer-seconds); Save shows a white pill under the top row (m:ss, shrinking
    bar, ↻ restart, ✕ close). The timer counts ONLY while the meter runs: none → set (waiting, full
    length shown) → running → paused (meter paused: remaining frozen, ⏸ glyph) → done. Target
    timestamp + 250 ms interval, re-rendered on visibilitychange so background throttling cannot
    drift. At 0:00 the pill turns red, the time pulses twice (not under reduced motion) and a soft
    two-tone chime plays on the meter's AudioContext. The timer sheet and the settings panel never
    show at the same time.

  Markup contract (tool-test.html; index.html uses the same block):
    <div id="noise-meter" class="nm is-fresh" data-assets="assets/tool/">   ← is-fresh until the first successful start
      <div class="nm-stage">                              ← goes fullscreen
        <div class="nm-scenes"><picture class="nm-scene is-active" data-level="1">…city-1…</picture></div>
        <div class="nm-chars"><picture class="nm-char is-active" data-state="1">…cat-1…</picture></div>
        <div class="nm-indicator"><svg class="nm-dial">…<g class="nm-needle">…</g></svg></div>
        <p class="nm-msg" role="status"></p>
        <div class="nm-overlay">
          <div class="nm-stack">                        ← fresh: text column left (≥ 700 px), cat + dial stay centred; paused: just the pill
            <h1><span class="kicker">…</span> <span class="big">…</span></h1>   ← the page's heading; .sr-only once started
            <button class="nm-start" type="button">▶ Start</button>   ← "▶ Resume" after a pause
          </div>
          <p class="nm-privacy"><a href="#faq-record">🔒 Privacy: …</a></p>   ← hidden once started
        </div>                                            ← tint + stack; faded out while running
        <div class="nm-bottom"><button class="nm-play" type="button" aria-label="Pause">…pause icon…</button></div>   ← shown only while running
      </div>
      <div class="nm-microw"></div>                       ← mic selector row, filled by this script
    </div>
  This script adds: the fullscreen button (top-left; pill "Fullscreen" in fresh/paused, round icon while
  running; where the Fullscreen API is missing it toggles an "expanded" mode: stage fixed over the page,
  body scroll locked, Escape/back exits, one-time Home-Screen hint), the top-right row .nm-tr with the
  "⏱ Timer" button (every state; same pill/round look as Fullscreen, icon only ≤ 560 px) and the "🎨 Style" pill
  (welcome screen only: opens the panel without starting; Microphone / Sensitivity show "Available after
  Start" until the first start; ×, Escape or the pill again closes it), the timer sheet and pill
  (below), the settings panel
  (Character, Background, Indicator, Microphone, Sensitivity — right side,
  bottom sheet under 700 px; shown while paused, hidden while running), the bar indicator, and the mic row.
  Only cat-1 + city-1 are in the HTML (first paint). States 2–3 and scene
  levels 2–3 are added as <picture> elements after start, so the browser
  picks WebP or the fallback itself — PNG/JPEG fallbacks are never preloaded
  by hand. Thumbnails are created only when the settings sheet first opens.

  Quiet-time timer markup (all built by this script, inside .nm-stage):
    <div class="nm-tr">                                   ← top-right row (flex): Timer, then Style
      <button class="nm-fs nm-timer" aria-label="Quiet-time timer" aria-controls="nm-timer-sheet" aria-expanded="false">⏱ <span class="nm-fs-text">Timer</span></button>
      <button class="nm-fs nm-style" …>🎨 Style</button>   ← as before; hidden once started (CSS)
    </div>
    <div class="nm-tsheet" id="nm-timer-sheet" role="dialog" aria-label="Timer" hidden>   ← looks like the settings sheet, z 7
      <button class="nm-sheet-close" aria-label="Close timer settings">×</button>   ← same grey round × as the settings sheet, same corner
      <h3 class="nm-h">Timer</h3>
      <div class="nm-tchips" role="radiogroup" aria-label="Minutes"><button class="nm-tchip" role="radio" aria-checked="true" data-min="5">5 min</button> …1, 2, 3, 5, 10, 15, 20, 30 (4-column grid; arrow keys move and select)</div>
      <label class="nm-tcustom">Custom <input class="nm-tinput" type="number" min="1" max="90" placeholder="45" aria-describedby="nm-timer-hint"> min</label>
      <p class="nm-thint" id="nm-timer-hint">1–90 minutes</p>
      <button class="nm-pill nm-tsave">Save</button>   ← disabled while Custom is out of 1–90; Save = set the timer, close, focus back on the Timer button
      <button class="nm-tremove" hidden>Remove timer</button>   ← text link under Save, only while a timer exists: same as the pill's ✕, closes the sheet
    </div>
    <div class="nm-tpill" role="group" aria-label="Quiet-time timer">   ← while a timer exists (root .is-timer); .is-waiting (set), .is-paused (aria-label "Timer paused"), .is-done; root .is-timer-running = green ring, .is-timer-set (set/paused) = amber ring on the Timer button
      <span class="nm-tpause" aria-hidden="true">⏸</span>   ← shown in .is-paused only
      <span class="nm-ttime" aria-hidden="true">5:00</span><span class="sr-only" aria-live="polite">5 minutes left</span>   ← live text only while running: full minutes, last 10 s, 0:00
      <span class="nm-tbar"><span class="nm-tfill" style="width:100%"></span></span>
      <button class="nm-tbtn nm-trestart" aria-label="Restart timer">↻</button><button class="nm-tbtn nm-tclose" aria-label="Close timer">✕</button>   ← display:none while the timer counts (root .is-timer-running); shown in set / paused / done
    </div>
    While either sheet is open (root .is-timer-open or .is-panel-open) the top-right row .nm-tr is visibility:hidden (it
    showed through the sheet's translucent header); the sheets' × takes the focus when Style opens the panel.
  Timer signals: timer-set {seconds: "<exact length>"} (Save), timer-start {seconds} (the first time this timer
  begins counting; again after ↻ from 0:00), timer-done {}, timer-cancel {remaining: tool-session minute bucket}
  (✕ or "Remove timer" in the sheet, unless done). ↻ while running / waiting and Save replacing a timer send no cancel.

  Stage height: --nm-above (px above the stage: the site header) is measured on
  load/resize and set on the root; CSS makes the stage max(480px, 100svh - that).
  Every signal is also dispatched as a "kq:signal" CustomEvent on the root
  (detail {type, payload}) so tool-test.html can log it.

  Optional page hooks:
    #pro-card                 → the price card of the pricing section (index.html) or the test
                                stand-in (tool-test.html); pro-view is sent once when ≥ 50 % visible
    [data-kq-interest]        → "I'm interested" button on the card below the fold: counted
                                pro-click {item:"interest", from:"card"}, then shows [data-kq-interest-thanks]
    body[data-td-test="1"]    → TelemetryDeck test mode (used by tool-test.html)
    ?test=1 in the URL        → TelemetryDeck test mode on any page (live checks without
                                polluting the data; appstore-click.js honours it too)
    details[id] + URL hash   → a <details> targeted by the hash (e.g. the overlay's privacy
                                link → #faq-record) is opened on load and on hashchange

  Unlock (UNLOCK-PLAN.md § 3.4, worker/README.md § 8; UI and texts live in unlock.js):
    - lock badges stay here; "key stored?" = localStorage kq-license (in-memory fallback when
      storage throws) or the FREE_UNTIL window; no network call on load, ever.
    - unlock.js?v=UNLOCK_V is imported lazily: when the panel first opens, at init when
      window.__kqUnlock exists (set by the inline head script from ?unlock= / ?k=) or a key is
      stored, or on the first interaction with #pro-card below the fold. It receives
      window.__kqTool (signal, el, button, storage, panel hooks) and owns the unlock UI: a
      centred modal <dialog> (decided 2026-11-02) plus the panel entry (.nm-unlock-line:
      locked → --nm-unlock two-line button "Unlock all 8 characters + 5 backgrounds / $19.99
      one-time" straight to /checkout, caption, "Already unlocked? Restore" link, and a compact
      sticky copy at the bottom of the panel (.nm-unlock-sticky) while it is scrolled away; unlocked → "✓ Unlocked · KQ-••••-••••-1234 Show ·
      Manage"; free window → "free until <date> · Restore"). Browsers without showModal get
      the dialog content as a card in the panel (.nm-unlock, the old slot).
    - body[data-kq-unlock-gate] (tool-test.html): the unlock UI renders only when
      localStorage kq-dev === "1" (set by tool-test.html?dev=1); otherwise the page behaves
      exactly as today (interest card, no price).
    - a locked thumb tap still counts pro-click {item} and opens the short offer dialog
      (unlock-click {from:"thumb"} if its button is pressed); the panel button and the static
      card's button call /checkout directly (from:"panel" / from:"card").
      After unlock the grids are rebuilt without badges and
      any character / background is selectable (selectItem). Every paid character and scene
      reacts in 3 steps like cat/city (§ 5.0, art converted 2026-11-02).
    - FREE_UNTIL (ISO date; empty = off): while today < FREE_UNTIL every browser is unlocked,
      nothing is stored and no /checkout call is made (§ 2.11).
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
  var LS_SENS = 'kq-nm-sensitivity', LS_MIC = 'kq-nm-mic', LS_IND = 'kq-nm-indicator', LS_FEEDBACK = 'kq-feedback', LS_FS_HINT = 'kq-fs-hint';
  var LS_VISITS = 'kq-visits', LS_FIRST = 'kq-first-seen';
  var LS_LICENSE = 'kq-license', LS_DEV = 'kq-dev';
  var LS_TIMER = 'kq-nm-timer-seconds';
  var TIMER_PRESETS = [1, 2, 3, 5, 10, 15, 20, 30], TIMER_MAX_MIN = 90, TIMER_DEFAULT = 300;   // minutes / seconds
  var FREE_UNTIL = '';               // e.g. '2026-12-31': all characters and backgrounds free until then (UNLOCK-PLAN § 2.11); '' = off
  var UNLOCK_V = '20261106a';        // ?v= of unlock.js — bump with every change to unlock.js

  // Names are used ONLY in alt / aria-label text, never as visible labels.
  var CHARACTERS = [
    { id: 'cat', free: true, states: 3, name: 'Cat' },
    { id: 'dog', states: 3, name: 'Dog' }, { id: 'crocodile', states: 3, name: 'Crocodile' },
    { id: 'squirrel', states: 3, name: 'Squirrel' }, { id: 'tiger', states: 3, name: 'Tiger' },
    { id: 'parrot', states: 3, name: 'Parrot' }, { id: 'owl', states: 3, name: 'Owl' }, { id: 'robot', states: 3, name: 'Robot' }
  ];
  var SCENES = [
    { id: 'city', free: true, levels: 3, name: 'City' },
    { id: 'beach', levels: 3, name: 'Beach' }, { id: 'ice', levels: 3, name: 'Ice and mountains' },
    { id: 'space', levels: 3, name: 'Earth and space' }, { id: 'forest', levels: 3, name: 'Forest' }
  ];
  var JPEG_FIRST = { 'city-2': true, 'city-3': true, 'ice-3': true };   // grain: JPEG smaller than WebP
  var STATE_ALT = ['', 'happy', 'sad, ears down', 'eyes shut, paws on ears'];
  var LEVEL_TEXT = ['', 'Quiet', 'Getting loud', 'Too loud'];

  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.52.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="5" height="17" rx="1.6"/><rect x="14" y="3.5" width="5" height="17" rx="1.6"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    timer: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 2M9.5 2.5h5M12 2.5V6M18.6 7.2l1.4-1.4"/></svg>',
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
  var startBtn = root.querySelector('.nm-start');
  var stackH1 = root.querySelector('.nm-stack h1');
  var everStarted = false;
  var micRow = root.querySelector('.nm-microw');

  var reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reducedMotion) root.classList.add('nm-reduced');

  // localStorage with an in-memory fallback (README § 8.2): when storage throws, values live for this page's lifetime
  var mem = {};
  function lsGet(k) {
    try { var v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {}
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
  }
  function lsSet(k, v) { mem[k] = String(v); try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function lsDel(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- unlock: gate, key check, free window (no network) ---------- */
  function unlockActive() {   // tool-test.html: only with the kq-dev flag; every other page: always
    if (document.body && document.body.hasAttribute('data-kq-unlock-gate')) return lsGet(LS_DEV) === '1';
    return true;
  }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function freeWindow() { return !!FREE_UNTIL && todayISO() < FREE_UNTIL; }
  function isUnlocked() { return unlockActive() && (freeWindow() || !!lsGet(LS_LICENSE)); }

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
    try { if (new URLSearchParams(location.search).get('test') === '1') return true; } catch (e) {}
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
  // characters: 500 px variant (-500.webp / -500.png) + 1000 px original via srcset; sizes = the character box
  // while running (.nm-char: height 52 % of the stage under 560 px, 64 % above; width = height * 1000/1200)
  var CHAR_SIZES = '(max-width:560px) calc((100vh - 65px) * .433), calc((100vh - 65px) * .533)';
  function makePicture(base, fallbackExt, alt, w, h, cls, jpegFirst, sizes) {
    var pic = document.createElement('picture');
    pic.className = cls;
    var src = document.createElement('source');
    var img = document.createElement('img');
    if (jpegFirst) { src.type = 'image/jpeg'; src.srcset = base + '.jpg'; img.src = base + '.webp'; }
    else if (sizes) {
      src.type = 'image/webp'; src.srcset = base + '-500.webp 500w, ' + base + '.webp 1000w'; src.sizes = sizes;
      img.src = base + '.' + fallbackExt; img.srcset = base + '-500.' + fallbackExt + ' 500w, ' + base + '.' + fallbackExt + ' 1000w'; img.sizes = sizes;
    }
    else { src.type = 'image/webp'; src.srcset = base + '.webp'; img.src = base + '.' + fallbackExt; }
    img.alt = alt; img.width = w; img.height = h; img.decoding = 'async';
    pic.appendChild(src); pic.appendChild(img);
    return pic;
  }

  var current = { character: 'cat', scene: 'city', state: 1 };

  function findItem(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  // One file per state. Free items: cat-1 … cat-3, city-1 … city-3. Paid items: state 1 keeps its original name
  // (dog, beach — the files the live page already serves), states 2–3 are dog-2, dog-3, beach-2, beach-3 (§ 5.0).
  function fileKey(item, n) { return item.id + (item.free ? '-' + n : (n > 1 ? '-' + n : '')); }
  function ensureCharState(state) {
    if (charsBox.querySelector('.nm-char[data-state="' + state + '"]')) return;
    var item = findItem(CHARACTERS, current.character);
    var base = ASSETS + 'char/' + fileKey(item, state);
    var pic = makePicture(base, 'png', item.name + ', ' + STATE_ALT[state], 1000, 1200, 'nm-char', false, CHAR_SIZES);
    pic.setAttribute('data-state', String(state));
    charsBox.appendChild(pic);
  }
  function ensureSceneLevel(level) {
    if (scenesBox.querySelector('.nm-scene[data-level="' + level + '"]')) return;
    var item = findItem(SCENES, current.scene);
    var key = fileKey(item, level);
    var pic = makePicture(ASSETS + 'scene/' + key, 'jpg', '', 1024, 1024, 'nm-scene', !!JPEG_FIRST[key]);
    pic.setAttribute('data-level', String(level));
    scenesBox.appendChild(pic);
  }
  // switch character or background (unlocked items): rebuild that layer for the current state, the other states follow lazily
  function selectItem(kind, id) {
    if (kind === 'char') { if (current.character === id) return false; current.character = id; charsBox.innerHTML = ''; }
    else { if (current.scene === id) return false; current.scene = id; scenesBox.innerHTML = ''; }
    var state = current.state;
    current.state = 0;
    showState(state);
    if (everStarted) preloadAfterStart();
    return true;
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
      return { reason: 'permission-denied', text: 'Allow the microphone in the address bar (iPhone and iPad: aA → Website Settings → Microphone), then press play again. On a managed Chromebook the school may have blocked it — ask your IT admin.' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { reason: 'no-mic', text: 'No microphone found. Plug one in or choose another device, then press play again.' };
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return { reason: 'mic-busy', text: 'The microphone is in use by another app or tab. Close it and press play again.' };
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return { reason: 'mic-gone', text: 'The saved microphone is no longer available. Pick another one from the list.' };
    if (name === 'insecure') return { reason: 'insecure', text: 'The browser only allows the microphone on a secure (https) page.' };
    if (name === 'unsupported') return { reason: 'unsupported', text: 'This browser cannot use the microphone. Try a current Chrome, Edge, Safari or Firefox.' };
    return { reason: 'other', text: 'The microphone could not be started. Reload the page and try again.' };
  }

  // Created and resumed only inside a click handler (iPad Safari): the first play click or the timer's Start.
  // One context for the meter and the timer chime. false = this browser has no Web Audio.
  function ensureAudioContext() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        floatBuf = analyser.getFloatTimeDomainData ? new Float32Array(analyser.fftSize) : null;
        byteBuf = floatBuf ? null : new Uint8Array(analyser.fftSize);
      }
      var p = ctx.resume(); if (p && p.catch) p.catch(function () {});
      return true;
    } catch (err) { ctx = null; analyser = null; return false; }
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

  function setBusy(busy) { playBtn.disabled = busy; if (startBtn) startBtn.disabled = busy; }
  function setPlayState(on) {
    root.classList.toggle('is-running', on);   // CSS: overlay fades out, bottom bar (pause) appears
    root.classList.toggle('is-fresh', !everStarted);   // CSS: pre-start stack vs. paused "Resume" pill
    if (stackH1) stackH1.classList.toggle('sr-only', everStarted);   // heading stays in the DOM, visually hidden once started
    if (startBtn && !on) {
      startBtn.textContent = everStarted ? '\u25B6 Resume' : '\u25B6 Start';   // CSS uppercases the fresh label
      startBtn.setAttribute('aria-label', everStarted ? 'Resume the noise meter' : 'Start the noise meter');
    }
  }

  function start() {
    if (running) { stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var e = errorText({ name: location.protocol === 'http:' ? 'insecure' : 'unsupported' });
      setMessage(e.text, 'error'); signal('mic-error', { reason: e.reason }); return;
    }
    setMessage('Starting…');
    setBusy(true);
    if (!ensureAudioContext()) {
      setBusy(false);
      var ue = errorText({ name: 'unsupported' });
      setMessage(ue.text, 'error'); signal('mic-error', { reason: ue.reason }); return;
    }
    getMic(lsGet(LS_MIC) || '').then(function (s) {
      attachStream(s);
      running = true; everStarted = true;
      removeFeedback();
      smoothed = 0;
      sessionStart = Date.now(); sessionReported = false;
      setPlayState(true);
      applyPanel();
      setBusy(false);
      setMessage('');
      preloadAfterStart();
      fillMicList();
      requestWakeLock();
      onMeterStart();   // a set or paused quiet-time timer starts counting
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
    var sessionMs = sessionStart ? Date.now() - sessionStart : 0;
    reportSession();
    running = false;
    sheetClosed = false;
    onMeterStop();   // a running quiet-time timer freezes (paused)
    cancelAnimationFrame(rafId);
    stopTracks();
    releaseWakeLock();
    if (ctx && ctx.state === 'running') ctx.suspend().catch(function () {});
    setPlayState(false);
    applyPanel();
    if (!reason) maybeFeedback(sessionMs);   // only after a real pause, never pre-start or while running
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

  /* ---------- controls: fullscreen button, settings panel, mic row ---------- */
  // Panel (bouncyballs-style): translucent dark panel over the right of the scene (bottom sheet under
  // 700 px). Visible whenever the meter is stopped or paused, hidden while running. No toggle button.
  var fsBtn, fsText, styleBtn, panel, panelBody, sheetClosed = false, sheetResumeBtn, interestCard, unlockLine, legend, charGrid, sceneGrid, feedbackLine, feedbackTimer = 0;
  var micSelects = [], sensSlider, sensDefaultBtn;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;   // trusted constants only (ICON.*) and fixed labels
    return n;
  }
  function button(cls, label, html) {
    var b = el('button', cls, html);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  // Device labels as the OS reports them are noisy ("Default - MacBook Pro Microphone (Built-in)",
  // "USB Audio (0d8c:0014)"); strip the prefix and the hardware id, keep the name.
  function cleanMicLabel(label, i) {
    var t = (label || '').replace(/^(default|communications)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/ig, '').replace(/\s+/g, ' ').trim();
    return t || ('Microphone ' + (i + 1));
  }
  function makeMicSelect() {
    var s = document.createElement('select');
    s.className = 'nm-select';
    s.setAttribute('aria-label', 'Microphone');
    var o = document.createElement('option'); o.value = ''; o.textContent = 'Default microphone';
    s.appendChild(o);
    s.addEventListener('change', function () { switchMic(s.value); signal('setting-change', { what: 'mic' }); });
    micSelects.push(s);
    return s;
  }

  function buildControls() {
    // fullscreen button, top-left, all states: pill with text (fresh/paused), round icon while running (CSS)
    fsBtn = button('nm-fs', 'Fullscreen', ICON.full);
    fsText = el('span', 'nm-fs-text', 'Fullscreen');
    fsBtn.appendChild(fsText);
    fsBtn.addEventListener('click', toggleFullscreen);
    // "🎨 Style" pill, top-right of the stage (mirror of Fullscreen), welcome screen only (CSS hides it once started): opens the panel without starting
    // the meter; a second press, the × or Escape closes it again (decided 2026-11-02). Icon only ≤ 560 px (CSS).
    styleBtn = button('nm-fs nm-style', 'Style: customize characters and backgrounds', '<span class="nm-style-ico" aria-hidden="true">\uD83C\uDFA8</span>');
    styleBtn.appendChild(el('span', 'nm-fs-text', 'Style'));
    styleBtn.setAttribute('aria-controls', 'nm-panel');
    styleBtn.setAttribute('aria-expanded', 'false');
    styleBtn.addEventListener('click', function () {
      if (timerOpen) { closeTimerSheet(false); panelForced = true; sheetClosed = false; applyPanel(); focusPanelClose(); return; }   // sheet → panel (never both)
      if (root.classList.contains('is-panel-open')) closePrestart(false);
      else { panelForced = true; sheetClosed = false; applyPanel(); focusPanelClose(); }   // the row hides while the panel is open: focus moves to its ×
    });
    // top-right row: "⏱ Timer" (every state; round while running like Fullscreen), then Style (welcome screen only)
    var topRight = el('div', 'nm-tr');
    timerBtn = button('nm-fs nm-timer', 'Quiet-time timer', ICON.timer);
    timerBtn.appendChild(el('span', 'nm-fs-text', 'Timer'));
    timerBtn.setAttribute('aria-controls', 'nm-timer-sheet');
    timerBtn.setAttribute('aria-expanded', 'false');
    timerBtn.addEventListener('click', function () { if (timerOpen) closeTimerSheet(true); else openTimerSheet(); });
    topRight.appendChild(timerBtn);
    topRight.appendChild(styleBtn);
    stage.appendChild(fsBtn);
    stage.appendChild(topRight);
    buildTimerSheet();

    panel = el('div', 'nm-panel');
    panel.id = 'nm-panel';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Settings');
    panelBody = el('div', 'nm-panel-body');
    panel.appendChild(panelBody);
    // phone sheet only (CSS hides both ≥ 700 px): × closes the sheet, sticky bar resumes directly
    panelCloseBtn = button('nm-sheet-close', 'Close settings', ICON.close);
    panelCloseBtn.addEventListener('click', function () { if (!everStarted) closePrestart(true); else { sheetClosed = true; applyPanel(); } });
    panel.appendChild(panelCloseBtn);
    var resumeBar = el('div', 'nm-sheet-resume');
    sheetResumeBtn = button('nm-sheet-resume-btn', 'Resume the noise meter', '\u25B6 Resume');
    sheetResumeBtn.addEventListener('click', function () { if (!running) start(); });
    resumeBar.appendChild(sheetResumeBtn);
    panel.appendChild(resumeBar);
    stage.appendChild(panel);
    buildPanel();

    if (micRow) {
      var lab = el('label', 'nm-microw-label');
      lab.appendChild(el('span', 'nm-microw-text', 'Microphone'));
      lab.appendChild(makeMicSelect());
      micRow.appendChild(lab);
    }
    applyPanel();
  }

  // Panel = paused state only (after the first start; CSS slides it out via .is-panel-open).
  // On phones the × closes it for the current pause (sheetClosed is reset by the next pause).
  var panelForced = false;   // the Style pill and unlock.js (return from Stripe, ?k= result) open the panel before the first start
  var panelCloseBtn = null;
  function focusPanelClose() { if (panelCloseBtn) { try { panelCloseBtn.focus({ preventScroll: true }); } catch (e) {} } }
  // close the panel before the first start → back to the welcome screen; focus returns to the Style pill
  function closePrestart(focusStyle) {
    sheetClosed = true; applyPanel();
    if (focusStyle && styleBtn) { try { styleBtn.focus({ preventScroll: true }); } catch (e) {} }
  }
  function applyPanel() {
    var vis = !running && (everStarted || panelForced) && !sheetClosed && !timerOpen;   // hidden while the timer sheet is open
    root.classList.toggle('is-panel-open', vis);
    if (panel) { panel.setAttribute('aria-hidden', vis ? 'false' : 'true'); try { panel.inert = !vis; } catch (e) {} }
    if (sheetResumeBtn) sheetResumeBtn.textContent = everStarted ? '\u25B6 Resume' : '\u25B6 Start';
    if (styleBtn) styleBtn.setAttribute('aria-expanded', vis ? 'true' : 'false');
    if (vis && unlockActive()) loadUnlock();
    if (!vis && unlockUI && unlockUI.panelClosed) unlockUI.panelClosed();
  }

  function buildPanel() {
    var panel = panelBody;   // sections live in the scrolling body
    panel.appendChild(el('h3', 'nm-h', 'Character'));
    charGrid = el('div', 'nm-grid'); charGrid.setAttribute('role', 'group'); charGrid.setAttribute('aria-label', 'Character');
    fillGrid(charGrid, 'char', CHARACTERS);
    panel.appendChild(charGrid);

    panel.appendChild(el('h3', 'nm-h', 'Background'));
    sceneGrid = el('div', 'nm-grid'); sceneGrid.setAttribute('role', 'group'); sceneGrid.setAttribute('aria-label', 'Background');
    fillGrid(sceneGrid, 'scene', SCENES);
    panel.appendChild(sceneGrid);
    // legend only without the unlock UI (interest mode); with it the Unlock button below says it all (removed 2026-11-03)
    if (!unlockActive()) {
      legend = el('p', 'nm-legend', '\uD83D\uDD12 = locked \u2014 tap one to tell us you\u2019re interested');
      legend.hidden = isUnlocked();
      panel.appendChild(legend);
    }

    // unlock UI: the one-line entry (filled by unlock.js) + a hidden card slot used only by browsers without
    // <dialog>.showModal; without the unlock UI (tool-test.html without kq-dev) today's interest card
    interestCard = el('div', 'nm-card');
    interestCard.hidden = true;
    if (unlockActive()) {
      unlockLine = el('div', 'nm-unlock-line');
      unlockLine.hidden = true;
      panel.appendChild(unlockLine);
      interestCard.className = 'nm-card nm-unlock';
      interestCard.setAttribute('role', 'region'); interestCard.setAttribute('aria-label', 'Unlock');
    } else {
      interestCard.setAttribute('role', 'region'); interestCard.setAttribute('aria-label', 'More characters and backgrounds');
      interestCard.appendChild(el('p', '', 'Want more characters and backgrounds? If enough teachers ask, we\u2019ll build them.'));
      var interestBtn = button('nm-pill', '', 'I\u2019m interested');
      interestBtn.addEventListener('click', function () {
        signal('pro-click', { item: 'interest', from: 'panel' });
        var thanks = el('p', 'nm-card-thanks', 'Thanks \u2014 counted!'); thanks.setAttribute('role', 'status');
        interestCard.innerHTML = ''; interestCard.appendChild(thanks);
      });
      interestCard.appendChild(interestBtn);
    }
    panel.appendChild(interestCard);

    panel.appendChild(el('h3', 'nm-h', 'Indicator'));
    var indGrid = el('div', 'nm-grid nm-ind'); indGrid.setAttribute('role', 'group'); indGrid.setAttribute('aria-label', 'Indicator');
    [['dial', 'Dial', ICON.miniDial], ['bar', 'Bar', ICON.miniBar]].forEach(function (opt) {
      var b = el('button', 'nm-thumb nm-ind-opt', opt[2]);   // preview only; the name is the aria-label
      b.type = 'button';
      b.setAttribute('aria-label', opt[1]);
      b.setAttribute('aria-pressed', indicatorKind === opt[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        var changed = indicatorKind !== opt[0];
        applyIndicator(opt[0]);
        var all = indGrid.querySelectorAll('[aria-pressed]');
        for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        if (changed) signal('setting-change', { what: 'indicator' });
      });
      indGrid.appendChild(b);
    });
    panel.appendChild(indGrid);

    // Microphone and Sensitivity need the stream: before the first start (.is-fresh) CSS shows the muted note
    // "Available after Start" instead of their controls (Style pill, decided 2026-11-02)
    panel.appendChild(el('h3', 'nm-h', 'Microphone'));
    panel.appendChild(el('p', 'nm-prestart', 'Available after Start'));
    var micSel = makeMicSelect(); micSel.classList.add('nm-needs-stream');
    panel.appendChild(micSel);
    if (running) fillMicList();

    var sensId = 'nm-sens';
    var sensHead = el('div', 'nm-h nm-h-row');
    var sensLab = el('label', '', 'Sensitivity'); sensLab.setAttribute('for', sensId);
    sensDefaultBtn = button('nm-reset nm-needs-stream', 'Back to the default sensitivity', 'Default');   // hidden while already at the default
    sensDefaultBtn.addEventListener('click', function () {
      if (sensitivity === 1) return;
      sensitivity = 1; lsSet(LS_SENS, '1'); sensSlider.value = '100';
      updateSensDefault();
      signal('setting-change', { what: 'sensitivity' });
    });
    sensHead.appendChild(sensLab); sensHead.appendChild(sensDefaultBtn);
    panel.appendChild(sensHead);
    sensSlider = document.createElement('input');
    sensSlider.type = 'range'; sensSlider.id = sensId; sensSlider.className = 'nm-range nm-needs-stream';
    sensSlider.min = '50'; sensSlider.max = '200'; sensSlider.step = '5';
    sensSlider.value = String(Math.round(sensitivity * 100));
    sensSlider.addEventListener('input', function () {        // live while dragging
      sensitivity = parseInt(sensSlider.value, 10) / 100;
      lsSet(LS_SENS, String(sensitivity));
      updateSensDefault();
    });
    sensSlider.addEventListener('change', function () {       // once per drag end
      signal('setting-change', { what: 'sensitivity' });
    });
    panel.appendChild(el('p', 'nm-prestart', 'Available after Start'));
    panel.appendChild(sensSlider);
    updateSensDefault();
    // sticky copy of the Unlock button (filled by unlock.js): last node of the scrolling body, fixed height while locked
    if (unlockActive()) { unlockSticky = el('div', 'nm-unlock-sticky'); unlockSticky.hidden = true; panel.appendChild(unlockSticky); }
    unlockLineSlot = interestCard;   // locked entry sits before this node; the unlocked row moves to the panel's end
  }
  // unlock.js: the unlocked row ("✓ Unlocked · KQ-… Show · Manage") goes to the bottom of the panel, after Sensitivity,
  // in small muted text; the locked entry (button + caption + Restore) and the free-window line stay above the cards
  var unlockLineSlot = null, unlockSticky = null;
  function placeUnlockLine(atEnd) {
    if (!unlockLine || !panelBody) return;
    unlockLine.classList.toggle('nm-unlock-foot', !!atEnd);
    if (atEnd) { if (unlockLine !== panelBody.lastChild) panelBody.appendChild(unlockLine); }
    else if (unlockLineSlot && unlockLine.nextSibling !== unlockLineSlot) panelBody.insertBefore(unlockLine, unlockLineSlot);
  }
  function updateSensDefault() { if (sensDefaultBtn) sensDefaultBtn.hidden = (sensitivity === 1); }

  /* ---------- feedback line: after a pause that ends a session of ≥ 2 min, at most once per 30 days ---------- */
  function feedbackRecent() {
    try {
      var v = JSON.parse(lsGet(LS_FEEDBACK) || 'null');
      if (!v || !v.date) return false;
      return (Date.now() - new Date(v.date).getTime()) < 30 * 86400000;
    } catch (e) { return false; }
  }
  function removeFeedback() {
    clearTimeout(feedbackTimer);
    if (feedbackLine && feedbackLine.parentNode) feedbackLine.parentNode.removeChild(feedbackLine);
    feedbackLine = null;
  }
  function maybeFeedback(sessionMs) {
    if (!panel || sessionMs < 120000 || feedbackRecent() || feedbackLine) return;
    var minutes = minutesBucket(sessionMs);
    var today = new Date().toISOString().slice(0, 10);
    feedbackLine = el('div', 'nm-feedback'); feedbackLine.setAttribute('role', 'group'); feedbackLine.setAttribute('aria-label', 'Feedback');
    feedbackLine.appendChild(el('span', 'nm-fb-q', 'Was it useful today?'));
    function vote(v) {
      signal('feedback', { vote: v, minutes: minutes });
      lsSet(LS_FEEDBACK, JSON.stringify({ vote: v, date: today }));
      var thanks = el('span', 'nm-fb-q', 'Thanks!'); thanks.setAttribute('role', 'status');
      feedbackLine.innerHTML = ''; feedbackLine.appendChild(thanks);
      feedbackTimer = setTimeout(removeFeedback, 3000);
    }
    var up = button('nm-fb-btn', 'Yes, it was useful', '\uD83D\uDC4D'); up.addEventListener('click', function () { vote('up'); });
    var down = button('nm-fb-btn', 'No, it was not useful', '\uD83D\uDC4E'); down.addEventListener('click', function () { vote('down'); });
    var x = button('nm-fb-btn nm-fb-x', 'Dismiss', '\u00D7'); x.addEventListener('click', function () {
      lsSet(LS_FEEDBACK, JSON.stringify({ dismissed: true, date: today }));
      removeFeedback();
    });
    feedbackLine.appendChild(up); feedbackLine.appendChild(down); feedbackLine.appendChild(x);
    panelBody.insertBefore(feedbackLine, panelBody.firstChild);
  }

  function thumbPicture(kind, item) {
    var base = ASSETS + 'thumb/' + item.id + (item.free ? '-1' : '');
    var pic = makePicture(base, kind === 'char' ? 'png' : 'jpg', '', 160, 160, 'nm-thumb-pic', false);
    pic.querySelector('img').loading = 'lazy';
    return pic;
  }
  // offer dialog (unlock.js, 2026-11-03): every character and background thumb, no lock badge, lazy-loaded; names as alt
  function thumbStrip() {
    var wrap = el('div', 'kq-strip');
    [['char', CHARACTERS], ['scene', SCENES]].forEach(function (g) {
      var row = el('div', 'kq-strip-row');
      g[1].forEach(function (item) {
        var cell = el('span', 'kq-strip-thumb');
        var pic = thumbPicture(g[0], item);
        pic.querySelector('img').alt = item.name;
        cell.appendChild(pic);
        row.appendChild(cell);
      });
      wrap.appendChild(row);
    });
    return wrap;
  }
  function fillGrid(grid, kind, items) {
    var unlocked = isUnlocked();
    items.forEach(function (item) {
      var locked = !item.free && !unlocked;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'nm-thumb' + (locked ? ' is-locked' : '');
      var selected = (kind === 'char' ? current.character : current.scene) === item.id;
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
      b.setAttribute('aria-label', item.name + (locked ? ' (locked)' : ''));
      b.setAttribute('data-item', kind + '-' + item.id);
      b.appendChild(thumbPicture(kind, item));
      if (locked) b.appendChild(el('span', 'nm-lock', ICON.lock));
      b.addEventListener('click', function () {
        if (locked) {   // never becomes "selected": brief white focus flash, then the unlock / interest card
          proClick(kind + '-' + item.id);
          b.classList.add('is-flash');
          setTimeout(function () { b.classList.remove('is-flash'); try { b.blur(); } catch (e) {} }, 700);
          return;
        }
        var changed = selectItem(kind, item.id);
        var all = grid.querySelectorAll('[aria-pressed]');
        for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        if (changed) signal('setting-change', { what: kind === 'char' ? 'character' : 'scene' });
      });
      grid.appendChild(b);
    });
  }
  // after an unlock (or a FREE_UNTIL window): rebuild both grids without badges, hide the legend
  function refreshGrids() {
    if (charGrid) { charGrid.innerHTML = ''; fillGrid(charGrid, 'char', CHARACTERS); }
    if (sceneGrid) { sceneGrid.innerHTML = ''; fillGrid(sceneGrid, 'scene', SCENES); }
    if (legend) legend.hidden = isUnlocked();
  }

  /* ---------- locked tap → counted + the unlock dialog (or, without the unlock UI, the inline interest card) ---------- */
  function proClick(item) {
    signal('pro-click', { item: item });
    if (unlockActive()) loadUnlock().then(function (ui) { if (ui) ui.show('thumb'); });
    else if (interestCard) { interestCard.hidden = false; scrollPanelTo(interestCard); }
    try { root.dispatchEvent(new CustomEvent('kq:pro-click', { bubbles: true, detail: { item: item } })); } catch (e) {}
  }
  // bring an element into the PANEL's view (the panel scrolls itself; the page never moves)
  function scrollPanelTo(node) {
    if (!panelBody || !node) return;
    var bottom = node.offsetTop + node.offsetHeight;
    if (bottom > panelBody.scrollTop + panelBody.clientHeight) {
      var top = Math.max(0, Math.min(node.offsetTop - 12, bottom - panelBody.clientHeight + 12));
      try { panelBody.scrollTo({ top: top, behavior: reducedMotion ? 'auto' : 'smooth' }); } catch (e) { panelBody.scrollTop = top; }
    }
  }

  /* ---------- unlock.js: lazy loader + the API it receives (window.__kqTool) ---------- */
  var unlockPromise = null, unlockUI = null;
  var toolApi = {
    root: root, signal: signal, el: el, button: button, lsGet: lsGet, lsSet: lsSet, lsDel: lsDel,
    isTestMode: isTestMode, reducedMotion: reducedMotion,
    freeUntil: FREE_UNTIL, freeWindow: freeWindow,
    mount: function () { return { line: unlockLine, card: interestCard, sticky: unlockSticky, scroller: panelBody }; },   // panel line, fallback card slot, sticky CTA slot, the panel's scroll area (IntersectionObserver root)
    thumbStrip: thumbStrip,                               // the offer dialog's strip: all 8 + 5 thumbs, unlocked look, lazy
    placeLine: placeUnlockLine,                           // true = unlocked row at the panel's end (small, muted)
    scrollPanelTo: scrollPanelTo,
    setUnlocked: refreshGrids,                            // key stored → badges off, every item selectable
    openPanel: function () { closeTimerSheet(false); panelForced = true; sheetClosed = false; applyPanel(); },
    showCharacters: function () {                         // thank-you "Choose a character →": panel open at its top (= the character
      closeTimerSheet(false);                             // grid, phones too), focus on the selected character, no page scroll
      panelForced = true; sheetClosed = false; applyPanel();
      if (panelBody) panelBody.scrollTop = 0;
      var b = charGrid && (charGrid.querySelector('[aria-pressed="true"]') || charGrid.querySelector('button'));
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) { try { b.focus(); } catch (x) {} } }
    },
    isPanelOpen: function () { return root.classList.contains('is-panel-open'); },
    isFullscreen: function () { return expanded || isFullscreen(); },   // the dialog hides its "See what's included" link then
    pauseForRedirect: function () {                       // before location.assign(Stripe)
      if (running) stop();
      if (expanded) leaveExpanded(false); else if (isFullscreen()) exitFullscreen();
    }
  };
  window.__kqTool = toolApi;
  function loadUnlock() {
    if (!unlockPromise) {
      unlockPromise = import('./unlock.js?v=' + UNLOCK_V).then(function (mod) {
        unlockUI = mod.default(toolApi);
        return unlockUI;
      }).catch(function (e) { try { console.error('[kq] unlock.js failed to load', e); } catch (x) {} return null; });
    }
    return unlockPromise;
  }
  // price card in the pricing section (index.html #pro-card[data-kq-unlock-card]): Unlock → /checkout directly,
  // "Already unlocked? Restore" → the dialog; unlock.js loads on the first interaction and, once a key is stored,
  // rewrites the card's actions block to "✓ Unlocked · Manage"
  var proCardEl = document.getElementById('pro-card');
  if (proCardEl && unlockActive()) {
    var preload = function () { loadUnlock(); };
    proCardEl.addEventListener('pointerenter', preload, { once: true });
    proCardEl.addEventListener('focusin', preload, { once: true });
    proCardEl.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-kq-unlock],[data-kq-restore]') : null;
      if (!t) return;
      ev.preventDefault();
      loadUnlock().then(function (ui) { if (ui) ui.cardAction(t); });
    });
  }
  // the card below the fold: same text, same button, from:"card"
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-kq-interest]') : null;
    if (!t) return;
    ev.preventDefault();
    signal('pro-click', { item: 'interest', from: 'card' });
    t.disabled = true;
    var thanks = document.querySelector('[data-kq-interest-thanks]');
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
          o.textContent = cleanMicLabel(d.label, i);
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

  /* ---------- fullscreen: native API, or "expanded" mode where it is missing (iPhone Safari) ---------- */
  var expanded = false, expandedHistory = false, fsHint = null;
  function fullscreenSupported() { return !!(stage.requestFullscreen || stage.webkitRequestFullscreen); }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function updateFsBtn() {
    var on = isFullscreen() || expanded;
    root.classList.toggle('is-fullscreen', on);
    if (fsBtn) fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    if (fsText) fsText.textContent = on ? 'Exit' : 'Fullscreen';
  }
  function toggleFullscreen() {
    if (!fullscreenSupported()) { if (expanded) leaveExpanded(false); else enterExpanded(); return; }
    if (isFullscreen()) { exitFullscreen(); return; }
    var p;
    try { p = stage.requestFullscreen ? stage.requestFullscreen() : stage.webkitRequestFullscreen(); } catch (e) { return; }
    if (p && p.catch) p.catch(function () {});
    signal('fullscreen', { mode: 'native' });
  }
  function exitFullscreen() {
    try {
      var p = document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen && document.webkitExitFullscreen());
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('fullscreenchange', updateFsBtn);
  document.addEventListener('webkitfullscreenchange', updateFsBtn);

  // expanded mode: the stage is fixed over the whole page, body scroll locked; Escape or the back button exits
  function enterExpanded() {
    expanded = true;
    root.classList.add('is-expanded');
    document.documentElement.classList.add('nm-lock');
    try { history.pushState({ nmExpanded: true }, ''); expandedHistory = true; } catch (e) { expandedHistory = false; }
    updateFsBtn();
    showFsHintOnce();
    signal('fullscreen', { mode: 'expanded' });
  }
  function leaveExpanded(fromHistory) {
    if (!expanded) return;
    expanded = false;
    root.classList.remove('is-expanded');
    document.documentElement.classList.remove('nm-lock');
    removeFsHint();
    updateFsBtn();
    if (!fromHistory && expandedHistory) { expandedHistory = false; try { history.back(); } catch (e) {} }
    expandedHistory = false;
  }
  window.addEventListener('popstate', function () { if (expanded) leaveExpanded(true); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var dialogOpen = !!document.querySelector('dialog[open]');   // an open unlock dialog handles its own Escape
    if (timerOpen && !dialogOpen) { closeTimerSheet(true); return; }   // timer sheet = Cancel
    // panel opened by the Style pill before the first start: Escape closes it first
    if (!everStarted && root.classList.contains('is-panel-open') && !dialogOpen) { closePrestart(true); return; }
    if (expanded) leaveExpanded(false);
  });
  function removeFsHint() { if (fsHint && fsHint.parentNode) fsHint.parentNode.removeChild(fsHint); fsHint = null; }
  function showFsHintOnce() {
    if (lsGet(LS_FS_HINT) === '1' || fsHint) return;
    lsSet(LS_FS_HINT, '1');
    fsHint = el('div', 'nm-hint'); fsHint.setAttribute('role', 'status');
    fsHint.appendChild(el('span', '', 'For a true full screen, add this page to your Home Screen.'));
    var x = button('nm-hint-x', 'Dismiss', ICON.close);
    x.addEventListener('click', removeFsHint);
    fsHint.appendChild(x);
    stage.appendChild(fsHint);
  }

  /* ---------- quiet-time timer: button (top-right row), sheet, pill, chime (2026-11-07; bound to the meter 2026-11-09) ---------- */
  // States: none → set (waiting, pill shows the full length) → running (counts only while the meter runs) → paused
  // (meter paused: remaining ms frozen) → done (0:00). Meter Start/Resume → running, meter Pause → paused.
  var timerBtn, timerSheet, timerSaveBtn, timerRemoveBtn, timerChips = [], timerInput, timerOpen = false, timerSeconds = TIMER_DEFAULT;
  var timerPill = null, timerTime = null, timerLive = null, timerFill = null, timerLastLive = '';
  var timerState = 'none', timerLen = 0, timerRemaining = 0, timerTarget = 0, timerInterval = 0, timerStartSent = false;

  function savedTimerSeconds() {
    var v = parseInt(lsGet(LS_TIMER), 10);
    return (v >= 60 && v <= TIMER_MAX_MIN * 60 && v % 60 === 0) ? v : TIMER_DEFAULT;
  }
  function customMinutes() {   // the Custom field: a valid 1–90 number, 0 = empty, -1 = out of range
    if (!timerInput || timerInput.value === '') return 0;
    var m = parseInt(timerInput.value, 10);
    return (m >= 1 && m <= TIMER_MAX_MIN && String(m) === timerInput.value.trim()) ? m : -1;
  }
  // Same look as the settings sheet: grey round × top-right (same class and position), section heading, one white Save pill
  function buildTimerSheet() {
    timerSheet = el('div', 'nm-tsheet');
    timerSheet.id = 'nm-timer-sheet';
    timerSheet.setAttribute('role', 'dialog'); timerSheet.setAttribute('aria-label', 'Timer'); timerSheet.setAttribute('aria-modal', 'false');
    timerSheet.hidden = true;
    var x = button('nm-sheet-close', 'Close timer settings', ICON.close);
    x.addEventListener('click', function () { closeTimerSheet(true); });
    timerSheet.appendChild(x);
    timerSheet.appendChild(el('h3', 'nm-h', 'Timer'));
    // presets: a radio group with a roving tabindex — arrow keys move AND select, like native radios
    var chips = el('div', 'nm-tchips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Minutes');
    TIMER_PRESETS.forEach(function (m, i) {
      var c = el('button', 'nm-tchip', m + ' min'); c.type = 'button';
      c.setAttribute('role', 'radio'); c.setAttribute('data-min', String(m));
      c.addEventListener('click', function () { setTimerSelection(m * 60, true); });
      c.addEventListener('keydown', function (e) {
        var d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0);
        var to = d ? (i + d + TIMER_PRESETS.length) % TIMER_PRESETS.length : (e.key === 'Home' ? 0 : (e.key === 'End' ? TIMER_PRESETS.length - 1 : -1));
        if (to < 0) return;
        e.preventDefault();
        setTimerSelection(TIMER_PRESETS[to] * 60, true);
        try { timerChips[to].focus({ preventScroll: true }); } catch (x) {}
      });
      chips.appendChild(c); timerChips.push(c);
    });
    timerSheet.appendChild(chips);
    var custom = el('label', 'nm-tcustom');
    custom.appendChild(el('span', '', 'Custom'));
    timerInput = document.createElement('input');
    timerInput.type = 'number'; timerInput.className = 'nm-tinput';
    timerInput.min = '1'; timerInput.max = String(TIMER_MAX_MIN); timerInput.step = '1';
    timerInput.placeholder = '45';
    timerInput.setAttribute('inputmode', 'numeric');
    timerInput.setAttribute('aria-label', 'Custom length in minutes, 1 to ' + TIMER_MAX_MIN);
    timerInput.setAttribute('aria-describedby', 'nm-timer-hint');
    timerInput.addEventListener('input', function () {
      var m = customMinutes();
      if (m > 0) setTimerSelection(m * 60, false);
      else updateTimerSave();   // empty or out of range: chips keep their state, Save follows the validity
    });
    timerInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!timerSaveBtn.disabled) saveTimer(); } });
    custom.appendChild(timerInput);
    custom.appendChild(el('span', '', 'min'));
    timerSheet.appendChild(custom);
    var hint = el('p', 'nm-thint', '1–90 minutes'); hint.id = 'nm-timer-hint';
    timerSheet.appendChild(hint);
    timerSaveBtn = button('nm-pill nm-tsave', '', 'Save');
    timerSaveBtn.addEventListener('click', saveTimer);
    timerSheet.appendChild(timerSaveBtn);
    // "Remove timer": text link under Save, shown only while a timer exists — same as the pill's ✕, then the sheet closes
    timerRemoveBtn = button('nm-tremove', '', 'Remove timer');
    timerRemoveBtn.hidden = true;
    timerRemoveBtn.addEventListener('click', function () { closeTimerSheet(false); closeTimer(); });   // closeTimer() focuses the Timer button
    timerSheet.appendChild(timerRemoveBtn);
    stage.appendChild(timerSheet);
  }
  // seconds → chips (the matching preset is checked, else none; the checked or first chip is the tab stop); fromChip clears Custom
  function setTimerSelection(seconds, fromChip) {
    timerSeconds = seconds;
    var checkedAt = -1;
    timerChips.forEach(function (c, i) {
      var on = parseInt(c.getAttribute('data-min'), 10) * 60 === seconds;
      if (on) checkedAt = i;
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    timerChips.forEach(function (c, i) { c.tabIndex = i === (checkedAt < 0 ? 0 : checkedAt) ? 0 : -1; });
    if (timerInput && fromChip) timerInput.value = '';
    else if (timerInput && checkedAt < 0 && timerInput.value !== String(seconds / 60)) timerInput.value = String(seconds / 60);
    updateTimerSave();
  }
  function updateTimerSave() { if (timerSaveBtn) timerSaveBtn.disabled = customMinutes() < 0; }   // disabled only while Custom is out of 1–90
  function openTimerSheet() {
    if (timerOpen) return;
    timerOpen = true;
    setTimerSelection(timerState !== 'none' ? timerLen : savedTimerSeconds(), false);   // an existing timer: its length is preselected
    if (timerInput && timerChips.some(function (c) { return c.getAttribute('aria-checked') === 'true'; })) timerInput.value = '';
    timerRemoveBtn.hidden = timerState === 'none';
    timerSheet.hidden = false;
    root.classList.add('is-timer-open');
    timerBtn.setAttribute('aria-expanded', 'true');
    applyPanel();   // hides the settings panel while the sheet is open
    var first = timerChips.filter(function (c) { return c.tabIndex === 0; })[0];
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }
  // ×, Escape, the button again (no change), or after Save; focusBtn = the Timer button takes the focus back
  function closeTimerSheet(focusBtn) {
    if (!timerOpen) return;
    timerOpen = false;
    timerSheet.hidden = true;
    root.classList.remove('is-timer-open');
    timerBtn.setAttribute('aria-expanded', 'false');
    applyPanel();   // the panel comes back where it was (paused, or opened by Style)
    if (focusBtn) { try { timerBtn.focus({ preventScroll: true }); } catch (e) {} }
  }
  // Save: a new timer of the chosen length (replaces an existing one, no cancel signal). Meter running → counts at once,
  // otherwise it waits ("set") until the meter starts.
  function saveTimer() {
    var m = customMinutes();
    if (m < 0) return;
    var seconds = m > 0 ? m * 60 : timerSeconds;
    if (!(seconds >= 60 && seconds <= TIMER_MAX_MIN * 60)) seconds = TIMER_DEFAULT;
    lsSet(LS_TIMER, String(seconds));
    closeTimerSheet(true);
    if (!timerPill) buildTimerPill();
    timerLen = seconds;
    timerStartSent = false;
    signal('timer-set', { seconds: String(seconds) });
    resetTimer();
    setTimerState(running ? 'running' : 'set');
  }
  // ↻ and Save: remaining back to the full length; a running timer gets a fresh target
  function resetTimer() {
    timerRemaining = timerLen * 1000;
    timerTarget = Date.now() + timerRemaining;
    timerLastLive = '';
  }
  function setTimerState(state) {
    timerState = state;
    clearInterval(timerInterval); timerInterval = 0;
    if (state === 'running') {
      timerTarget = Date.now() + timerRemaining;
      timerInterval = setInterval(renderTimer, 250);
      if (!timerStartSent) { timerStartSent = true; signal('timer-start', { seconds: String(timerLen) }); }
    }
    root.classList.toggle('is-timer', state !== 'none');
    root.classList.toggle('is-timer-running', state === 'running');          // green ring on the Timer button; CSS hides the pill's ↻ ✕
    root.classList.toggle('is-timer-set', state === 'set' || state === 'paused');   // amber ring
    if (timerPill) {
      timerPill.classList.toggle('is-waiting', state === 'set');
      timerPill.classList.toggle('is-paused', state === 'paused');
      timerPill.classList.toggle('is-done', state === 'done');
      timerPill.setAttribute('aria-label', state === 'paused' ? 'Timer paused' : 'Quiet-time timer');
    }
    renderTimer();
  }
  // the meter's start() and stop() call these: the timer counts only while the meter runs
  function onMeterStart() { if (timerState === 'set' || timerState === 'paused') setTimerState('running'); }
  function onMeterStop() {
    if (timerState !== 'running') return;
    timerRemaining = Math.max(0, timerTarget - Date.now());
    setTimerState('paused');
  }
  function buildTimerPill() {
    timerPill = el('div', 'nm-tpill'); timerPill.setAttribute('role', 'group'); timerPill.setAttribute('aria-label', 'Quiet-time timer');
    var pauseGlyph = el('span', 'nm-tpause', '⏸'); pauseGlyph.setAttribute('aria-hidden', 'true');   // shown by CSS in .is-paused only
    timerTime = el('span', 'nm-ttime'); timerTime.setAttribute('aria-hidden', 'true');   // ticks every 250 ms: never read aloud itself
    timerLive = el('span', 'sr-only'); timerLive.setAttribute('aria-live', 'polite'); timerLive.setAttribute('aria-atomic', 'true');
    var bar = el('span', 'nm-tbar'); bar.setAttribute('aria-hidden', 'true');
    timerFill = el('span', 'nm-tfill'); bar.appendChild(timerFill);
    var re = button('nm-tbtn nm-trestart', 'Restart timer', '↻');
    re.addEventListener('click', restartTimer);
    var x = button('nm-tbtn nm-tclose', 'Close timer', '✕');
    x.addEventListener('click', closeTimer);
    timerPill.appendChild(pauseGlyph); timerPill.appendChild(timerTime); timerPill.appendChild(timerLive); timerPill.appendChild(bar); timerPill.appendChild(re); timerPill.appendChild(x);
    stage.appendChild(timerPill);
  }
  function timerLeftSeconds() {
    var ms = timerState === 'running' ? timerTarget - Date.now() : timerRemaining;
    return Math.max(0, Math.ceil(ms / 1000));
  }
  function renderTimer() {
    if (!timerPill) return;
    var left = timerLeftSeconds();
    var m = Math.floor(left / 60), s = left % 60;
    timerTime.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    timerFill.style.width = (timerLen ? left / timerLen * 100 : 0).toFixed(1) + '%';
    if (timerState === 'running' || timerState === 'done') {
      var live = '';   // the live region speaks only at full minutes, in the last 10 s and at the end
      if (left === 0) live = 'Time is up';
      else if (left <= 10) live = left + (left === 1 ? ' second left' : ' seconds left');
      else if (s === 0) live = m + (m === 1 ? ' minute left' : ' minutes left');
      if (live && live !== timerLastLive) { timerLastLive = live; timerLive.textContent = live; }
    }
    if (left === 0 && timerState === 'running') finishTimer();
  }
  function finishTimer() {
    timerRemaining = 0;
    setTimerState('done');   // CSS: red pill, the time pulses twice (not under reduced motion)
    chime();
    signal('timer-done', {});
  }
  // ↻: remaining back to the full length, the state stays (running keeps counting, set / paused keep waiting);
  // after 0:00 it is a new run — counting if the meter runs, else waiting (timer-start again when it begins)
  function restartTimer() {
    if (!timerLen || timerState === 'none') return;
    resetTimer();
    if (timerState === 'done') { timerStartSent = false; setTimerState(running ? 'running' : 'set'); }
    else setTimerState(timerState);
  }
  // ✕ on the pill or "Remove timer" in the sheet: remove the timer entirely (timer-cancel unless it was done)
  function closeTimer() {
    if (!timerPill) return;
    if (timerState !== 'done') signal('timer-cancel', { remaining: minutesBucket(timerLeftSeconds() * 1000) });
    if (timerPill.parentNode) timerPill.parentNode.removeChild(timerPill);
    timerPill = timerTime = timerLive = timerFill = null;
    timerRemaining = 0;
    setTimerState('none');
    try { timerBtn.focus({ preventScroll: true }); } catch (e) {}
  }
  // soft chime: two sine tones 880 → 1175 Hz, 150 ms each, gain .15 with a short fade, on the meter's AudioContext
  // (the meter is running when a timer reaches 0:00, so the context exists; none or a refused resume = silent)
  function chime() {
    if (!ctx) return;
    function play() {
      try {
        var t0 = ctx.currentTime + 0.02;
        [880, 1175].forEach(function (f, i) {
          var o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.16;
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.15, t + 0.015);
          g.gain.setValueAtTime(0.15, t + 0.11);
          g.gain.linearRampToValueAtTime(0.0001, t + 0.15);
          o.connect(g); g.connect(ctx.destination);
          o.start(t); o.stop(t + 0.16);
        });
      } catch (e) {}
    }
    try {
      if (ctx.state === 'running') play();
      else { var p = ctx.resume(); if (p && p.then) p.then(play, function () {}); else play(); }
    } catch (e) {}
  }
  // background tabs throttle timers: re-read the clock as soon as the tab is visible again
  document.addEventListener('visibilitychange', function () { if (!document.hidden && timerState === 'running') renderTimer(); });

  /* ---------- hash → open the targeted FAQ <details> (privacy link on the overlay) ---------- */
  function openHashDetails() {
    var id = (location.hash || '').slice(1);
    if (!id) return;
    var d = document.getElementById(id);
    if (d && d.tagName === 'DETAILS') d.open = true;
  }
  window.addEventListener('hashchange', openHashDetails);

  /* ---------- init ---------- */
  buildControls();
  openHashDetails();
  playBtn.addEventListener('click', function () { if (running) stop(); });
  if (startBtn) startBtn.addEventListener('click', function () { if (!running) start(); });
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
  if (unlockActive() && (window.__kqUnlock || lsGet(LS_LICENSE) || (document.body && document.body.hasAttribute('data-kq-unlock-gate')))) loadUnlock();
  window.addEventListener('pagehide', function () { if (running) stop(); });
})();
