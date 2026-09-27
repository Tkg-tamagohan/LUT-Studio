---
name: testing-lut-studio
description: How to run and E2E-test the LUT-Studio Vite app on this Windows box — dev server, file-open dialog multi-select, native color picker, slider manipulation, and test image locations.
---

# LUT-Studio E2E testing

## Dev server & environment

- Repo: `C:\Users\Administrator\repos\LUT-Studio` (Vite + TS, no backend). Serve with `npm.cmd run dev` → http://localhost:5173.
- In Git Bash the bare `npm`/`npx` shims fail with "No such file or directory" — always use `npm.cmd` / `npx.cmd`.
- Python is not installed; `python` is not on PATH. Use `node` for any scripting.
- Test images live in `C:\Users\Administrator\test-images\` (e.g. Red.png/Green.png/Blue.png, 640×360; top half bright hue with "TOP X" text, bottom half dark with "BOTTOM"). Expected hues: red≈0°, green≈120°, blue≈240°.

## UI mechanics that matter for testing

- **File loading**: 「画像を選択…」opens a native Windows Open dialog (the hidden `#file-input` is `multiple`). To select several files at once, click into the ファイル名 field and type quoted space-separated paths: `"Red.png" "Green.png" "Blue.png"`, then Enter. The dialog often opens directly in `test-images`.
- **Range sliders**: clicking the track jumps the thumb to the click position; value text appears to the right. For exact values, click near the target then trim with ←/→ (each press = one step); Home/End jump to min/max. Note the extreme ends of the track can be a small dead zone — click a few px inward or use Home/End.
- **Theme select** (`#theme-select`): the dropdown option hitboxes are narrow — clicking a row can miss. Reliable path: click select to open, then ↑/↓ arrows + Enter.
- **色から選択**: opens Chromium's native color dialog (not the old Win32 one). It has R/G/B numeric fields at bottom-right — triple-click each and type values, then Enter. 'input' fires on confirm and rebuilds the panel.
- **画像から拾う**: enters pick mode (`body.picking`, status shows guidance, crosshair cursor). Click a canvas → samples the ORIGINAL bitmap pixel hue (LUT-independent). Esc cancels. Verify cancellation by clicking a tile afterwards — nothing should change.
- **Panel scrolling**: `#panel` (right aside, 280px) overflows — scroll it to reach 色相を追加 / この選択を削除 / リセット. `rebuildPanel()` (after add/remove/color-pick) resets scroll to top.
- **Persistence**: localStorage keys `lut-studio:theme` and `lut-studio:tile-size` survive reload; loaded images do NOT (in-memory only — reload drops them, status returns to 画像を読み込んでください).
- **Mask preview**: header「選択範囲を表示」bakes a maskPreview LUT — selected hues render white, unselected black; achromatic pixels (the test images' text) are excluded and render black.
- **Right-justified grid**: `#grid` uses `justify-content:flex-end`, so the clearest proof of right alignment is shrinking 表示サイズ to 15% — all tiles pack into one row flush against the panel.
- Expected isolation math: `mask=1` inside `range`, smoothstep fade across `feather` (outer edge = range+feather); `strength` blends partial desaturation. Green(120°) vs a 240° target is distance 120 — widening 範囲 to ≥120 re-includes it, a good visible toggle.

## Phase 3+ additions

- **原画比較 (press-and-hold)**: `pointerdown` on a preview canvas sets renderer bypass (original image) until pointerup/leave. In the computer tool, `left_mouse_down` takes NO coordinate — `mouse_move` to the tile first, then `left_mouse_down`, screenshot while held, then `left_mouse_up`. During eyedropper pick mode the bypass is suppressed — hold stays LUT-applied, and releasing still picks the hue.
- **RGBカーブ editor**: canvas 248×150 CSS px in the panel. mousedown on empty space ADDS a point AND starts dragging it in one gesture. Control-point hit radius is only 8 CSS px (~5 tool px) — for dblclick-delete, click to add a point then dblclick that exact same coordinate, or you will accidentally add+delete a new point instead. 「このチャネルを直線に戻す」resets only the active channel; マスター/R/G/B buttons switch independent curves.
- **Screen↔CSS coordinate scale**: the computer-tool space is ~0.61× CSS px on this box (280 CSS px panel ≈ 170 tool px). Zoom into the canvas region before clicking curve points.
- **LGG sliders**: 9 sliders — リフト R/G/B (-1..1), ガンマ R/G/B (0.2..4, default 1), ゲイン R/G/B (0.2..4, default 1). The panel scrolls while you click near its bottom edge — re-screenshot before aiming at the lowest visible slider.
- **WebGL1 fallback**: append `?webgl1` to the URL to force the WebGL1 (2D atlas LUT) renderer. Verify the path taken with a read-only console probe: `c.getContext('webgl2')` returns null on canvases already bound to WebGL1, `getContext('webgl')` returns the context.
- **リセット** now also clears curves (all 4 channels to identity), LGG, and isolation — good end-state check: dirty curve+LGG+isolation → リセット → all neutral, tiles full color.

## Linux box notes (this repo also runs on Linux; paths/tools differ from the Windows notes above)

- Repo: `~/repos/LUT-Studio`; `npm run dev -- --host --port 5173` works with `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`. Python3 + PIL and ImageMagick (`convert`) are available for generating/verifying images.
- **File inputs**: the GTK file chooser does NOT open under automation Chrome (`--enable-automation`, remote-debugging-port=29229). Inject files deterministically via CDP `DOM.setFileInputFiles` on `#file-input` (images) or `#panel input[type="file"]` (preset JSON) — the change event fires and the real load/parse path runs. Helper pattern: `fetch('http://localhost:29229/json')` → find page target → WS → `DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`.
- **Downloads**: pin the dir with `Browser.setDownloadBehavior {behavior:'allow', downloadPath:'/home/ubuntu/Downloads'}` on the browser WS endpoint (`/json/version`), then verify artifacts in `~/Downloads`. Multiple downloads produce `name (1).ext` duplicates.
- **Coordinate scale**: computer-tool space ≈ 0.653× CSS px (innerWidth 1568 ↔ 1024 tool px; innerHeight 993 ↔ ~706 tool px + ~62px browser chrome offset). Small buttons near the panel's right edge (画像から拾う, JSONから読込…) need the button's `getBoundingClientRect()` center converted to tool coords — aiming by eye can land in the 1-2px gap past the button edge.
- **Mask preview check**: maskPreview only affects output when isolation is enabled (adjustments.ts) — to prove export is mask-free, enable isolation + mask preview (previews go B/W) and verify the exported .cube still contains graded values, not binary 0/1.
- **Export verification**: `.cube` = 4 header + size³ data lines (33→35941 lines), b outer / g middle / r inner; HaldCLUT(64)=512×512, ReShade(64)=4096×64; per-image export `<base>-lut.png` decodes the ORIGINAL file (use a >2048px image to prove full-res, preview bitmap would cap at 2048).

## Linux box notes (this repo also runs on Linux; paths/tools differ from the Windows notes above)

- Repo: `~/repos/LUT-Studio`; `npm run dev -- --host --port 5173` works with `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`. Python3 + PIL and ImageMagick (`convert`) are available for generating/verifying images.
- **File inputs**: the GTK file chooser does NOT open under automation Chrome (`--enable-automation`, remote-debugging-port=29229). Inject files deterministically via CDP `DOM.setFileInputFiles` on `#file-input` (images) or `#panel input[type="file"]` (preset JSON) — the change event fires and the real load/parse path runs. Helper pattern: `fetch('http://localhost:29229/json')` → find page target → WS → `DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`.
- **Downloads**: pin the dir with `Browser.setDownloadBehavior {behavior:'allow', downloadPath:'/home/ubuntu/Downloads'}` on the browser WS endpoint (`/json/version`), then verify artifacts in `~/Downloads`. Multiple downloads produce `name (1).ext` duplicates.
- **Coordinate scale**: computer-tool space ≈ 0.653× CSS px (innerWidth 1568 ↔ 1024 tool px; innerHeight 993 ↔ ~706 tool px + ~62px browser chrome offset). Small buttons near the panel's right edge (画像から拾う, JSONから読込…) need the button's `getBoundingClientRect()` center converted to tool coords — aiming by eye can land in the 1-2px gap past the button edge.
- **Mask preview check**: maskPreview only affects output when isolation is enabled (adjustments.ts) — to prove export is mask-free, enable isolation + mask preview (previews go B/W) and verify the exported .cube still contains graded values, not binary 0/1.
- **Export verification**: `.cube` = 4 header + size³ data lines (33→35941 lines), b outer / g middle / r inner; HaldCLUT(64)=512×512, ReShade(64)=4096×64; per-image export `<base>-lut.png` decodes the ORIGINAL file (use a >2048px image to prove full-res, preview bitmap would cap at 2048).
- **Slider-label reset (PR #8)**: `.slider-label` spans are full row width — clicking whitespace on the label line also resets to default (deterministic). The value text is a separate line and a harmless no-op. Verify hover styling via `getComputedStyle(document.querySelector('.slider-label:hover'))` (dotted underline is hard to resolve in screenshots); the `title` tooltip「クリックで既定値に戻す」appears after ~1s hover.
- **.cube exposure check**: with exposure EV set, the data line for input (1/32,0,0) reads ≈ 0.03125·2^EV — quick numeric proof adjustments are baked.

## Linux box notes (this repo also runs on Linux; paths/tools differ from the Windows notes above)

- Repo: `~/repos/LUT-Studio`; `npm run dev -- --host --port 5173` works with `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`. Python3 + PIL and ImageMagick (`convert`) are available for generating/verifying images.
- **File inputs**: the GTK file chooser does NOT open under automation Chrome (`--enable-automation`, remote-debugging-port=29229). Inject files deterministically via CDP `DOM.setFileInputFiles` on `#file-input` (images) or `#panel input[type="file"]` (preset JSON) — the change event fires and the real load/parse path runs. Helper pattern: `fetch('http://localhost:29229/json')` → find page target → WS → `DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`.
- **Downloads**: pin the dir with `Browser.setDownloadBehavior {behavior:'allow', downloadPath:'/home/ubuntu/Downloads'}` on the browser WS endpoint (`/json/version`), then verify artifacts in `~/Downloads`. Multiple downloads produce `name (1).ext` duplicates.
- **Coordinate scale**: computer-tool space ≈ 0.653× CSS px (innerWidth 1568 ↔ 1024 tool px; innerHeight 993 ↔ ~706 tool px + ~62px browser chrome offset). Small buttons near the panel's right edge (画像から拾う, JSONから読込…) need the button's `getBoundingClientRect()` center converted to tool coords — aiming by eye can land in the 1-2px gap past the button edge.
- **Mask preview check**: maskPreview only affects output when isolation is enabled (adjustments.ts) — to prove export is mask-free, enable isolation + mask preview (previews go B/W) and verify the exported .cube still contains graded values, not binary 0/1.
- **Export verification**: `.cube` = 4 header + size³ data lines (33→35941 lines), b outer / g middle / r inner; HaldCLUT(64)=512×512, ReShade(64)=4096×64; per-image export `<base>-lut.png` decodes the ORIGINAL file (use a >2048px image to prove full-res, preview bitmap would cap at 2048).
- **Same-name files**: to load two images with identical basenames, create the same filename in two different directories (e.g. `/tmp/dup-a/same.png`, `/tmp/dup-b/same.png`) and pass both to one `DOM.setFileInputFiles` call — `entry.name` collides as intended. Export naming is `X-lut.png`, `X-lut-2.png`, … via a session-persistent registry (`exportedImageNames`), so numbering accumulates across repeated exports; image exports are deduped app-side but `.cube`/`lut-studio-*.png` are not (browser ` (N)` suffix still applies there).
- **Mobile layout (≤640px)**: verify via CDP `Emulation.setDeviceMetricsOverride` (e.g. 390×844, `mobile:true`, dpr 2) + `Emulation.setTouchEmulationEnabled`; Node 24's global `WebSocket` can drive CDP directly. Expected: `#panel` is `position:fixed` flush bottom at ~30dvh, `.lut-export` row `display:none` (image PNG export and presets stay visible), `#dropzone p` hidden, `#grid` left-justified. `Emulation.clearDeviceMetricsOverride` restores desktop.
