# Third-Party Notices

DJFriend includes the following open-source packages (production dependencies). Each is used under its license; full license texts are in each package under `node_modules/<name>/LICENSE` and are shipped with the app.

Where a package is dual-licensed (e.g. `(MIT OR GPL-3.0-or-later)`), DJFriend uses it under the permissive (MIT) option.

**LGPL component:** `codec-parser` (LGPL-3.0-or-later, used by `audio-decode` for FLAC/Ogg decoding) is shipped unmodified as a separate module in `node_modules` — it is never bundled into DJFriend's own code, so it can be replaced by the user as the LGPL requires. Its source is available at https://github.com/eshaz/codec-parser.

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) — https://www.openstreetmap.org/copyright

Key detection is implemented from scratch in `src/keyDetection.ts` from published methods: the Brown & Puckette (1992) constant-Q transform, chroma template matching (tonic-triad template; Krumhansl & Kessler (1982) profiles optional). No third-party key-detection code is used.

## (MIT AND Zlib)

- pako@1.0.11

## (MIT OR GPL-3.0-or-later)

- jszip@3.10.1

## 0BSD

- tslib@2.8.1

## Apache-2.0

- @eshaz/web-worker@1.2.2
- @thi.ng/bitstream@2.4.45
- @thi.ng/errors@2.6.7
- class-variance-authority@0.7.1
- openai@6.35.0

## BSD-2-Clause

- dotenv@16.6.1
- leaflet@1.9.4

## ISC

- inherits@2.0.4
- lucide-react@0.575.0
- setprototypeof@1.2.0

## LGPL-3.0-or-later

- codec-parser@2.5.0

## MIT

- @noble/ciphers@2.4.0
- qrcode@1.5.4
- @borewit/text-codec@0.2.2
- @emnapi/core@1.9.2
- @emnapi/runtime@1.9.2
- @emnapi/wasi-threads@1.2.1
- @floating-ui/core@1.7.5
- @floating-ui/dom@1.7.6
- @floating-ui/react-dom@2.1.8
- @floating-ui/utils@0.2.11
- @napi-rs/wasm-runtime@1.1.4
- @radix-ui/number@1.1.1
- @radix-ui/primitive@1.1.3
- @radix-ui/react-arrow@1.1.7
- @radix-ui/react-collection@1.1.7
- @radix-ui/react-compose-refs@1.1.2
- @radix-ui/react-context@1.1.2
- @radix-ui/react-direction@1.1.1
- @radix-ui/react-dismissable-layer@1.1.11
- @radix-ui/react-focus-guards@1.1.3
- @radix-ui/react-focus-scope@1.1.7
- @radix-ui/react-id@1.1.1
- @radix-ui/react-label@2.1.8
- @radix-ui/react-popper@1.2.8
- @radix-ui/react-portal@1.1.9
- @radix-ui/react-presence@1.1.5
- @radix-ui/react-primitive@2.1.3
- @radix-ui/react-primitive@2.1.4
- @radix-ui/react-select@2.2.6
- @radix-ui/react-slot@1.2.3
- @radix-ui/react-slot@1.2.4
- @radix-ui/react-tooltip@1.2.8
- @radix-ui/react-use-callback-ref@1.1.1
- @radix-ui/react-use-controllable-state@1.2.2
- @radix-ui/react-use-effect-event@0.0.2
- @radix-ui/react-use-escape-keydown@1.1.1
- @radix-ui/react-use-layout-effect@1.1.1
- @radix-ui/react-use-previous@1.1.1
- @radix-ui/react-use-rect@1.1.1
- @radix-ui/react-use-size@1.1.1
- @radix-ui/react-visually-hidden@1.2.3
- @radix-ui/rect@1.1.1
- @tokenizer/inflate@0.4.1
- @tokenizer/token@0.3.0
- @tybys/wasm-util@0.10.1
- @types/busboy@1.5.4
- @types/geojson@7946.0.16
- @types/leaflet@1.9.22
- @types/node@24.12.2
- @types/react-dom@19.2.3
- @types/react@19.2.14
- @wasm-audio-decoders/common@9.0.7
- @wasm-audio-decoders/flac@0.2.10
- @wasm-audio-decoders/ogg-vorbis@0.1.20
- @wasm-audio-decoders/opus-ml@0.0.2
- aria-hidden@1.2.6
- asynckit@0.4.0
- audio-buffer@5.0.0
- audio-decode@2.2.3
- audio-type@2.4.1
- axios@1.15.0
- base64-arraybuffer@1.0.2
- busboy@1.6.0
- call-bind-apply-helpers@1.0.2
- clsx@2.1.1
- combined-stream@1.0.8
- connect@3.7.0
- content-type@1.0.5
- core-util-is@1.0.3
- css-line-break@2.1.0
- debug@2.6.9
- debug@4.4.3
- delayed-stream@1.0.0
- depd@2.0.0
- detect-node-es@1.1.0
- dunder-proto@1.0.1
- ee-first@1.1.1
- encodeurl@1.0.2
- encodeurl@2.0.0
- es-define-property@1.0.1
- es-errors@1.3.0
- es-object-atoms@1.1.1
- es-set-tostringtag@2.1.0
- escape-html@1.0.3
- etag@1.8.1
- file-type@21.3.4
- finalhandler@1.1.2
- follow-redirects@1.16.0
- form-data@4.0.5
- fresh@2.0.0
- function-bind@1.1.2
- get-intrinsic@1.3.0
- get-proto@1.0.1
- gopd@1.2.0
- has-symbols@1.1.0
- has-tostringtag@1.0.2
- hasown@2.0.2
- html2canvas@1.4.1
- http-errors@2.0.1
- iconv-lite@0.6.2
- immediate@3.0.6
- isarray@1.0.0
- lie@3.3.0
- math-intrinsics@1.1.0
- media-typer@1.1.0
- mime-db@1.52.0
- mime-db@1.54.0
- mime-types@2.1.35
- mime-types@3.0.2
- mpg123-decoder@1.0.3
- ms@2.0.0
- ms@2.1.3
- music-metadata@11.12.3
- node-id3@0.2.9
- node-wav@0.0.2
- ogg-opus-decoder@1.7.3
- on-finished@2.3.0
- on-finished@2.4.1
- opus-decoder@0.7.11
- parseurl@1.3.3
- process-nextick-args@2.0.1
- proxy-from-env@2.1.0
- qoa-format@1.0.1
- range-parser@1.2.1
- react-dom@19.2.5
- react-remove-scroll-bar@2.3.8
- react-remove-scroll@2.7.2
- react-style-singleton@2.2.3
- react@19.2.5
- readable-stream@2.3.8
- safe-buffer@5.1.2
- safer-buffer@2.1.2
- send@1.2.1
- serve-static@2.2.1
- setimmediate@1.0.5
- simple-yenc@1.0.4
- statuses@1.5.0
- statuses@2.0.2
- streamsearch@1.1.0
- string_decoder@1.1.1
- strtok3@10.3.5
- tailwind-merge@3.5.0
- text-segmentation@1.0.3
- toidentifier@1.0.1
- token-types@6.1.2
- uint8array-extras@1.5.0
- undici-types@7.16.0
- unpipe@1.0.0
- use-callback-ref@1.3.3
- use-sidecar@1.1.3
- util-deprecate@1.0.2
- utils-merge@1.0.1
- utrie@1.0.2
- win-guid@0.2.1
- ws@8.20.0
- zod@4.3.6

