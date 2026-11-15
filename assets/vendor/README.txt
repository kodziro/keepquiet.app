token-board.app — third-party script files, self-hosted (S1, 2026-11-14)

These files are copies. They are served from this site so that a page load asks no other host
for a script. Signals still go to TelemetryDeck's own API (https://nom.telemetrydeck.com/v2/);
that did not change. Update by hand: download the new file, check it, replace the copy, change
the lines below, and bump the ?v= / the file name where the file is linked.

1. telemetrydeck.min.js
   What:    TelemetryDeck Web SDK tag (page views). The file names itself "WebSDK 1.1.0".
   Source:  https://cdn.telemetrydeck.com/websdk/telemetrydeck.min.js
   Fetched: 2026-11-14 (Last-Modified on the source: 2026-09-29)
   Size:    679 bytes
   SHA-256: d3f064d60cdd1a709d987544c412f4b53ec5b7942105a71507ed008187da4af2
   Used by: the <script ... data-app-id defer> tag in the <head> of 15 pages.
   Checked: loads no other script; one POST to https://nom.telemetrydeck.com/v2/w/.

2. telemetrydeck-sdk-2.0.4.js
   What:    @telemetrydeck/sdk 2.0.4, dist/telemetrydeck.js (ES module), MIT licence
            (LICENSE-telemetrydeck-sdk.txt).
   Source:  https://cdn.jsdelivr.net/npm/@telemetrydeck/sdk@2.0.4/dist/telemetrydeck.js
            (byte-identical to dist/telemetrydeck.js in the npm package sdk-2.0.4.tgz)
   Fetched: 2026-11-14
   Size:    6485 bytes
   SHA-256: aae317a21a5c3acc9b8c106da73e69c1da02eb120681c3dc9975400eac575f0a
   Used by: assets/tool-signals.js and assets/appstore-click.js (SDK_URL, relative to assets/).
   Note:    both files replace the SDK's _post (same request + keepalive). That patch was written
            for 2.0.4: check it again before changing the version.
   Checked: loads no other script; one POST target, https://nom.telemetrydeck.com/v2/.
