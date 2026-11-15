/*
  Token Board – browser unlock (one-time payment, Stripe Checkout via the Worker in worker/).
  Loaded lazily by tool.js: import('./unlock.js?v=' + UNLOCK_V) when an entry point is used, when the
  style panel opens, when the page carries ?unlock= / ?k= (window.__tbUnlock, set by the inline head
  script), when a valid key is already stored, or on the first pointer / focus on the price card.
  Never on first paint for a normal visitor.
  Default export: init(api) → the UI controller. `api` is the bridge object from tool.js
  (worker/README.md § 8.4.4: signal, el, button, storage with in-memory fallback, panel hooks).

  Contract: worker/README.md § 2 (endpoints, error codes), § 7 (key format), § 8 (browser side, § 8.4 =
  this dialog, its entry points and signals), § 9 (mock mode — implemented literally below).

  UI:
  - Entry points live in tool.js (locked tile, locked goal stepper / number input, the ✨ button under the
    board, the ✨ celebration button): they call show(from, opener) → the offer dialog.
  - Price card (#pricing → #pro-card[data-tbu-card]): its main button starts the payment directly
    (cardAction → checkout('card')); its second button opens the dialog in restore mode. After unlock the
    card's actions block shows "✓ Unlocked · Manage".
  - Panel line (#tbu-line, bottom of the panel body): hidden while locked; unlocked →
    "✓ Unlocked · TB-••••-••••-1234 · Show · Manage".
  - Dialog (native <dialog>, showModal, top layer — above the phone sheet, the celebration and the
    expanded stage; attached inside the stage while it is in native fullscreen): the offer (title, offer
    line, preview row, the button, trust line, small print, "See what's included ↓", the collapsed
    "Already unlocked? Restore" link — it expands the field —, Questions); restore mode opens the field
    expanded; after a purchase or a restore → the thank-you / Manage view (key masked + Show / Copy,
    restore link + Copy, "sent to …" after a purchase, Help); every error and the cancel text are shown in
    the dialog. Purchase view only (?unlock= return): the purchase line, the main action
    "Style your board →" and a one-time confetti burst (never on restore, Manage, ?k= or reload; none
    under reduced motion or in the no-showModal fallback).
    Dev hook: tool-test.html?dev-thanks=1 with tb-dev = "1" opens that view with an example key (not
    stored, no request, no signal) and fires the confetti.
    Browsers without showModal get the same content as a card inside the panel (api.mount().card).

  Restore row (Step 5b, EMAIL_RESTORE = true): input with "@" → the email path (trim + lower-case, client-side
  check, POST /magic; the answer text is the same for known and unknown addresses), anything else → the key
  path (POST /restore). The email is never stored, never logged by this file and never put into a signal.
  Signals (README § 8.4.5): unlock-click {from: panel|toolbar|celebration|card — the pressed Unlock
  button, or the opener of the dialog it sits in; anything else "unknown"}, unlock-success {via; + from
  when via is checkout}, unlock-cancel {from}, unlock-fail {reason}, unlock-restore-attempt {via: key (typed) | url (?k=) | mail (?k=…&src=mail) | email (POST /magic)},
  dialog-open {from: panel|toolbar|celebration|restore|manage — the visitor opened the dialog (or its
  fallback card); never sent when it opens by itself: Stripe return, ?k= result, checkout error}.
  Never the key, the email, the device id or the session id.
  Across the Stripe redirect (sessionStorage, try/catch, front end only): tb-unlock-from = the from of the
  pressed Unlock button, read and deleted on the return; tb-test-return = "1" when the page was in
  TelemetryDeck test mode, read and deleted by assets/tool-signals.js on the next page load.

  Every user-facing string lives in STRINGS (plus the static pricing section and the static button texts
  and hints in index.html / tool-test.html). The price appears only as PRICE_LABEL ({price} in STRINGS);
  the static places mirror it by hand — all of them = the amount of the Stripe Price.
*/

export const PRICE_LABEL = '$19.99';
export const EMAIL_RESTORE = true;   // Step 5b: input with "@" → POST /magic. false = key path only (Step 5a)
export const CALL_TIMEOUT_MS = 15000;   // Step 6a: time limit of every real Worker call; after it the call counts as unreachable (README § 8.4.3)

