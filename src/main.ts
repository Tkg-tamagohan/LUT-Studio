import {
  applyLutToRgba,
  applyPreset,
  bakeLut,
  compileAdjustments,
  hueDegrees,
  lutToCube,
  lutToHald,
  lutToReShade,
  neutralAdjustments,
  presetFromJson,
  presetToJson,
  type LutData,
} from "./engine";
import {
  createRenderer,
  loadImageFiles,
  type ImageEntry,
  type PreviewRenderer,
} from "./preview";
import {
  createAdjustmentPanel,
  type LutExportFormat,
} from "./ui/panel";
import {
  canvasToPngBlob,
  downloadBlob,
  rgbaToPngBlob,
  uniqueImageExportName,
} from "./ui/export";

/** プレビュー用LUTのサイズ。書き出しPNGアトラスと同じ64（仕様決定D）。 */
const PREVIEW_LUT_SIZE = 64;
/** `.cube` 書き出しのLUTサイズ（仕様決定D）。 */
const CUBE_LUT_SIZE = 33;
/** LUT適用済み画像の書き出しに使うLUTサイズ。プレビューと同じ64で見た目を揃える。 */
const IMAGE_LUT_SIZE = 64;

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

/**
 * 書き出し用にLUTを焼く。マスクプレビュー（選択範囲の可視化）は
 * 書き出し物に含めないため、プレビュー用lutとは別にクリーンな状態で焼き直す。
 */
function bakeExportLut(size: number): LutData {
  return bakeLut(size, compileAdjustments(adjustments));
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || "image";
}

async function exportPngLut(kind: "hald" | "reshade"): Promise<void> {
  const exportLut = bakeExportLut(IMAGE_LUT_SIZE);
  const img = kind === "hald" ? lutToHald(exportLut) : lutToReShade(exportLut);
  const blob = await rgbaToPngBlob(img);
  const name = `lut-studio-${kind}.png`;
  downloadBlob(blob, name);
  status.textContent = `LUTを書き出しました: ${name}`;
}

function exportLutFile(format: LutExportFormat): void {
  if (format === "cube") {
    const cube = lutToCube(bakeExportLut(CUBE_LUT_SIZE));
    downloadBlob(new Blob([cube], { type: "text/plain" }), "lut-studio.cube");
    status.textContent = "LUTを書き出しました: lut-studio.cube";
    return;
  }
  void exportPngLut(format);
}

/** 書き出し済みの画像ファイル名。同名画像があっても出力名が衝突しないよう管理する。 */
const exportedImageNames = new Set<string>();

/** LUTを適用した画像を元ファイルの解像度でPNG化して保存する（仕様決定G）。 */
async function exportImage(
  entry: ImageEntry,
  exportLut: LutData,
): Promise<string> {
  // プレビュー用に縮小済みのbitmapではなく、元ファイルからフル解像度で再デコードする
  const bitmap = await createImageBitmap(entry.file);
  const width = bitmap.width;
  const height = bitmap.height;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvasコンテキストを取得できません");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    {
      const pixels = ctx.getImageData(0, 0, width, height);
      applyLutToRgba(exportLut, pixels.data);
      ctx.putImageData(pixels, 0, 0);
    }
    const blob = await canvasToPngBlob(canvas);
    // エンコード済みのcanvasバッファはすぐ手放し、一括書き出し時のピークを抑える
    canvas.width = 0;
    canvas.height = 0;
    const filename = uniqueImageExportName(baseName(entry.name), exportedImageNames);
    downloadBlob(blob, filename);
    return filename;
  } finally {
    bitmap.close();
  }
}

