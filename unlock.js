/*
  Keep Quiet – browser unlock (one-time payment, Stripe Checkout via the Worker in worker/).
  Loaded lazily by noise-meter.js: import('./unlock.js?v=…') when the settings panel opens,
  when the page carries ?unlock= / ?k= (window.__kqUnlock, set by the inline head script),
  when a key is already stored, or on the first interaction with the card below the fold.
  Default export: init(api) → the UI controller. `api` is window.__kqTool from noise-meter.js
  (signal, el, button, storage with in-memory fallback, panel hooks).

  UI (decided 2026-11-02, revised the same day):
  - Panel, locked: primary button, two lines "Unlock all characters + backgrounds" (short panel line 1) / "$19.99
    one-time" (--nm-unlock deep-blue pill with a white stroke, line 1 = the short panel string, full width; conversion round 2026-11-03) → /checkout → Stripe
    directly; under it the caption "No subscription · instant access · web version" and the link
    "Already unlocked? Restore" (opens the dialog with the restore field focused). A compact sticky
    copy of the button sits at the bottom of the panel while the main one is scrolled out of view
    (IntersectionObserver; hidden when unlocked and in the free window; from:"panel"). Unlocked: "✓ Unlocked · KQ-••••-••••-1234 Show · Manage",
    small and muted at the bottom of the panel, after Sensitivity (api.placeLine).
    Free window: the free-until line + Restore link.
  - Pricing section (index.html #pricing; #pro-card = its price card): the same button and a ghost
    "Already unlocked? Restore"; after unlock the card's actions block shows "✓ Unlocked · Manage".
    The offer dialog links to it ("See what's included ↓") unless the stage is fullscreen / expanded
    or the page has no #pricing (tool-test.html).
  - Dialog (native <dialog>, showModal, top layer — above the phone sheet and the expanded stage):
    a locked thumb → the offer (title, benefit line, thumb strip, the button, trust line, small print,
    "See what's included ↓", the collapsed "Already unlocked? Restore" link — it expands the field —,
    Questions); restore mode (panel link, ?k= results) opens the field expanded;
    after a purchase or a restore → the short thank-you (key masked + Show/Copy, restore link + Copy,
    "sent to …" after a purchase, Help); every error and the cancel text are shown in the dialog.
    Browsers without showModal get the same content as a card inside the panel (api.mount().card).

  Restore row: input with "@" → POST /magic (email path, Step 5b), otherwise POST /restore.
  Contract: worker/README.md § 2 (endpoints, error codes), § 7 (key format), § 8 (browser side),
  § 9 (mock mode — implemented literally below). UI states: UNLOCK-PLAN.md § 3.4 / § 3.4a.
  Signals (§ 3.5): unlock-click {from: panel|card|thumb — where the pressed Unlock button sits, or
  the opener of the dialog it sits in}, unlock-success {via}, unlock-cancel, unlock-fail {reason},
  unlock-restore-attempt {via}. Never the key, the email, the device id or the session id.

  Every user-facing string lives in STRINGS (Step 6 edits only this object + the static card in
  index.html #pro-card, which repeats the offer for readers without JavaScript). The facts "not
  the iOS app" and "charged by Link (Stripe)" live in the FAQ, the Terms and the key email.
  The price appears only as PRICE_LABEL ({price} in STRINGS); the static card and the FAQ mirror
  it by hand (Step 6) — all of them = the amount of the Stripe Price (UNLOCK-PLAN § 5.3).
*/

const PRICE_LABEL = '$19.99';

