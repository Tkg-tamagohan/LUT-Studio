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
