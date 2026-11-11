# Third-party notices

poe-manager includes code ported from the projects below. Their licenses apply to the
listed parts.

## PoB Trade Finder

Copyright (c) 2026 Jagomeiister, MIT License.

Ported parts:

- `crates/pob-parser/src/item_text.rs`, `crates/pob-parser/src/build.rs` — from `vendor/pob.js`
  (decoding of Path of Building codes, PoB item text).
- `src-tauri/src/trade/stats.rs` — from `vendor/matcher.js` (`buildStatIndex`).
- `src-tauri/src/trade/matcher.rs` — from `vendor/matcher.js` (`matchMod`) and `public/app.js`
  (`filterEntries`).

The license text also ships with the crate: `crates/pob-parser/LICENSE-PoB-Trade-Finder`.

```
MIT License

Copyright (c) 2026 Jagomeiister

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Game data

Item, mod and stat data (RePoE, the trade site's `/api/trade/data`) and images (item icons,
class and ascendancy portraits from Path of Building Community's assets) belong to Grinding
Gear Games. They are not part of this repository: the backend publishes them in data sets.
