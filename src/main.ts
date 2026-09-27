import {
  bakeLut,
  compileAdjustments,
  hueDegrees,
  neutralAdjustments,
  type LutData,
} from "./engine";
import {
  createRenderer,
  loadImageFiles,
  type ImageEntry,
  type PreviewRenderer,
} from "./preview";
import { createAdjustmentPanel } from "./ui/panel";

/** プレビュー用LUTのサイズ。書き出しPNGアトラスと同じ64（仕様決定D）。 */
const PREVIEW_LUT_SIZE = 64;

const adjustments = neutralAdjustments();
let lut: LutData = bakeLut(
  PREVIEW_LUT_SIZE,
  compileAdjustments(adjustments),
);

const grid = document.getElementById("grid")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const status = document.getElementById("status")!;
const entries = new Map<string, { entry: ImageEntry; renderer: PreviewRenderer | null }>();

let bakeScheduled = false;
let maskPreview = false;

/** スライダ変更を受けてLUTを再焼き付けし、全画像を再描画する。連続入力はrAFでまとめる。 */
function scheduleRebake(): void {
  if (bakeScheduled) return;
  bakeScheduled = true;
  requestAnimationFrame(() => {
    bakeScheduled = false;
    lut = bakeLut(
      PREVIEW_LUT_SIZE,
      compileAdjustments(adjustments, { maskPreview }),
    );
    for (const { renderer } of entries.values()) {
      renderer?.setLut(lut);
      renderer?.render();
    }
  });
}

function renderAll(): void {
  for (const { renderer } of entries.values()) renderer?.render();
}

function updateStatus(): void {
  status.textContent = `${entries.size} 枚読み込み済み`;
}

// 「画像から拾う」で一度だけ発火する色相選択モード。
// 拾うのはLUT適用後ではなく元画像の画素（脱色済みプレビューでは色相が拾えないため）。
let pickCallback: ((hueDeg: number) => void) | null = null;
const sampler = document.createElement("canvas");
const samplerCtx = sampler.getContext("2d", { willReadFrequently: true });

function requestHuePick(onPicked: (hueDeg: number) => void): void {
  pickCallback = onPicked;
  document.body.classList.add("picking");
  status.textContent = "拾いたい色を画像上でクリック（Escでキャンセル）";
}

function endPick(): void {
  pickCallback = null;
  document.body.classList.remove("picking");
  updateStatus();
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pickCallback) endPick();
});

function pickFromEntry(e: MouseEvent, canvas: HTMLCanvasElement, entry: ImageEntry): void {
  if (!pickCallback || !samplerCtx) return;
  const rect = canvas.getBoundingClientRect();
  const bx = Math.max(0, Math.min(entry.width - 1, Math.floor(((e.clientX - rect.left) / rect.width) * entry.width)));
  const by = Math.max(0, Math.min(entry.height - 1, Math.floor(((e.clientY - rect.top) / rect.height) * entry.height)));
  sampler.width = entry.width;
  sampler.height = entry.height;
  samplerCtx.drawImage(entry.bitmap, 0, 0);
  const d = samplerCtx.getImageData(bx, by, 1, 1).data;
  const cb = pickCallback;
  endPick();
  cb(hueDegrees(d[0] / 255, d[1] / 255, d[2] / 255));
}

function addImage(entry: ImageEntry): void {
  const figure = document.createElement("figure");
  figure.className = "preview-card";
  const canvas = document.createElement("canvas");
  canvas.className = "preview-canvas";
  canvas.style.aspectRatio = `${entry.width} / ${entry.height}`;
  canvas.addEventListener("click", (e) => pickFromEntry(e, canvas, entry));
  const caption = document.createElement("figcaption");
  caption.textContent = entry.name;
  figure.append(canvas, caption);
  grid.appendChild(figure);

  const renderer = createRenderer(canvas);
  if (renderer) {
    renderer.setImage(entry.bitmap);
    renderer.setLut(lut);
    renderer.render();
  } else {
    caption.textContent = `${entry.name}（WebGL2非対応のためプレビュー不可）`;
  }
  entries.set(entry.id, { entry, renderer });
}

async function addFiles(files: Iterable<File>): Promise<void> {
  const { entries: loaded, skipped } = await loadImageFiles(files);
  for (const entry of loaded) addImage(entry);
  const parts = [`${entries.size} 枚読み込み済み`];
  if (skipped.length > 0) {
    parts.push(`${skipped.length} 件スキップ: ${skipped.join(", ")}`);
  }
  status.textContent = parts.join(" / ");
}

fileInput.addEventListener("change", () => {
  // FileList は input の内容を参照する生きたリストなので、
  // value のクリアより先に配列へ固定する（非同期読み込み中の取りこぼし防止）。
  if (fileInput.files) void addFiles(Array.from(fileInput.files));
  fileInput.value = "";
});

document.getElementById("open")!.addEventListener("click", () => {
  fileInput.click();
});

const dropzone = document.getElementById("dropzone")!;
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragging");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragging");
  if (e.dataTransfer) void addFiles(Array.from(e.dataTransfer.files));
});

window.addEventListener("resize", renderAll);

// アイソレーションの選択範囲をプレビュー上で可視化する（書き出しLUTには含めない）
const maskPreviewBox = document.getElementById(
  "mask-preview",
) as HTMLInputElement;
maskPreviewBox.addEventListener("change", () => {
  maskPreview = maskPreviewBox.checked;
  scheduleRebake();
});

// テーマ切替（選択はlocalStorageへ保存）
const THEME_KEY = "lut-studio:theme";
const themeSelect = document.getElementById(
  "theme-select",
) as HTMLSelectElement;
const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
  themeSelect.value = savedTheme;
}
themeSelect.addEventListener("change", () => {
  document.documentElement.dataset.theme = themeSelect.value;
  localStorage.setItem(THEME_KEY, themeSelect.value);
});

// プレビュー画像の表示サイズ。右ペインは固定幅のまま、
// タイル幅をステージ幅に対する割合（%）で変える。画面サイズ変更にも追従する。
const TILE_KEY = "lut-studio:tile-size";
const tileSize = document.getElementById("tile-size") as HTMLInputElement;
const stage = document.getElementById("stage")!;
const applyTileSize = (pct: number) => {
  const px = Math.round((stage.clientWidth * pct) / 100);
  document.documentElement.style.setProperty("--tile", `${px}px`);
  renderAll();
};
const savedTile = Number(localStorage.getItem(TILE_KEY));
if (savedTile >= 15 && savedTile <= 90) {
  tileSize.value = String(savedTile);
}
applyTileSize(Number(tileSize.value));
tileSize.addEventListener("input", () => {
  const pct = Number(tileSize.value);
  applyTileSize(pct);
  localStorage.setItem(TILE_KEY, String(pct));
});
window.addEventListener("resize", () => applyTileSize(Number(tileSize.value)));

const panel = document.getElementById("panel")!;
createAdjustmentPanel(panel, adjustments, scheduleRebake, requestHuePick);
