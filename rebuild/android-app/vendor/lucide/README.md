# Lucide UI assets

Official source: https://github.com/lucide-icons/lucide

Pinned release **0.468.0**, commit **f12b0de177fbc2a6795e99be065887e72b237123**.
`LICENSE` is the complete upstream ISC license and Feather attribution.
`FEATHER-LICENSE` includes the complete MIT license from Feather v4.29.2.

Only the 43 selected SVGs are vendored. The Android runtime loads their transparent
96 × 96 PNG renders, caches each bitmap once, and applies the interface tint.
There is no SVG parser, network font/CDN dependency, or per-frame image decoding.
Refresh motion uses Android animation only while visible and reading, and respects
system-disabled animations.

`manifest.json` records upstream SVG, license and output PNG SHA-256 values. APK
assembly checks the packaged PNGs and license. To reproduce the renders with the
pinned rasterizer (temporary tooling, not an App dependency):

```sh
npm install --prefix /tmp/io-agent-lucide-render --no-audit --no-fund @resvg/resvg-js@2.6.2
node tools/android/render-agent-icons.mjs /tmp/io-agent-lucide-render/node_modules/@resvg/resvg-js
node tools/android/test-agent-icons.mjs
```

Artwork is unchanged; rendering substitutes `currentColor` with white before
runtime tinting. Update the manifest explicitly when choosing a new upstream release.