const STRINGS = {
  support: 'AppsForParents@gmail.com',

  // offer (state A): panel button + caption, the locked-thumb dialog (conversion round 2026-11-03)
  offerTitle: 'Unlock all 8 characters and 5 backgrounds',
  offerBenefit: 'A new friend for every day — every character reacts to the noise level.',
  offerStrip: 'All 8 characters and 5 backgrounds',   // aria-label of the dialog's thumb strip
  offerFine: 'Web version — the iOS app is sold separately. {price} plus tax where applicable; the exact total is shown before you pay.',
  unlockLine1: 'Unlock all 8 characters + 5 backgrounds',   // the Unlock button, line 1 (bold) …
  unlockLine1Panel: 'Unlock all characters + backgrounds',   // … line 1 in the panel + sticky copy only (the full one wraps at the panel width)
  unlockLine2: '{price} one-time',                          // … line 2 (smaller); index.html #pro-card mirrors both
  unlockBusy: 'Opening the payment page…',
  // trust line under the button (dialog; #pro-card mirrors it in index.html): [icon, text]
  trust: [['check', 'One-time payment'], ['check', 'no subscription'], ['lock', 'secure checkout by Link (Stripe)'], ['bolt', 'unlocks instantly, key also emailed']],
  caption: 'No subscription · instant access · web version',
  restoreEntry: 'Already unlocked? Restore',
  seeIncluded: 'See what’s included ↓',
  questions: 'Questions? ',

  // restore row (dialog)
  restoreLabel: 'Already unlocked? Enter your license key or the email you paid with',
  restorePlaceholder: 'License key or email',
  restore: 'Restore',
  restoreBusy: 'Checking…',

  // free-for-everyone window (state F, FREE_UNTIL in noise-meter.js)
  freeUntil: 'All characters and backgrounds are free until {date}.',

  // thank-you (state B) and the permanent block (state C)
  unlocked: 'Unlocked 🎉',
  keyLabel: 'Your license key',
  show: 'Show',
  hide: 'Hide',
  copyKey: 'Copy key',
  copyLink: 'Copy link',
  copied: 'Copied ✓',
  copyFailed: 'Copy failed — select and copy by hand',
  restoreLink: 'Restore link',
  sentTo: 'We sent the key and this link to {email}.',
  help: 'Help: ',

  // one-line entries (panel and the static card after unlock)
  lineUnlocked: '✓ Unlocked',
  manage: 'Manage',
  sep: ' · ',

  // dialog chrome
  close: 'Close',

  // return from Stripe
  pendingTitle: 'Payment received',
  verifying: 'Fetching your key…',
  cancelled: 'Payment cancelled — nothing charged.',
  retry: 'Try again',

  // errors (every one with the support address)
  errInvalid: 'That does not look like a license key (KQ-XXXX-XXXX-XXXX). Keys never contain 0, O, 1 or I. Help: {support}',
  errNotFound: 'This key was not found. Just paid? Wait a minute and try again. Help: {support}',
  errVerifyNotFound: 'Just paid? Your key is not visible yet — wait a minute and try again. It is also in the email from keepquiet.app. Help: {support}',
  errRevoked: 'This purchase was refunded. If that is wrong, write to {support}',
  errDisabled: 'Unlock is unavailable right now — the free meter keeps working. Help: {support}',
  errUnreachable: 'Could not reach the unlock service. Check your connection and try again. Help: {support}',
  errVerifyUnreachable: 'Payment received — this page could not fetch your key right now. Your key is in the email from keepquiet.app (and on your Stripe receipt). Try again in a minute, or write to {support}',
  errNotPaid: 'This payment has not completed. If you were charged, write to {support}',
  errRateLimited: 'Too many attempts — wait a minute and try again. Help: {support}',
  errOther: 'Something went wrong on our side. Try again in a minute, or write to {support}',

  // email path (POST /magic, Step 5b): the success text is the same for known and unknown addresses
  magicSent: 'If that email paid, a link is on its way — check your spam folder too. No email after 10 minutes? Write to {support}',
  errMagicRateLimited: 'Please wait a minute before requesting another email.',
  errNotEmailOrKey: 'That does not look like an email address or a license key.'
};

// README § 8.3: tool-test.html sets window.__kqUnlockApi in its inline head script (ring 1: "mock",
// ring 2/3: the test Worker URL); index.html never sets it and uses this constant ("mock" on the
// branch, the live URL in the go-live patch). No trailing slash.
// Developer override (ring 2, Step 5b): localStorage "kq-api" = "mock" or an http(s) origin, read ONLY
// on localhost / 127.0.0.1 or when localStorage kq-dev === "1" — never on the live host without kq-dev.
function resolveApi(base, host, get) {
  try {
    if (!(host === 'localhost' || host === '127.0.0.1' || get('kq-dev') === '1')) return base;
    let o = get('kq-api');
    if (!o) return base;
    o = String(o).trim().replace(/\/+$/, '');
    if (o !== 'mock' && !/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(o)) return base;
    try { console.info('[kq-unlock] API override: ' + o); } catch (e) {}
    return o;
  } catch (e) { return base; }
}
const UNLOCK_API = resolveApi(window.__kqUnlockApi || 'mock', location.hostname,
  (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } });

