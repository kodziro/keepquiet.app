/*
  TelemetryDeck "appstore-click" signal for keepquiet.app (same mechanism as
  kidstimer.app, visual-schedule.app and token-board.app).

  Loads the TelemetryDeck JavaScript SDK (@telemetrydeck/sdk, ES module, no
  dependencies) from jsDelivr at runtime and sends one signal per click on an
  own App Store link (app id 6744021866):  type "appstore-click",
  payload { page, position, source, path, referrer }.

  - source mirrors the Web SDK's "combinedSource" so clicks can be compared
    with pageviews by source: the utm_source query parameter if present (e.g.
    "chatgpt.com"), else the host of an external referrer (e.g.
    "www.google.com"), else "none". path is the page path, referrer the raw
    referrer host (may be keepquiet.app for internal navigation). No query
    strings, no full URLs, nothing personal.
  - position comes from the link's data-td-position attribute (nav, tool, app,
    faq, cta, footer, guide-cta; older pages: hero, demo, download).
  - Pageviews are still sent by the separate Web SDK tag in <head>; this file
    does not touch them.
  - Navigation is never blocked or delayed: the click handler only fires a
    keepalive POST and returns. If the SDK fails to load, nothing is sent and
    the links keep working as plain links.
  - Cookieless: clientUser is a random value per page load, never stored.
*/
(function () {
  var APP_ID = '43A2ECAF-E4DA-4440-B847-7A1FCE01600C';
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@telemetrydeck/sdk@2.0.4/dist/telemetrydeck.js';
  var td = null;

  function pageSlug() {
    var explicit = document.body && document.body.getAttribute('data-td-page');
    if (explicit) return explicit;
    var path = location.pathname.replace(/\/index\.html$/, '/');
    if (path === '' || path === '/') return 'home';
    var guide = path.match(/\/guides\/([^\/]+)\.html$/);
    if (guide) return 'guide-' + guide[1];
    var name = path.replace(/^.*\//, '').replace(/\.html$/, '');
    return name || 'home';
  }

  function referrerHost() {
    try {
      return document.referrer ? new URL(document.referrer).hostname : '';
    } catch (e) { return ''; }
  }

  function source() {
    var utm = '';
    try { utm = new URLSearchParams(location.search).get('utm_source') || ''; } catch (e) {}
    if (utm) return utm.toLowerCase().slice(0, 100);
    var host = referrerHost();
    if (host && host !== location.hostname) return host;
    return 'none';
  }

  function randomId() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  }

  function isTestMode() {
    // ?test=1 on any page = TelemetryDeck test mode (same switch as noise-meter.js)
    try { if (new URLSearchParams(location.search).get('test') === '1') return true; } catch (e) {}
    return /^localhost$|^127(\.\d+){0,2}\.\d+$|^\[::1?]$/.test(location.hostname) ||
      location.protocol === 'file:';
  }

  try {
    import(SDK_URL).then(function (mod) {
      var TelemetryDeck = mod.default;
      var instance = new TelemetryDeck({
        appID: APP_ID,
        clientUser: randomId(),
        testMode: isTestMode()
      });
      // Same request as the SDK's own _post (pinned 2.0.4), plus keepalive so
      // the browser finishes the POST even while it navigates to the App Store.
      instance._post = function (body) {
        return fetch(instance.target, {
          method: 'POST',
          mode: 'cors',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      };
      td = instance;
    }).catch(function () { /* SDK unavailable: links still work, no signal */ });
  } catch (e) { /* dynamic import unsupported: same fallback */ }

  document.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!target || !target.closest || !td) return;
    var link = target.closest('a[href*="id6744021866"]');
    if (!link) return;
    var position = link.getAttribute('data-td-position') || 'other';
    try {
      td.signal('appstore-click', {
        page: pageSlug(),
        position: position,
        source: source(),
        path: location.pathname,
        referrer: referrerHost() || 'none'
      }).catch(function () {});
    } catch (e) {}
  });
})();