export const STRINGS = {
  support: 'support@token-board.app',   // buyer-facing support for the web unlock; the app keeps its own address

  // offer
  offerTitle: 'Unlock all extras for your token board',
  offerLine: 'Your own photos, any token goal from 3 to 100, and all 59 rewards, 23 token icons and 8 backgrounds.',
  preview: ['🦄', '🚀', '🌈', '🦖', '🎠', '🖼️'],
  previewLabel: 'Examples of the extras',
  unlockLine1: 'Unlock all extras',        // the Unlock button, line 1 (bold) …
  unlockLine2: '{price} one-time',         // … line 2 (smaller); the price card in the pages mirrors both
  unlockBusy: 'Opening the payment page…',
  // trust line under the button (dialog; the price card mirrors it in the pages): [icon, text]
  trust: [['check', 'One-time payment'], ['check', 'no subscription'], ['lock', 'secure checkout by Link (Stripe)'], ['bolt', 'unlocks instantly, key also emailed']],
  offerFine: 'Web version — the iPhone, iPad and Mac app is sold separately in the App Store. {price} plus tax where applicable; the exact total is shown before you pay. Charged by Link (Stripe).',
  legalTerms: 'Terms',      // → terms.html, new tab
  legalPrivacy: 'Privacy',  // → privacy.html, new tab
  seeIncluded: 'See what’s included ↓',
  restoreEntry: 'Already unlocked? Restore',
  questions: 'Questions? ',

  // restore row
  restoreLabel: 'Already unlocked? Enter your license key',                                    // key path only (EMAIL_RESTORE = false)
  restorePlaceholder: 'License key',
  restoreLabelEmail: 'Already unlocked? Enter your license key or the email you paid with',    // Step 5b, in use
  restorePlaceholderEmail: 'License key or email',
  restore: 'Restore',
  restoreBusy: 'Checking…',

  // return from Stripe
  pendingTitle: 'Payment received',
  verifying: 'Fetching your key…',
  retry: 'Try again',
  cancelled: 'Payment cancelled — nothing charged.',

  // thank-you (after a purchase) and Manage
  unlocked: 'Unlocked 🎉',
  boughtLine: 'All extras are yours: your own photos, any token goal, and every reward, token icon and background.',   // purchase view only
  styleBoard: 'Style your board →',                                                                                    // purchase view only: the one main action
  keyLabel: 'Your license key',
  show: 'Show',
  hide: 'Hide',
  copyKey: 'Copy key',
  copyLink: 'Copy link',
  copied: 'Copied ✓',
  copyFailed: 'Copy failed — select and copy by hand',
  restoreLink: 'Restore link (for other devices)',
  sentTo: 'We sent the key and this link to {email}.',
  help: 'Help: ',

  // one-line entries (panel line and the price card after unlock)
  lineUnlocked: '✓ Unlocked',
  manage: 'Manage',
  sep: ' · ',

  // dialog chrome
  close: 'Close',

  // errors (every one with the support address)
  errInvalid: 'That does not look like a license key (TB-XXXX-XXXX-XXXX). Keys never contain 0, O, 1 or I. Help: {support}',
  errNotFound: 'This key was not found. Just paid? Wait a minute and try again. Help: {support}',
  errVerifyNotFound: 'Just paid? Your key is not visible yet — wait a minute and try again. It is also in the email from Token Board. Help: {support}',
  errRevoked: 'This purchase was refunded. If that is wrong, write to {support}',
  errDisabled: 'Unlock is unavailable right now — the free token board keeps working. Help: {support}',
  errUnreachable: 'Could not reach the unlock service. Check your connection and try again. Help: {support}',
  errVerifyUnreachable: 'Payment received — this page could not fetch your key right now. Your key is in the email from Token Board. Try again in a minute, or write to {support}',
  errNotPaid: 'This payment has not completed. If you were charged, write to {support}',
  errRateLimited: 'Too many attempts — wait a minute and try again. Help: {support}',
  errOther: 'Something went wrong on our side. Try again in a minute, or write to {support}',

  // email path (POST /magic): the success text is the same for known and unknown addresses
  magicSent: 'If that email paid, a link is on its way — check your spam folder too. No email after 10 minutes? Write to {support}',
  errMagicRateLimited: 'Please wait a minute before requesting another email.',
  errNotEmailOrKey: 'That does not look like an email address or a license key.'
};

// README § 8.3: tool-test.html sets window.__tbUnlockApi in its inline head script (ring 1: "mock",
// ring 3: the test Worker URL — it stays the staging page); index.html never sets it and uses this
// constant ("mock" on the branch, the live API after the go-live patch). No trailing slash.
// Developer override (ring 2, Step 5b): localStorage "tb-api" = "mock" or an http(s) origin, read ONLY
// on localhost / 127.0.0.1 or when localStorage tb-dev === "1" — never on the live host without tb-dev.
export function resolveApi(base, host, get) {
  try {
    if (!(host === 'localhost' || host === '127.0.0.1' || get('tb-dev') === '1')) return base;
    let o = get('tb-api');
    if (!o) return base;
    o = String(o).trim().replace(/\/+$/, '');
    if (o !== 'mock' && !/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(o)) return base;
    try { console.info('[tb-unlock] API override: ' + o); } catch (e) {}
    return o;
  } catch (e) { return base; }
}
const UNLOCK_API = resolveApi(window.__tbUnlockApi || 'mock', location.hostname,
  (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } });

const LS_LICENSE = 'tb-license', LS_DEVICE = 'tb-device', LS_MOCK = 'tb-mock', LS_DEV = 'tb-dev';
const SS_FROM = 'tb-unlock-from', SS_TEST_RETURN = 'tb-test-return';   // sessionStorage, across the Stripe redirect only
const FROM_VALUES = ['panel', 'toolbar', 'celebration', 'card'];        // unlock-click {from}; anything else is sent as "unknown"
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
function ssTake(k) { let v = null; try { v = sessionStorage.getItem(k); sessionStorage.removeItem(k); } catch (e) {} return v; }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const KEY_RE = /^TB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/* ---------- key helpers (README § 7) ---------- */
export function normaliseKey(raw) {
  let s = String(raw || '').trim().toUpperCase();
  s = s.split('').filter((c) => ALPHABET.indexOf(c) >= 0 || c === '-').join('');
  s = s.replace(/-/g, '');
  if (s.length === 14 && s.slice(0, 2) === 'TB') s = 'TB-' + s.slice(2, 6) + '-' + s.slice(6, 10) + '-' + s.slice(10, 14);
  return s;
}
export function validKey(key) { return KEY_RE.test(key); }
function normaliseEmail(raw) { return String(raw || '').trim().toLowerCase(); }
function validEmail(e) { return e.length >= 3 && e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }   // "has @ and a dot after it"
export function maskKey(key) { return 'TB-••••-••••-' + key.slice(-4); }
function fill(text, vars) {   // {support} and {price} are filled by default
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : (k === 'support' ? STRINGS.support : (k === 'price' ? PRICE_LABEL : m))));
}
function restoreLinkFor(key) { return location.origin + location.pathname + '?k=' + key; }