const LS_LICENSE = 'kq-license', LS_DEVICE = 'kq-device', LS_MOCK = 'kq-mock';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_RE = /^KQ-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/* ---------- key helpers (README § 7) ---------- */
function normaliseKey(raw) {
  let s = String(raw || '').trim().toUpperCase();
  s = s.split('').filter((c) => ALPHABET.indexOf(c) >= 0 || c === '-' || c === 'K' || c === 'Q').join('');
  s = s.replace(/-/g, '');
  if (s.length === 14 && s.slice(0, 2) === 'KQ') s = 'KQ-' + s.slice(2, 6) + '-' + s.slice(6, 10) + '-' + s.slice(10, 14);
  return s;
}
function validKey(key) { return KEY_RE.test(key); }
function normaliseEmail(raw) { return String(raw || '').trim().toLowerCase(); }
function validEmail(e) { return e.length >= 3 && e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }   // "has @ and a dot after it" 
function maskKey(key) { return 'KQ-••••-••••-' + key.slice(-4); }
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
function mockRoute(method, path, body, sc) {
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
    if (s === 'cs_test_mock') return { status: 200, json: { key: 'KQ-TEST-TEST-TEST', emailMasked: 't***@example.org' } };
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
    if (k === 'KQ-TEST-TEST-TEST') return { status: 200, json: { ok: true } };
    if (k === 'KQ-TEST-TEST-NFND') return err(404, 'not-found');
    if (k === 'KQ-TEST-TEST-RVKD') return err(403, 'revoked');
    if (k === 'KQ-TEST-TEST-NVLD') return err(400, 'invalid');
    if (k === 'KQ-TEST-TEST-UNRC') return DOWN;
    if (k === 'KQ-TEST-TEST-SRVR') return err(500, 'server-error');
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
function mockFetch(method, path, body, lsGet) {
  const sc = lsGet(LS_MOCK) || '';
  const delay = sc === 'slow' ? 5000 : 400;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const res = mockRoute(method, path, body, sc);
      try { console.info('[kq-mock] ' + method + ' ' + path, body, '→', res ? res.status : 'network failure', res ? res.json : 'TypeError'); } catch (e) {}
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

  /* API call: mock or real; both resolve to { status, json } or reject like a failed fetch */
  async function call(method, path, body) {
    if (UNLOCK_API === 'mock') return mockFetch(method, path, body, lsGet);
    let url = UNLOCK_API + path;
    const opts = { method, mode: 'cors', credentials: 'omit' };
    if (method === 'GET') url += '?' + new URLSearchParams(body).toString();
    else { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const r = await fetch(url, opts);
    let json = null;
    try { json = await r.json(); } catch (e) {}
    return { status: r.status, json };
  }
  function codeOf(r) { return (r && r.json && typeof r.json.error === 'string') ? r.json.error : 'other'; }
  function failReason(code) {   // unlock-fail {reason} buckets (§ 3.5)
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
    openedFrom: 'panel',  // opener of the dialog → unlock-click {from} for the dialog's own button
    restoreOpen: false,   // dialog offer view: restore field expanded (restore mode, or the link was pressed)
    msgs: { main: null, restore: null }   // last message per slot, re-applied after every render
  };
  // views: { host, variant }  line = the panel entry · card = the static card below the fold (touched only
  // once unlocked) · dialog = the modal · panel = fallback card in the panel for browsers without showModal
  const views = [];

  /* ---------- DOM helpers ---------- */
  function p(cls, text) { const n = el('p', cls); if (text) n.textContent = text; return n; }
  function mailLink() { const a = el('a'); a.href = 'mailto:' + S.support; a.textContent = S.support; return a; }
  function lineWithMail(cls, prefix) { const n = p(cls); n.appendChild(document.createTextNode(prefix)); n.appendChild(mailLink()); return n; }
  function textWithMail(text) {   // "… Help: AppsForParents@gmail.com" → the address becomes a link
    const n = p('');
    const i = text.indexOf(S.support);
    if (i < 0) { n.textContent = text; return n; }
    n.appendChild(document.createTextNode(text.slice(0, i)));
    n.appendChild(mailLink());
    n.appendChild(document.createTextNode(text.slice(i + S.support.length)));
    return n;
  }
  const dark = (variant) => variant === 'panel' || variant === 'line';   // inside the dark panel vs white surfaces
  function smallBtn(variant, label) {
    const b = button(dark(variant) ? 'nm-unlock-sm' : 'kq-sm', '', '');
    b.textContent = label;
    return b;
  }
  function pill(variant, label) {
    const b = button(dark(variant) ? 'nm-pill' : 'btn', '', '');
    b.textContent = label;
    return b;
  }
  function ghost(label) {   // secondary pill in the dialog (navy text, 1 px navy border, white)
    const b = button('kq-ghost', '', '');
    b.textContent = label;
    return b;
  }
  // the Unlock button's label: two lines (bold value line + smaller price line), or the busy text
  function setPrimaryLabel(b, busy) {
    b.innerHTML = '';
    if (busy) { b.appendChild(el('span', 'kq-u1')).textContent = S.unlockBusy; return; }
    b.appendChild(el('span', 'kq-u1')).textContent = b.hasAttribute('data-kq-short') ? S.unlockLine1Panel : S.unlockLine1;
    b.appendChild(el('span', 'kq-u2')).textContent = fill(S.unlockLine2);
  }
  function primary(variant, from) {   // the Unlock button: /checkout → Stripe, label swaps while busy
    const b = pill(variant, '');
    b.classList.add('kq-unlock-btn');
    b.setAttribute('data-kq-primary', '');
    if (variant === 'line') b.setAttribute('data-kq-short', '');   // panel button + sticky copy: short line 1
    setPrimaryLabel(b, state.busy);
    b.addEventListener('click', () => checkout(from));
    return b;
  }
  const ICONS = {   // 14 px inline icons for the trust line (stroke = currentColor)
    check: '<path d="M3 8.5l3 3 7-7"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    bolt: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>'
  };
  function trustLine(variant) {   // "✓ One-time payment · ✓ no subscription · 🔒 secure checkout … · ⚡ unlocks instantly …"
    const n = el('p', dark(variant) ? 'nm-unlock-trust' : 'kq-trust');
    S.trust.forEach((t) => {
      const it = el('span', 'kq-trust-item');
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
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
  }

  /* ---------- the dialog (native <dialog>, top layer; built on first open) ---------- */
  let dlg = null, dlgBody = null, opener = null;
  function buildDialog() {
    dlg = document.createElement('dialog');
    dlg.className = 'kq-dialog' + (api.reducedMotion ? ' kq-reduced' : '');
    dlg.setAttribute('aria-labelledby', 'kq-dlg-title');
    const box = el('div', 'kq-dialog-box');
    const x = button('kq-dialog-x', S.close, '×');
    x.addEventListener('click', () => closeDialog());
    dlgBody = el('div', 'kq-dialog-body');
    box.appendChild(x); box.appendChild(dlgBody);
    dlg.appendChild(box);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });   // backdrop tap
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });   // native cancel closes it; the stage's own Escape handler must not fire
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(); });
    dlg.addEventListener('close', onDialogClosed);
    document.body.appendChild(dlg);
    views.push({ host: dlgBody, variant: 'dialog' });
  }
  // from: 'thumb' | 'panel' | 'card' (→ unlock-click {from} of the dialog's button); focusRestore: put the caret in the key field
  function openDialog(from, focusRestore, expandRestore) {
    state.openedFrom = from || 'panel';
    if (focusRestore || expandRestore) state.restoreOpen = true;   // restore mode: the field is shown expanded
    if (!DIALOG_OK) { openFallbackCard(focusRestore); return; }
    if (!dlg) buildDialog();
    renderInto(dlgBody, 'dialog');
    if (!dlg.open) {
      opener = document.activeElement;
      try { document.documentElement.classList.add('kq-dialog-open'); } catch (e) {}
      try { dlg.showModal(); } catch (e) { try { dlg.setAttribute('open', ''); } catch (x) {} }
    }
    const box = dlg.firstChild; box.tabIndex = -1;
    const input = focusRestore ? dlgBody.querySelector('input') : null;
    focusNoScroll(input || box);
    if (!input) dlg.scrollTop = 0;
  }
  function closeDialog() { if (dlg && dlg.open) { try { dlg.close(); } catch (e) { onDialogClosed(); } } }
  function onDialogClosed() {
    try { document.documentElement.classList.remove('kq-dialog-open'); } catch (e) {}
    state.restoreOpen = false;   // the next locked-thumb open shows the collapsed "Already unlocked? Restore" link
    if (state.revealed) { state.revealed = false; render(); }
    const o = opener; opener = null;
    if (o && o.isConnected && typeof o.focus === 'function') focusNoScroll(o);
  }
  // browsers without showModal: the same content as a card in the panel (api.mount().card)
  function openFallbackCard(focusRestore) {
    const v = views.find((x) => x.variant === 'panel');
    if (!v) return;
    api.openPanel();
    v.host.hidden = false;
    api.scrollPanelTo(v.host);
    if (focusRestore) { const i = v.host.querySelector('input'); if (i) focusNoScroll(i); }
  }

  /* ---------- rendering ---------- */
  function render() {
    views.forEach((v) => {
      if (v.variant === 'line') renderLine(v.host);
      else if (v.variant === 'sticky') renderSticky(v.host);
      else if (v.variant === 'card') renderCard(v.host);
      else renderInto(v.host, v.variant);
    });
  }
  function renderInto(host, variant) {   // dialog body or the fallback card
    host.innerHTML = '';
    host.classList.toggle('is-unlocked', !!state.key);
    if (state.key) renderUnlocked(host, variant);
    else if (state.pendingSession) renderPending(host, variant);
    else if (api.freeWindow()) renderFree(host, variant);
    else renderOffer(host, variant);
    applyMsgs(host, variant);
  }
  function title(variant, text) {   // fallback card: bold line; dialog: a real heading (labels the dialog)
    const n = el(dark(variant) ? 'p' : 'h2', dark(variant) ? 'nm-unlock-title' : 'kq-title');
    if (variant === 'dialog') n.id = 'kq-dlg-title';
    n.textContent = text;
    return n;
  }
  // the locked-thumb dialog (2026-11-03): title, benefit line, thumb strip, the button, trust line, small print,
  // "See what's included ↓", status slot, restore (collapsed link in the dialog unless restore mode), Questions
  function renderOffer(host, variant) {
    host.appendChild(title(variant, S.offerTitle));
    host.appendChild(p(dark(variant) ? '' : 'kq-lead', S.offerBenefit));
    if (variant === 'dialog' && api.thumbStrip) {   // all 13 thumbs, unlocked look, lazy (the panel fallback has the real grids next to it)
      const strip = api.thumbStrip();
      if (strip) { strip.setAttribute('role', 'img'); strip.setAttribute('aria-label', S.offerStrip); host.appendChild(strip); }
    }
    host.appendChild(primary(variant, state.openedFrom));
    host.appendChild(trustLine(variant));
    host.appendChild(p(dark(variant) ? 'nm-unlock-first' : 'kq-fine', fill(S.offerFine)));
    const pricing = document.getElementById('pricing');
    if (variant === 'dialog' && pricing && !(api.isFullscreen && api.isFullscreen())) {   // not in fullscreen / expanded mode, not on tool-test.html
      const see = p('kq-see');
      const b = smallBtn(variant, S.seeIncluded);
      b.addEventListener('click', () => {
        closeDialog();
        try { pricing.scrollIntoView({ behavior: api.reducedMotion ? 'auto' : 'smooth', block: 'start' }); } catch (e) { pricing.scrollIntoView(); }
      });
      see.appendChild(b);
      host.appendChild(see);
    }
    host.appendChild(msgLine(variant, 'main'));
    if (variant === 'dialog' && !state.restoreOpen && !state.msgs.restore) renderRestoreToggle(host);
    else renderRestore(host, variant);
    host.appendChild(lineWithMail(dark(variant) ? 'nm-unlock-first' : 'kq-quiet', S.questions));
  }
  // collapsed restore: one text link; pressing it expands the field + Restore in place and focuses the field
  function renderRestoreToggle(host) {
    const n = p('kq-restore-toggle');
    const b = smallBtn('dialog', S.restoreEntry);
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
    host.appendChild(msgLine(variant, 'main'));
    renderRestore(host, variant);
  }
  function renderFree(host, variant) {
    host.appendChild(title(variant, fill(S.freeUntil, { date: api.freeUntil })));
    host.appendChild(msgLine(variant, 'main'));
    renderRestore(host, variant);
    host.appendChild(lineWithMail(dark(variant) ? 'nm-unlock-first' : 'kq-quiet', S.questions));
  }
  function renderRestore(host, variant) {
    const d = dark(variant);
    const box = el('div', d ? 'nm-unlock-restore' : 'kq-restore');
    const id = 'kq-restore-' + variant;
    const lab = el('label', ''); lab.setAttribute('for', id); lab.textContent = S.restoreLabel;
    box.appendChild(lab);
    const row = el('div', d ? 'nm-unlock-row' : 'kq-row');
    const input = document.createElement('input');
    input.type = 'text'; input.id = id; input.className = d ? 'nm-unlock-input' : 'kq-input';
    input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('autocapitalize', 'characters');
    input.placeholder = S.restorePlaceholder;
    const b = d ? pill(variant, S.restore) : ghost(S.restore);
    const go = () => restoreFromInput(input);
    b.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    row.appendChild(input); row.appendChild(b);
    box.appendChild(row);
    box.appendChild(msgLine(variant, 'restore'));
    host.appendChild(box);
  }
  function keyCode(variant) {
    const key = state.key;
    const code = el('code', dark(variant) ? 'nm-unlock-key' : 'kq-key');
    code.textContent = state.revealed ? key : maskKey(key);
    code.setAttribute('aria-label', state.revealed ? 'License key ' + key.split('').join(' ') : 'License key, hidden, ends with ' + key.slice(-4).split('').join(' '));
    return code;
  }
  function showBtn(variant) {
    const show = smallBtn(variant, state.revealed ? S.hide : S.show);
    show.setAttribute('aria-pressed', state.revealed ? 'true' : 'false');
    show.addEventListener('click', () => { state.revealed = !state.revealed; render(); });
    return show;
  }
  function renderUnlocked(host, variant) {   // thank-you (after a purchase: with the "sent to" line) and Manage
    const key = state.key, d = dark(variant), c = (n) => (d ? 'nm-unlock-' : 'kq-') + n;
    const action = (label, aria, fn) => { const b = d ? smallBtn(variant, label) : ghost(label); b.setAttribute('aria-label', aria); b.addEventListener('click', fn); return b; };
    host.appendChild(title(variant, S.unlocked));

    const box = el('div', c('keybox'));            // the key, masked by default, centred and large
    box.setAttribute('aria-label', S.keyLabel);
    box.appendChild(keyCode(variant));
    host.appendChild(box);
    const row = el('div', c('btnrow'));
    const show = d ? showBtn(variant) : ghost(state.revealed ? S.hide : S.show);
    if (!d) { show.setAttribute('aria-pressed', state.revealed ? 'true' : 'false'); show.addEventListener('click', () => { state.revealed = !state.revealed; render(); }); }
    row.appendChild(show);
    row.appendChild(action(S.copyKey, 'Copy the license key', (e) => copyText(key, e.currentTarget)));   // copies without revealing
    host.appendChild(row);

    const linkBlock = el('div', c('linkrow'));
    linkBlock.appendChild(p(c('label'), S.restoreLink));
    const url = p(c('url'));
    const a = el('a', d ? 'nm-unlock-link' : 'kq-link');
    a.href = restoreLinkFor(key); a.textContent = restoreLinkFor(key);
    url.appendChild(a);
    linkBlock.appendChild(url);
    linkBlock.appendChild(action(S.copyLink, 'Copy the restore link', (e) => copyText(restoreLinkFor(key), e.currentTarget)));
    host.appendChild(linkBlock);

    if (state.emailMasked) host.appendChild(p('', fill(S.sentTo, { email: state.emailMasked })));
    host.appendChild(lineWithMail(d ? 'nm-unlock-first' : 'kq-quiet', S.help));
    host.appendChild(msgLine(variant, 'main'));
  }
  function unlockedLine(variant, from) {   // "✓ Unlocked · KQ-••••-••••-1234 Show · Manage" (panel) / "✓ Unlocked · Manage" (static card)
    const line = p(dark(variant) ? 'nm-unlock-status' : 'kq-status');
    line.appendChild(document.createTextNode(S.lineUnlocked + S.sep));
    if (dark(variant)) {
      line.appendChild(keyCode(variant));
      line.appendChild(document.createTextNode(' '));
      line.appendChild(showBtn(variant));
      line.appendChild(document.createTextNode(S.sep));
    }
    const m = smallBtn(variant, S.manage);
    m.addEventListener('click', () => openDialog(from));
    line.appendChild(m);
    return line;
  }
  // the panel entry: locked → primary button + caption + "Already unlocked? Restore"; unlocked → status line; free window → line + Restore
  function renderLine(host) {
    host.innerHTML = '';
    host.hidden = false;
    if (api.placeLine) api.placeLine(!!state.key);   // unlocked row → bottom of the panel, small and muted (2026-11-02)
    if (state.key) { host.appendChild(unlockedLine('line', 'panel')); return; }
    if (api.freeWindow()) {
      const line = p('nm-unlock-status');
      line.appendChild(document.createTextNode(fill(S.freeUntil, { date: api.freeUntil }) + S.sep));
      const r = smallBtn('line', S.restore);
      r.addEventListener('click', () => openDialog('panel', true));
      line.appendChild(r);
      host.appendChild(line);
      return;
    }
    const main = primary('line', 'panel');
    host.appendChild(main);
    fitLine1(main);
    watchMain(main);
    host.appendChild(p('nm-unlock-caption', S.caption));
    const r = p('nm-unlock-caption');
    const b = smallBtn('line', S.restoreEntry);
    b.addEventListener('click', () => openDialog('panel', true));
    r.appendChild(b);
    host.appendChild(r);
  }
  // sticky panel CTA (2026-11-03): a compact copy of the Unlock button at the bottom of the panel's scroll area,
  // shown only while the main button is out of view (IntersectionObserver on the panel body). The slot keeps its
  // height while hidden (visibility), so nothing shifts; it is display:none when unlocked and in the free window.
  let stickyIO = null, stickyHost = null;
  function watchMain(btn) {
    if (!stickyHost || typeof IntersectionObserver !== 'function') return;
    if (!stickyIO) {
      stickyIO = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        stickyHost.classList.toggle('is-shown', !e.isIntersecting);
      }, { root: slots.scroller || null, threshold: 0.6 });
    }
    stickyIO.disconnect();
    stickyHost.classList.remove('is-shown');
    stickyIO.observe(btn);
  }
  function renderSticky(host) {
    host.innerHTML = '';
    const off = !!state.key || api.freeWindow();
    host.hidden = off;
    if (slots.scroller) slots.scroller.classList.toggle('has-sticky', !off);
    if (off) { host.classList.remove('is-shown'); if (stickyIO) stickyIO.disconnect(); return; }
    const b = primary('line', 'panel');
    b.classList.add('nm-unlock-compact');
    host.appendChild(b);
    fitLine1(b);
  }
  // panel line 1 must stay on one line: if it wraps at this width (classic scrollbar, the wider brand font), step it down
  // (.is-tight .88rem, then .is-tighter .8rem). Measured while the panel is visibility:hidden too (layout exists); run again
  // once the brand font is ready (document.fonts.ready, see mount) in case it was measured with the fallback font.
  function fitLine1(btn) {
    const s = btn.querySelector('.kq-u1');
    if (!s || !s.offsetHeight) return;
    const wraps = () => s.offsetHeight > (parseFloat(getComputedStyle(s).lineHeight) || 18) * 1.5;
    btn.classList.remove('is-tight', 'is-tighter');
    if (!wraps()) return;
    btn.classList.add('is-tight');
    if (wraps()) { btn.classList.remove('is-tight'); btn.classList.add('is-tighter'); }
  }
  // the price card in the pricing section: untouched until unlocked (its markup carries the offer), then its actions
  // block (button, Restore link, small print) becomes "✓ Unlocked · Manage"
  function renderCard(host) {
    if (!state.key) return;
    const target = host.querySelector('[data-kq-actions]') || host;
    target.innerHTML = '';
    target.appendChild(unlockedLine('card', 'card'));
  }
  function msgLine(variant, slot) {
    const n = el('p', (dark(variant) ? 'nm-unlock-msg' : 'kq-msg'));
    n.setAttribute('data-slot', slot); n.setAttribute('role', 'status'); n.hidden = true;
    return n;
  }
  function applyMsg(host, variant, slot) {
    const n = host.querySelector('[data-slot="' + slot + '"]');
    if (!n) return;
    const m = state.msgs[slot];
    n.innerHTML = '';
    n.className = (dark(variant) ? 'nm-unlock-msg' : 'kq-msg') + (m && m.kind ? ' is-' + m.kind : '');
    if (!m || !m.text) { n.hidden = true; return; }
    const line = textWithMail(m.text);
    while (line.firstChild) n.appendChild(line.firstChild);
    if (m.retry) {
      n.appendChild(document.createTextNode(' '));
      const r = smallBtn(variant, S.retry);
      r.addEventListener('click', m.retry);
      n.appendChild(r);
    }
    n.hidden = false;
  }
  function applyMsgs(host, variant) { applyMsg(host, variant, 'main'); applyMsg(host, variant, 'restore'); }
  // message in one slot (kept in state, so it survives re-renders and a reopened dialog)
  function setMsg(slot, text, kind, retryFn) {
    state.msgs[slot] = text ? { text, kind: kind || '', retry: retryFn || null } : null;
    views.forEach((v) => { if (v.variant === 'dialog' || v.variant === 'panel') applyMsg(v.host, v.variant, slot); });
  }
  function setBusy(on, label) {
    state.busy = on;
    views.forEach((v) => {
      v.host.querySelectorAll('button').forEach((b) => {
        if (b.classList.contains('kq-dialog-x')) return;
        b.disabled = on;
        if (b.hasAttribute('data-kq-primary')) setPrimaryLabel(b, on);
      });
      v.host.querySelectorAll('input').forEach((i) => { i.disabled = on; });
    });
    if (label) setMsg('main', label, 'busy');
  }

  /* ---------- actions ---------- */
  function unlockedNow(key, via, emailMasked) {
    state.key = key; state.emailMasked = emailMasked || ''; state.revealed = false;
    state.pendingSession = null;
    state.msgs = { main: null, restore: null };
    lsSet(LS_LICENSE, key);
    signal('unlock-success', { via });
    api.setUnlocked();
    render();
    if (dlg && dlg.open) dlg.scrollTop = 0;
  }

  // from: 'panel' (panel button), 'card' (static card button), or the dialog opener (thumb|panel|card)
  async function checkout(from) {
    if (state.busy) return;
    signal('unlock-click', { from });
    setBusy(true, null);
    try {
      const r = await call('POST', '/checkout', {});
      if (r.status === 200 && r.json && typeof r.json.url === 'string') {
        api.pauseForRedirect();   // exit expanded fullscreen (iPhone Safari), pause the meter
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
    if (v.indexOf('@') >= 0) { magic(v); return; }   // email path (POST /magic); otherwise the key path
    restore(v, 'key', 'restore');
  }
  // restore by email: never reveals whether the address exists (constant answer, README § 2.7)
  async function magic(raw) {
    if (state.busy) return;
    const email = normaliseEmail(raw);
    if (!validEmail(email)) { signal('unlock-fail', { reason: 'invalid' }); setMsg('restore', S.errNotEmailOrKey, 'error'); return; }
    signal('unlock-restore-attempt', { via: 'mail' });
    setBusy(true, null); setMsg('restore', S.restoreBusy, 'busy');
    try {
      const r = await call('POST', '/magic', { email });
      setBusy(false);
      if (r.status === 200 && r.json && r.json.ok === true) { setMsg('restore', fill(S.magicSent), 'success'); return; }
      const code = codeOf(r);
      signal('unlock-fail', { reason: failReason(code === 'bad-request' ? 'invalid' : code) });
      setMsg('restore', code === 'rate-limited' ? S.errMagicRateLimited : code === 'bad-request' ? S.errNotEmailOrKey : errText(code, 'restore'), 'error');
    } catch (e) {
      signal('unlock-fail', { reason: 'worker-unreachable' });
      setBusy(false); setMsg('restore', errText('worker-unreachable', 'restore'), 'error');
    }
  }

  /* ---------- URL params (window.__kqUnlock, README § 8.1): a purchase beats a bookmark ---------- */
  function handleUrl() {
    const u = window.__kqUnlock;
    if (!u) return;
    window.__kqUnlock = undefined;   // handled once (Safari bfcache may bring the page back)
    if (u.session) { state.pendingSession = u.session; openDialog('panel'); verify(u.session); return; }
    if (u.cancel) { signal('unlock-cancel', {}); setMsg('main', S.cancelled, 'info'); openDialog('panel'); return; }
    if (u.k) {
      const key = normaliseKey(u.k);
      if (state.key && state.key === key) return;   // same key already stored: nothing to do
      const via = u.src === 'mail' ? 'mail' : 'url';
      openDialog('panel', false, true);   // restore mode: field expanded (not focused, as before)
      restore(u.k, via, 'main');
    }
  }
  // Safari back button from Stripe restores the page from the bfcache with the busy state of the click
  window.addEventListener('pageshow', (e) => { if (e.persisted && state.busy) { setBusy(false); setMsg('main', ''); } });

  /* ---------- mount ---------- */
  const slots = api.mount() || {};
  if (slots.sticky) { stickyHost = slots.sticky; views.push({ host: slots.sticky, variant: 'sticky' }); }
  if (slots.line) views.push({ host: slots.line, variant: 'line' });
  if (!DIALOG_OK && slots.card) { views.push({ host: slots.card, variant: 'panel' }); slots.card.hidden = !(state.key || api.freeWindow()); }
  const below = document.getElementById('pro-card');
  if (below && below.hasAttribute('data-kq-unlock-card')) views.push({ host: below, variant: 'card' });
  render();
  handleUrl();
  try {   // re-fit the panel's line 1 once the brand font has loaded
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      views.forEach((v) => { if (v.variant === 'line' || v.variant === 'sticky') v.host.querySelectorAll('.kq-unlock-btn').forEach(fitLine1); });
    });
  } catch (e) {}

  return {
    show(from) { openDialog(from || 'thumb'); },                       // locked thumb tapped
    panelClosed() { if (state.revealed) { state.revealed = false; render(); } },   // Show lasts until the panel (or the dialog) closes
    cardAction(target) {                                               // Unlock / Restore on the static card below the fold
      if (!target) return;
      if (target.hasAttribute('data-kq-unlock')) checkout('card');
      else if (target.hasAttribute('data-kq-restore')) openDialog('card', true);
    },
    isUnlocked() { return !!state.key; }
  };
}