async function exportAllImages(): Promise<void> {
  if (entries.size === 0) {
    status.textContent = "書き出す画像がありません";
    return;
  }
  const exportLut = bakeExportLut(IMAGE_LUT_SIZE);
  let done = 0;
  let failed = 0;
  for (const { entry } of entries.values()) {
    try {
      await exportImage(entry, exportLut);
      done++;
    } catch {
      failed++;
    }
    status.textContent = `画像を書き出し中… ${done + failed}/${entries.size}`;
  }
  status.textContent =
    failed > 0
      ? `${done} 枚書き出し / ${failed} 件失敗`
      : `${done} 枚の画像を書き出しました`;
}

function savePresetFile(): void {
  const blob = new Blob([presetToJson(adjustments)], {
    type: "application/json",
  });
  downloadBlob(blob, "lut-studio-preset.json");
  status.textContent = "プリセットを保存しました: lut-studio-preset.json";
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
  const captionRow = document.createElement("div");
  captionRow.className = "caption-row";
  const captionName = document.createElement("span");
  captionName.className = "caption-name";
  // CSSのellipsisが末尾を切るため、拡張子を別要素に分けて末尾に残す
  const dotIndex = entry.name.lastIndexOf(".");
  const captionStem = document.createElement("span");
  captionStem.className = "caption-stem";
  captionStem.textContent =
    dotIndex > 0 ? entry.name.slice(0, dotIndex) : entry.name;
  captionName.appendChild(captionStem);
  if (dotIndex > 0) {
    const captionExt = document.createElement("span");
    captionExt.className = "caption-ext";
    captionExt.textContent = entry.name.slice(dotIndex);
    captionName.appendChild(captionExt);
  }
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "PNG";
  exportButton.title = "LUT適用済みをPNGで書き出し";
  exportButton.addEventListener("click", () => {
    status.textContent = `${entry.name} を書き出し中…`;
    void exportImage(entry, bakeExportLut(IMAGE_LUT_SIZE))
      .then((filename) => {
        status.textContent = `書き出しました: ${filename}`;
      })
      .catch(() => {
        status.textContent = `書き出しに失敗しました: ${entry.name}`;
      });
  });
  captionRow.append(captionName, exportButton);
  caption.appendChild(captionRow);
  figure.append(canvas, caption);
  grid.appendChild(figure);

  const renderer = createRenderer(canvas);
  if (renderer) {
    renderer.setImage(entry.bitmap);
    renderer.setLut(lut);
    renderer.render();
    // 原画比較：キャンバスを押している間はLUTを通さず原画を表示する
    // （スポイトの色相拾いモード中は比較を優先させない）
    canvas.addEventListener("pointerdown", (e) => {
      if (pickCallback || e.button !== 0) return;
      renderer.setBypass(true);
      renderer.render();
    });
    const release = () => {
      renderer.setBypass(false);
      renderer.render();
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", release);
  } else {
    captionName.textContent = `${entry.name}（WebGL非対応のためプレビュー不可）`;
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
} else if (window.matchMedia("(max-width: 640px)").matches) {
  // スマホ版では1枚ずつ大きく見る用途を優先し、既定を最大(90%)とする
  tileSize.value = "90";
}
applyTileSize(Number(tileSize.value));
tileSize.addEventListener("input", () => {
  const pct = Number(tileSize.value);
  applyTileSize(pct);
  localStorage.setItem(TILE_KEY, String(pct));
});
window.addEventListener("resize", () => applyTileSize(Number(tileSize.value)));

async function loadPresetFile(file: File): Promise<void> {
  try {
    const preset = presetFromJson(await file.text());
    applyPreset(adjustments, preset);
    rebuildPanel();
    scheduleRebake();
    status.textContent = `プリセットを読み込みました: ${file.name}`;
  } catch (e) {
    status.textContent = `プリセットの読み込みに失敗: ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
}

const panel = document.getElementById("panel")!;
const rebuildPanel = createAdjustmentPanel(
  panel,
  adjustments,
  scheduleRebake,
  requestHuePick,
  {
    exportLut: exportLutFile,
    exportImages: () => void exportAllImages(),
    savePreset: savePresetFile,
    loadPreset: (file) => void loadPresetFile(file),
  },
);