/* ---------- mock mode (README § 9, literal) ---------- */
function pageBase() {   // current page URL without unlock / k / src, keeping test=1 etc.
  let p = null;
  try { p = new URLSearchParams(location.search); p.delete('unlock'); p.delete('k'); p.delete('src'); } catch (e) {}
  const q = p ? p.toString() : '';
  return location.origin + location.pathname + (q ? '?' + q + '&' : '?');
}
export function mockRoute(method, path, body, sc) {
  const err = (status, code) => ({ status, json: { error: code } });
  const DOWN = null;   // → the promise rejects
  if (path === '/checkout') {
    if (sc === 'cancel') return { status: 200, json: { url: pageBase() + 'unlock=cancel' } };
    if (sc === 'disabled') return err(503, 'disabled');
    if (sc === 'rate-limited') return err(429, 'rate-limited');
    if (sc === 'stripe-error') return err(502, 'stripe-error');
    if (sc === 'unreachable') return DOWN;
    if (sc === 'server-error') return err(500, 'server-error');
    return { status: 200, json: { url: pageBase() + 'unlock=cs_test_mock' } };
  }
  if (path === '/verify') {
    const s = body.session;
    if (s === 'cs_test_mock') return { status: 200, json: { key: 'TB-TEST-TEST-TEST', emailMasked: 't***@example.org' } };
    if (s === 'cs_test_notpaid') return err(402, 'not-paid');
    if (s === 'cs_test_nfnd') return err(404, 'not-found');
    if (s === 'cs_test_stripe') return err(502, 'stripe-error');
    if (s === 'cs_test_down') return DOWN;
    if (sc === 'stripe-error') return err(502, 'stripe-error');
    if (sc === 'unreachable') return DOWN;
    if (sc === 'server-error') return err(500, 'server-error');
    return err(404, 'not-found');
  }
  if (path === '/restore') {
    const k = body.key;
    if (k === 'TB-TEST-TEST-TEST') return { status: 200, json: { ok: true } };
    if (k === 'TB-TEST-TEST-NFND') return err(404, 'not-found');
    if (k === 'TB-TEST-TEST-RVKD') return err(403, 'revoked');
    if (k === 'TB-TEST-TEST-NVLD') return err(400, 'invalid');
    if (k === 'TB-TEST-TEST-UNRC') return DOWN;
    if (k === 'TB-TEST-TEST-SRVR') return err(500, 'server-error');
    if (sc === 'unreachable') return DOWN;
    if (sc === 'server-error') return err(500, 'server-error');
    return err(404, 'not-found');
  }
  if (path === '/magic') {
    const e = String(body.email || '').trim().toLowerCase();
    if (e === 'ratelimit@mock.test') return err(429, 'rate-limited');
    if (e === 'down@mock.test') return DOWN;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return err(400, 'bad-request');
    if (sc === 'rate-limited') return err(429, 'rate-limited');
    if (sc === 'unreachable') return DOWN;
    if (sc === 'server-error') return err(500, 'server-error');
    return { status: 200, json: { ok: true } };
  }
  if (path === '/health') return { status: 200, json: 'ok' };
  return err(404, 'unknown-route');
}
export const MOCK_DELAY_MS = 400, MOCK_SLOW_MS = 5000;
export function mockFetch(method, path, body, lsGet) {
  const sc = lsGet(LS_MOCK) || '';
  const delay = sc === 'slow' ? MOCK_SLOW_MS : MOCK_DELAY_MS;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const res = mockRoute(method, path, body, sc);
      try { console.info('[tb-mock] ' + method + ' ' + path, body, '→', res ? res.status : 'network failure', res ? res.json : 'TypeError'); } catch (e) {}
      if (res) resolve(res); else reject(new TypeError('mock: unreachable'));
    }, delay);
  });
}

/* ---------- init ---------- */
export default function init(api) {
  const { signal, el, button, lsGet, lsSet } = api;
  const S = STRINGS;
  const DIALOG_OK = typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';

  /* storage */
  function storedKey() { const k = lsGet(LS_LICENSE); return k && validKey(k) ? k : null; }
  function makeDeviceId() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    try {
      const b = new Uint8Array(16); crypto.getRandomValues(b);
      return Array.from(b, (x) => ('0' + x.toString(16)).slice(-2)).join('');
    } catch (e) { return 'd' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10); }
  }
  function deviceId() {
    let d = lsGet(LS_DEVICE);
    if (!d || !/^[A-Za-z0-9-]{8,64}$/.test(d)) { d = makeDeviceId(); lsSet(LS_DEVICE, d); }
    return d;
  }

  /* API call: mock or real; both resolve to { status, json } or reject like a failed fetch.
     A real call has a time limit (CALL_TIMEOUT_MS, README § 8.4.3): the request is aborted and the call rejects
     like a failed fetch, so every caller treats it as worker-unreachable. The limit also covers reading the
     answer. Mock mode has no limit. */
  async function call(method, path, body) {
    if (UNLOCK_API === 'mock') return mockFetch(method, path, body, lsGet);
    let url = UNLOCK_API + path;
    const opts = { method, mode: 'cors', credentials: 'omit' };
    if (method === 'GET') url += '?' + new URLSearchParams(body).toString();
    else { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    if (ac) opts.signal = ac.signal;
    let timer = null;
    const limit = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (ac) { try { ac.abort(); } catch (e) {} }
        reject(new TypeError('timeout'));
      }, CALL_TIMEOUT_MS);
    });
    const answer = (async () => {
      const r = await fetch(url, opts);
      let json = null;
      try { json = await r.json(); } catch (e) {}
      return { status: r.status, json };
    })();
    try { return await Promise.race([answer, limit]); }
    finally { clearTimeout(timer); }
  }
  function codeOf(r) { return (r && r.json && typeof r.json.error === 'string') ? r.json.error : 'other'; }
  function failReason(code) {   // unlock-fail {reason} buckets (README § 8.4.5)
    return ['invalid', 'not-found', 'revoked', 'disabled', 'worker-unreachable'].indexOf(code) >= 0 ? code : 'other';
  }
  function errText(code, ctx) {
    switch (code) {
      case 'invalid': return fill(S.errInvalid);
      case 'not-found': return fill(ctx === 'verify' ? S.errVerifyNotFound : S.errNotFound);
      case 'revoked': return fill(S.errRevoked);
      case 'disabled': return fill(S.errDisabled);
      case 'worker-unreachable': return fill(ctx === 'verify' ? S.errVerifyUnreachable : S.errUnreachable);
      case 'not-paid': return fill(S.errNotPaid);
      case 'rate-limited': return fill(S.errRateLimited);
      default: return fill(S.errOther);
    }
  }

  /* ---------- state ---------- */
  const state = {
    key: storedKey(),
    emailMasked: '',      // only right after a purchase on this page load
    revealed: false,      // Show pressed; reset when the dialog or the panel closes
    pendingSession: null, // ?unlock=<session> kept for Retry (→ the "Payment received" view)
    busy: false,
    openedFrom: 'unknown', // opener of the dialog → unlock-click {from} for the dialog's own button
    returnFrom: 'unknown', // Stripe return only: the from of the Unlock press before the redirect (handleUrl)
    justBought: false,    // thank-you after a real purchase (verify → unlockedNow 'checkout'); cleared when the dialog closes
    preview: null,        // dev hook only (?dev-thanks=1): example key shown in the dialog, never stored
    restoreOpen: false,   // dialog offer view: restore field expanded (restore mode, or the link was pressed)
    msgs: { main: null, restore: null }   // last message per slot, re-applied after every render
  };
  // views: { host, variant }  line = the panel entry · card = the price card (touched only once unlocked) ·
  // dialog = the modal · panel = fallback card in the panel for browsers without showModal
  const views = [];

  /* ---------- DOM helpers ---------- */
  function legalLink(href, text) { const a = el('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; return a; }
  function p(cls, text) { const n = el('p', cls); if (text) n.textContent = text; return n; }
  function mailLink() { const a = el('a'); a.href = 'mailto:' + S.support; a.textContent = S.support; return a; }
  function lineWithMail(cls, prefix) { const n = p(cls); n.appendChild(document.createTextNode(prefix)); n.appendChild(mailLink()); return n; }
  function textWithMail(text) {   // "… Help: support@…" → the address becomes a link
    const n = p('');
    const i = text.indexOf(S.support);
    if (i < 0) { n.textContent = text; return n; }
    n.appendChild(document.createTextNode(text.slice(0, i)));
    n.appendChild(mailLink());
    n.appendChild(document.createTextNode(text.slice(i + S.support.length)));
    return n;
  }
  function smallBtn(label) {   // text-like button (Show, Manage, Try again, the two links of the offer)
    const b = button('tbu-sm', '', '');
    b.textContent = label;
    return b;
  }
  function ghost(label) {   // secondary pill (navy text, 1 px navy border, white)
    const b = button('tbu-ghost', '', '');
    b.textContent = label;
    return b;
  }
  // the Unlock button's label: two lines (bold value line + smaller price line), or the busy text
  function setPrimaryLabel(b, busy) {
    b.innerHTML = '';
    if (busy) { b.appendChild(el('span', 'tbu-u1')).textContent = S.unlockBusy; return; }
    b.appendChild(el('span', 'tbu-u1')).textContent = S.unlockLine1;
    b.appendChild(el('span', 'tbu-u2')).textContent = fill(S.unlockLine2);
  }
  function primary(from) {   // the Unlock button: /checkout → Stripe, label swaps while busy
    const b = button('tbu-btn', '', '');
    b.setAttribute('data-tbu-primary', '');
    setPrimaryLabel(b, state.busy);
    b.addEventListener('click', () => checkout(from));
    return b;
  }
  const ICONS = {   // 14 px inline icons for the trust line (stroke = currentColor)
    check: '<path d="M3 8.5l3 3 7-7"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    bolt: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>'
  };
  function trustLine() {   // "✓ One-time payment  ✓ no subscription  🔒 secure checkout …  ⚡ unlocks instantly …"
    const n = el('p', 'tbu-trust');
    S.trust.forEach((t) => {
      const it = el('span', 'tbu-trust-item');
      it.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[t[0]] + '</svg>';
      it.appendChild(document.createTextNode(t[1]));
      n.appendChild(it);
    });
    return n;
  }
  function focusNoScroll(n) { try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (x) {} } }
  function copyText(text, btn) {
    const done = (ok) => {
      const old = btn.textContent;
      btn.textContent = ok ? S.copied : S.copyFailed;
      btn.setAttribute('aria-live', 'polite');
      setTimeout(() => { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => fallback());
    } else fallback();
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        (dlg && dlg.open ? dlg : document.body).appendChild(ta); ta.select();   // inside an open modal dialog the rest of the page is inert
        const ok = document.execCommand('copy');
        ta.remove();
        done(ok);
      } catch (e) { done(false); }
    }
  }

  /* ---------- the dialog (native <dialog>, top layer; built on first open) ---------- */
  let dlg = null, dlgBody = null, opener = null;
  function buildDialog() {
    dlg = document.createElement('dialog');
    dlg.className = 'tbu-dialog' + (api.reducedMotion ? ' tbu-reduced' : '');
    dlg.setAttribute('aria-labelledby', 'tbu-dlg-title');
    const box = el('div', 'tbu-dialog-box');
    const x = button('tbu-dialog-x', S.close, '×');
    x.addEventListener('click', () => closeDialog());
    dlgBody = el('div', 'tbu-dialog-body');
    box.appendChild(x); box.appendChild(dlgBody);
    dlg.appendChild(box);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });   // backdrop tap
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });   // native cancel closes it; the stage's own Escape handler must not fire
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
    dlg.addEventListener('close', onDialogClosed);
    views.push({ host: dlgBody, variant: 'dialog' });
  }
  // Where the dialog lives: document.body; while the stage is in native fullscreen, inside the stage (the
  // fullscreen element), so it is shown in every browser (README § 8.4.3). Decided at each open.
  function attachDialog() {
    let host = null;
    try { host = api.fullscreenHost ? api.fullscreenHost() : null; } catch (e) {}
    if (!host) host = document.body;
    if (dlg.parentNode !== host) host.appendChild(dlg);
  }
  // the visitor opens the dialog (an entry point, a Restore button, Manage): dialog-open {from: how}, then the dialog.
  // Everything that opens it without a tap (Stripe return, ?k= result, checkout error, dev hook) calls openDialog directly.
  function userOpen(how, from, focusRestore, back) {
    signal('dialog-open', { from: how });
    openDialog(from, focusRestore, false, back);
  }
  // from: 'panel' | 'toolbar' | 'celebration' | 'card' | 'unknown' (→ unlock-click {from} of the dialog's button);
  // focusRestore: put the caret in the key field; back: the element that gets the focus when the dialog closes
  function openDialog(from, focusRestore, expandRestore, back) {
    state.openedFrom = from || 'unknown';
    if (focusRestore || expandRestore) state.restoreOpen = true;   // restore mode: the field is shown expanded
    if (!DIALOG_OK) { openFallbackCard(focusRestore); return; }
    if (!dlg) buildDialog();
    renderInto(dlgBody, 'dialog');
    if (!dlg.open) {
      opener = back || document.activeElement;
      attachDialog();
      lockScroll();
      try { dlg.showModal(); } catch (e) { try { dlg.setAttribute('open', ''); } catch (x) {} }
    }
    const box = dlg.firstChild; box.tabIndex = -1;
    const input = focusRestore ? dlgBody.querySelector('input') : null;
    focusNoScroll(input || box);
    if (!input) dlg.scrollTop = 0;
  }
  // Scroll lock without a sideways jump (README § 8.4.3): html.tbu-dialog-open hides the page scrollbar, so its
  // width — measured just before the lock — becomes padding-right on <html>; header and page keep their place.
  // Width 0 (overlay scrollbars, the expanded mode with the body already locked, native fullscreen) → no padding.
  function lockScroll() {
    try {
      const root = document.documentElement;
      const cw = root.clientWidth;
      const sw = cw > 0 ? Math.round(window.innerWidth - cw) : 0;
      root.classList.add('tbu-dialog-open');
      if (sw > 0) root.style.paddingRight = sw + 'px';
    } catch (e) {}
  }
  function unlockScroll() {
    try {
      const root = document.documentElement;
      root.classList.remove('tbu-dialog-open');
      root.style.paddingRight = '';
    } catch (e) {}
  }
  function closeDialog() { if (dlg && dlg.open) { try { dlg.close(); } catch (e) { onDialogClosed(); } } }
  function onDialogClosed() {
    unlockScroll();
    state.restoreOpen = false;   // the next open shows the collapsed "Already unlocked? Restore" link
    const wasThanks = state.justBought || !!state.preview;
    state.justBought = false; state.preview = null;   // the next open (Manage) is the plain view
    if (state.revealed || wasThanks) { state.revealed = false; render(); }
    const o = opener; opener = null;
    if (o && o.isConnected && typeof o.focus === 'function') focusNoScroll(o);
  }
  // "Style your board →": close the dialog without giving focus back to its opener, then the panel at its top
  // with focus on its first control (api.showStyle, tool.js)
  function styleBoard() {
    opener = null;
    state.justBought = false;
    if (dlg && dlg.open) closeDialog(); else render();   // fallback card: back to the plain unlocked view
    if (api.showStyle) api.showStyle();
  }
  // confetti (purchase only, once per page load): canvas inside the <dialog> — fixed, full viewport, above the backdrop,
  // below .tbu-dialog-box (z-index 1; the white background lives on the box); pointer-events none, aria-hidden, never
  // focusable, so focus and the dialog's focus trap are untouched. Removed when the last piece has fallen.
  let confettiDone = false;
  function confetti() {
    if (confettiDone || !dlg || !dlg.open) return;
    confettiDone = true;
    try { if (api.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    let cv = null, ctx = null;
    try { cv = document.createElement('canvas'); ctx = cv.getContext && cv.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return;
    cv.className = 'tbu-confetti'; cv.setAttribute('aria-hidden', 'true');
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none';
    ctx.scale(dpr, dpr);
    dlg.insertBefore(cv, dlg.firstChild);
    const COLS = ['#4DA3FF', '#7ED957', '#FFC443', '#FF7BAC', '#FFFFFF'], R = Math.random, bits = [];
    for (let i = 0; i < 100; i++) bits.push({
      x: W * (.15 + R() * .7), y: H * (.25 + R() * .15), vx: (R() - .5) * 9, vy: -(5 + R() * 8),
      w: 6 + R() * 5, h: 4 + R() * 4, a: R() * 6.3, va: (R() - .5) * .35, c: COLS[i % 5], f: R() * 6.3
    });
    let t0 = 0;
    (function frame(t) {
      if (!t0) t0 = t;
      const k = t - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = k > 1300 ? Math.max(0, 1 - (k - 1300) / 500) : 1;   // fade out over the last 0.5 s → gone at 1.8 s
      bits.forEach((b) => {
        b.vy += .28; b.vx *= .985; b.f += .1;
        b.x += b.vx + Math.sin(b.f) * .6; b.y += b.vy; b.a += b.va;   // gravity + drift + spin
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
        ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.f)) + 1);
        ctx.restore();
      });
      if (k < 1800 && cv.isConnected) requestAnimationFrame(frame); else cv.remove();
    })(0);
  }
  // browsers without showModal: the same content as a card at the top of the panel body (api.mount().card)
  function openFallbackCard(focusRestore) {
    const v = views.find((x) => x.variant === 'panel');
    if (!v) return;
    renderInto(v.host, 'panel');
    api.openPanel();
    v.host.hidden = false;
    try { v.host.parentNode.scrollTop = 0; } catch (e) {}
    if (focusRestore) { const i = v.host.querySelector('input'); if (i) focusNoScroll(i); }
  }

  /* ---------- rendering ---------- */
  function render() {
    views.forEach((v) => {
      if (v.variant === 'line') renderLine(v.host);
      else if (v.variant === 'card') renderCard(v.host);
      else renderInto(v.host, v.variant);
    });
  }
  function renderInto(host, variant) {   // dialog body or the fallback card
    host.innerHTML = '';
    const unlockedView = !!state.key || (!!state.preview && variant === 'dialog');   // preview = dev hook, dialog only
    host.classList.toggle('is-unlocked', unlockedView);
    if (unlockedView) renderUnlocked(host, variant);
    else if (state.pendingSession) renderPending(host, variant);
    else renderOffer(host, variant);
    applyMsgs(host);
  }
  function title(variant, text) {   // a real heading; in the dialog it labels the dialog
    const n = el('h2', 'tbu-title');
    if (variant === 'dialog') n.id = 'tbu-dlg-title';
    n.textContent = text;
    return n;
  }
  // the offer: title, offer line, preview row, the button, trust line, small print, "See what's included ↓",
  // status slot, restore (collapsed link in the dialog unless restore mode), Questions
  function renderOffer(host, variant) {
    host.appendChild(title(variant, S.offerTitle));
    host.appendChild(p('tbu-lead', S.offerLine));
    const row = p('tbu-preview');
    row.setAttribute('role', 'img'); row.setAttribute('aria-label', S.previewLabel);
    S.preview.forEach((e) => { const s = el('span', ''); s.setAttribute('aria-hidden', 'true'); s.textContent = e; row.appendChild(s); });
    host.appendChild(row);
    host.appendChild(primary(state.openedFrom));
    host.appendChild(trustLine());
    const fine = p('tbu-fine', fill(S.offerFine));
    fine.append(' ', legalLink('terms.html', S.legalTerms), ' · ', legalLink('privacy.html', S.legalPrivacy));
    host.appendChild(fine);
    const pricing = document.getElementById('pricing');
    if (variant === 'dialog' && pricing && !pricing.hidden && !(api.isFullscreen && api.isFullscreen())) {   // not in fullscreen / expanded mode, not on a page without #pricing
      const see = p('tbu-see');
      const b = smallBtn(S.seeIncluded);
      b.addEventListener('click', () => {
        opener = null;   // the page scrolls to the pricing section: no focus jump back up
        closeDialog();
        try { pricing.scrollIntoView({ behavior: api.reducedMotion ? 'auto' : 'smooth', block: 'start' }); } catch (e) { try { pricing.scrollIntoView(); } catch (x) {} }
      });
      see.appendChild(b);
      host.appendChild(see);
    }
    host.appendChild(msgLine('main'));
    if (variant === 'dialog' && !state.restoreOpen && !state.msgs.restore) renderRestoreToggle(host);
    else renderRestore(host, variant);
    host.appendChild(lineWithMail('tbu-quiet', S.questions));
  }
  // collapsed restore: one text link; pressing it expands the field + Restore in place and focuses the field
  function renderRestoreToggle(host) {
    const n = p('tbu-restore-toggle');
    const b = smallBtn(S.restoreEntry);
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      state.restoreOpen = true;
      renderInto(host, 'dialog');
      const i = host.querySelector('input');
      if (i) focusNoScroll(i);
    });
    n.appendChild(b);
    host.appendChild(n);
  }
  function renderPending(host, variant) {   // back from Stripe: /verify running or failed (Try again), key field for the email
    host.appendChild(title(variant, S.pendingTitle));
    host.appendChild(msgLine('main'));
    renderRestore(host, variant);
  }
  function renderRestore(host, variant) {
    const box = el('div', 'tbu-restore');
    const id = 'tbu-restore-' + variant;
    const lab = el('label', ''); lab.setAttribute('for', id); lab.textContent = EMAIL_RESTORE ? S.restoreLabelEmail : S.restoreLabel;
    box.appendChild(lab);
    const row = el('div', 'tbu-row');
    const input = document.createElement('input');
    input.type = 'text'; input.id = id; input.className = 'tbu-input';
    // an email address or a key: the keyboard must not capitalise or "correct" it (README § 8.4.3)
    input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off'); input.setAttribute('spellcheck', 'false');
    input.placeholder = EMAIL_RESTORE ? S.restorePlaceholderEmail : S.restorePlaceholder;
    const b = ghost(S.restore);
    const go = () => restoreFromInput(input);
    b.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    row.appendChild(input); row.appendChild(b);
    box.appendChild(row);
    box.appendChild(msgLine('restore'));
    host.appendChild(box);
  }
  function keyCode() {
    const key = state.preview || state.key;
    const code = el('code', 'tbu-key');
    code.textContent = state.revealed ? key : maskKey(key);
    code.setAttribute('aria-label', state.revealed ? 'License key ' + key.split('').join(' ') : 'License key, hidden, ends with ' + key.slice(-4).split('').join(' '));
    return code;
  }
  function wireShow(b) {
    b.setAttribute('aria-pressed', state.revealed ? 'true' : 'false');
    b.addEventListener('click', () => { state.revealed = !state.revealed; render(); });
    return b;
  }
  function renderUnlocked(host, variant) {   // thank-you (after a purchase: purchase line, "Style your board →", "sent to") and Manage
    const key = state.preview || state.key;
    const action = (label, aria, fn) => { const b = ghost(label); b.setAttribute('aria-label', aria); b.addEventListener('click', fn); return b; };
    host.appendChild(title(variant, S.unlocked));
    if (state.justBought || state.preview) {
      host.appendChild(p('tbu-lead', S.boughtLine));
      const go = button('tbu-btn tbu-style', '', '');   // not data-tbu-primary (that label is the Unlock text)
      go.textContent = S.styleBoard;
      go.addEventListener('click', styleBoard);
      host.appendChild(go);
    }

    const box = el('div', 'tbu-keybox');            // the key, masked by default, centred and large
    box.setAttribute('aria-label', S.keyLabel);
    box.appendChild(p('tbu-label', S.keyLabel));
    box.appendChild(keyCode());
    host.appendChild(box);
    const row = el('div', 'tbu-btnrow');
    row.appendChild(wireShow(ghost(state.revealed ? S.hide : S.show)));
    row.appendChild(action(S.copyKey, 'Copy the license key', (e) => copyText(key, e.currentTarget)));   // copies without revealing
    host.appendChild(row);

    const linkBlock = el('div', 'tbu-linkrow');
    linkBlock.appendChild(p('tbu-label', S.restoreLink));
    const url = p('tbu-url');
    if (state.revealed) {   // the link carries the key: shown only while the key is shown (R29); Copy works either way
      const a = el('a', 'tbu-link');
      a.href = restoreLinkFor(key); a.textContent = restoreLinkFor(key);
      url.appendChild(a);
    } else url.textContent = restoreLinkFor(maskKey(key));
    linkBlock.appendChild(url);
    linkBlock.appendChild(action(S.copyLink, 'Copy the restore link', (e) => copyText(restoreLinkFor(key), e.currentTarget)));
    host.appendChild(linkBlock);

    const sent = state.preview ? 't***@example.org' : state.emailMasked;   // dev hook: example address, never stored
    if (sent) host.appendChild(p('tbu-sent', fill(S.sentTo, { email: sent })));
    host.appendChild(lineWithMail('tbu-quiet', S.help));
    host.appendChild(msgLine('main'));
  }
  function unlockedLine(variant) {   // "✓ Unlocked · TB-••••-••••-1234 · Show · Manage" (panel) / "✓ Unlocked · Manage" (price card)
    const line = p('tbu-status');
    line.appendChild(document.createTextNode(S.lineUnlocked + S.sep));
    if (variant === 'line') {
      line.appendChild(keyCode());
      line.appendChild(document.createTextNode(S.sep));
      line.appendChild(wireShow(smallBtn(state.revealed ? S.hide : S.show)));
      line.appendChild(document.createTextNode(S.sep));
    }
    const m = smallBtn(S.manage);
    m.addEventListener('click', () => userOpen('manage', variant === 'card' ? 'card' : 'panel', false, m.isConnected ? m : null));
    line.appendChild(m);
    return line;
  }
  // the panel entry (#tbu-line): hidden while locked; unlocked → the status line
  function renderLine(host) {
    host.innerHTML = '';
    host.hidden = !state.key;
    if (state.key) host.appendChild(unlockedLine('line'));
  }
  // the price card in the pricing section: untouched until unlocked (its markup carries the offer), then its actions
  // block (button, trust line, Restore button, small print) becomes "✓ Unlocked · Manage"
  function renderCard(host) {
    if (!state.key) return;
    const target = host.querySelector('[data-tbu-actions]') || host;
    target.innerHTML = '';
    target.appendChild(unlockedLine('card'));
  }
  function msgLine(slot) {
    const n = el('p', 'tbu-msg');
    n.setAttribute('data-slot', slot); n.setAttribute('role', 'status'); n.hidden = true;
    return n;
  }
  function applyMsg(host, slot) {
    const n = host.querySelector('[data-slot="' + slot + '"]');
    if (!n) return;
    const m = state.msgs[slot];
    n.innerHTML = '';
    n.className = 'tbu-msg' + (m && m.kind ? ' is-' + m.kind : '');
    if (!m || !m.text) { n.hidden = true; return; }
    const line = textWithMail(m.text);
    while (line.firstChild) n.appendChild(line.firstChild);
    if (m.retry) {
      n.appendChild(document.createTextNode(' '));
      const r = smallBtn(S.retry);
      r.addEventListener('click', m.retry);
      n.appendChild(r);
    }
    n.hidden = false;
  }
  function applyMsgs(host) { applyMsg(host, 'main'); applyMsg(host, 'restore'); }
  // message in one slot (kept in state, so it survives re-renders and a reopened dialog)
  function setMsg(slot, text, kind, retryFn) {
    state.msgs[slot] = text ? { text, kind: kind || '', retry: retryFn || null } : null;
    views.forEach((v) => { if (v.variant === 'dialog' || v.variant === 'panel') applyMsg(v.host, slot); });
  }
  function setBusy(on, label) {
    state.busy = on;
    views.forEach((v) => {
      v.host.querySelectorAll('button').forEach((b) => {
        b.disabled = on;
        if (b.hasAttribute('data-tbu-primary')) setPrimaryLabel(b, on);
      });
      v.host.querySelectorAll('input').forEach((i) => { i.disabled = on; });
    });
    if (label) setMsg('main', label, 'busy');
  }

  /* ---------- actions ---------- */
  function unlockedNow(key, via, emailMasked) {
    state.key = key; state.emailMasked = emailMasked || ''; state.revealed = false;
    state.pendingSession = null; state.preview = null;
    state.justBought = via === 'checkout';   // the purchase view (purchase line, Style your board, confetti) — never for restores
    state.msgs = { main: null, restore: null };
    lsSet(LS_LICENSE, key);
    signal('unlock-success', via === 'checkout' ? { via, from: state.returnFrom } : { via });
    api.setUnlocked();
    render();
    if (dlg && dlg.open) dlg.scrollTop = 0;
    if (state.justBought) confetti();
  }

  // from: 'card' (price card button), or the dialog opener (panel | toolbar | celebration | card)
  async function checkout(from) {
    if (state.busy) return;
    if (FROM_VALUES.indexOf(from) < 0) from = 'unknown';   // same rule as unlock-cancel / unlock-success
    signal('unlock-click', { from });
    setBusy(true, null);
    try {
      const r = await call('POST', '/checkout', {});
      if (r.status === 200 && r.json && typeof r.json.url === 'string') {
        ssSet(SS_FROM, from);                                  // → unlock-cancel / unlock-success {from} after the return
        if (api.isTestMode && api.isTestMode()) ssSet(SS_TEST_RETURN, '1');   // the return page load stays in test mode
        api.pauseForRedirect();   // leave native fullscreen and the expanded mode (R30)
        location.assign(r.json.url);
        return;
      }
      fail(codeOf(r), from);
    } catch (e) {
      fail('worker-unreachable', from);
    }
    function fail(code, from) {   // errors are shown in the dialog, whichever button was pressed
      signal('unlock-fail', { reason: failReason(code) });
      setBusy(false);
      setMsg('main', errText(code, 'checkout'), 'error');
      openDialog(from);
    }
  }

  async function verify(session) {
    if (state.pendingSession !== session) { state.pendingSession = session; render(); }
    setBusy(true, S.verifying);
    try {
      const r = await call('GET', '/verify', { session, device: deviceId() });
      if (r.status === 200 && r.json && typeof r.json.key === 'string') {
        const key = normaliseKey(r.json.key);
        if (!validKey(key)) throw { code: 'other' };
        setBusy(false);
        unlockedNow(key, 'checkout', typeof r.json.emailMasked === 'string' ? r.json.emailMasked : '');
        return;
      }
      throw { code: codeOf(r) };
    } catch (e) {
      const code = e && e.code ? e.code : 'worker-unreachable';
      signal('unlock-fail', { reason: failReason(code) });
      setBusy(false);
      const retry = (code === 'not-paid' || code === 'revoked') ? null : () => verify(session);
      if (!retry) { state.pendingSession = null; render(); }   // final answer: back to the offer view, message kept
      setMsg('main', errText(code, 'verify'), 'error', retry);
    }
  }

  async function restore(raw, via, slot) {
    if (state.busy) return;
    const key = normaliseKey(raw);
    if (!validKey(key)) { signal('unlock-fail', { reason: 'invalid' }); setMsg(slot, errText('invalid'), 'error'); return; }
    signal('unlock-restore-attempt', { via });
    setBusy(true, null); setMsg(slot, S.restoreBusy, 'busy');
    try {
      const r = await call('POST', '/restore', { key, device: deviceId() });
      if (r.status === 200 && r.json && r.json.ok === true) {
        setBusy(false);
        unlockedNow(key, via, '');
        return;
      }
      throw { code: codeOf(r) };
    } catch (e) {
      const code = e && e.code ? e.code : 'worker-unreachable';
      signal('unlock-fail', { reason: failReason(code) });
      setBusy(false); setMsg(slot, errText(code, 'restore'), 'error');
    }
  }
  function restoreFromInput(input) {
    const v = (input.value || '').trim();
    if (!v) { focusNoScroll(input); return; }
    if (v.indexOf('@') >= 0) {
      if (EMAIL_RESTORE) { magic(v); return; }   // email path (POST /magic)
      signal('unlock-fail', { reason: 'invalid' });   // switch off: no email path — the invalid-key text, no request
      setMsg('restore', errText('invalid'), 'error');
      return;
    }
    restore(v, 'key', 'restore');
  }
  // restore by email: never reveals whether the address exists (constant answer, README § 2.7). The address goes
  // only into the request body — never into storage, a log line of this file or a signal (R31).
  async function magic(raw) {
    if (state.busy) return;
    const email = normaliseEmail(raw);
    if (!validEmail(email)) { signal('unlock-fail', { reason: 'invalid' }); setMsg('restore', S.errNotEmailOrKey, 'error'); return; }
    signal('unlock-restore-attempt', { via: 'email' });   // "mail" = arriving through the mailed link (?k=…&src=mail)
    setBusy(true, null); setMsg('restore', S.restoreBusy, 'busy');
    try {
      const r = await call('POST', '/magic', { email });
      setBusy(false);
      if (r.status === 200 && r.json && r.json.ok === true) { setMsg('restore', fill(S.magicSent), 'success'); return; }
      const code = codeOf(r);
      signal('unlock-fail', { reason: failReason(code === 'bad-request' ? 'invalid' : code) });
      setMsg('restore', code === 'rate-limited' ? S.errMagicRateLimited : code === 'bad-request' ? S.errNotEmailOrKey : fill(S.errOther), 'error');
    } catch (e) {
      signal('unlock-fail', { reason: 'worker-unreachable' });
      setBusy(false); setMsg('restore', errText('worker-unreachable', 'restore'), 'error');
    }
  }

  /* ---------- URL params (window.__tbUnlock, README § 8.1): a purchase beats a bookmark ---------- */
  function handleUrl() {
    devThanks();
    const u = window.__tbUnlock;
    if (!u) return;
    window.__tbUnlock = undefined;   // handled once (Safari bfcache may bring the page back)
    if (u.session || u.cancel) {     // Stripe return: which Unlock button started it (read once, deleted; else "unknown")
      const f = ssTake(SS_FROM);
      state.returnFrom = FROM_VALUES.indexOf(f) >= 0 ? f : 'unknown';
    }
    if (u.session) { state.pendingSession = u.session; openDialog(state.returnFrom); verify(u.session); return; }
    if (u.cancel) { signal('unlock-cancel', { from: state.returnFrom }); setMsg('main', S.cancelled, 'info'); openDialog(state.returnFrom); return; }
    if (u.k) {
      const key = normaliseKey(u.k);
      if (state.key && state.key === key) return;   // same key already stored: nothing to do (R25)
      const via = u.src === 'mail' ? 'mail' : 'url';
      openDialog('unknown', false, true);   // restore mode: field expanded (not focused)
      restore(u.k, via, 'main');
    }
  }
  // dev hook (screenshots): a gated page (body[data-tbu-gate]) + tb-dev = "1" + ?dev-thanks=1 → the purchase
  // thank-you with an example key and the confetti. Nothing stored, no request, no signal; the param is removed.
  function devThanks() {
    try {
      if (!(document.body && document.body.hasAttribute('data-tbu-gate') && lsGet(LS_DEV) === '1')) return;
      const q = new URLSearchParams(location.search);
      if (q.get('dev-thanks') !== '1') return;
      q.delete('dev-thanks');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      state.preview = 'TB-TEST-TEST-TEST';
      openDialog('unknown');
      confettiDone = false;
      confetti();
    } catch (e) {}
  }
  // Safari back button from Stripe restores the page from the bfcache with the busy state of the click
  window.addEventListener('pageshow', (e) => { if (e.persisted && state.busy) { setBusy(false); setMsg('main', ''); } });

  /* ---------- mount ---------- */
  const slots = api.mount() || {};
  if (slots.line) views.push({ host: slots.line, variant: 'line' });
  if (!DIALOG_OK && slots.card) { views.push({ host: slots.card, variant: 'panel' }); slots.card.hidden = true; }
  const below = document.getElementById('pro-card');
  if (below && below.hasAttribute('data-tbu-card')) views.push({ host: below, variant: 'card' });
  render();
  handleUrl();

  return {
    show(from, back) { userOpen(from, from, false, back); },   // an entry point in tool.js (panel | toolbar | celebration)
    panelClosed() {   // Show lasts until the panel (or the dialog) closes; the fallback card closes with the panel
      const v = !DIALOG_OK ? views.find((x) => x.variant === 'panel') : null;
      if (v) { v.host.hidden = true; state.restoreOpen = false; state.justBought = false; }
      if (state.revealed || v) { state.revealed = false; render(); }
    },
    cardAction(target) {   // Unlock / Restore on the price card
      if (!target || state.key) return;   // unlocked: the card shows "✓ Unlocked · Manage" instead of these buttons
      if (target.hasAttribute('data-tbu-unlock')) checkout('card');
      else if (target.hasAttribute('data-tbu-restore')) userOpen('restore', 'card', true, target);
    },
    isUnlocked() { return !!state.key; }
  };
}
