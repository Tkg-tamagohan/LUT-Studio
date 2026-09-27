import {
  applyLutToRgba,
  applyPreset,
  bakeLut,
  compileAdjustments,
  detectImageLutLayout,
  hueDegrees,
  imageToLut,
  lutToCube,
  lutToHald,
  lutToReShade,
  neutralAdjustments,
  parseCubeLut,
  presetFromJson,
  presetToJson,
  withBaseLut,
  type ImportedLut,
  type LutData,
  type RgbaImage,
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
/** 読み込んだ外部LUT（仕様決定R・S）。null のときは中立LUT相当。 */
let baseLut: ImportedLut | null = null;
/** ベースLUTセクションとステータスに表示する名前（例: `filmic.cube（33³）`）。 */
let baseLutLabel: string | null = null;
/** ベースLUTの適用強度（%）。0 で未適用、100 でフル適用（仕様決定W）。 */
let lutStrength = 100;
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
      withBaseLut(
        baseLut,
        compileAdjustments(adjustments, { maskPreview }),
        lutStrength / 100,
      ),
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
  return bakeLut(
    size,
    withBaseLut(baseLut, compileAdjustments(adjustments), lutStrength / 100),
  );
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || "image";
}

/** 書き出しLUT名に付けるタイムスタンプ（_yyMMddhhmm、ローカル時刻）。 */
function lutTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `_${String(d.getFullYear()).slice(-2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

async function exportPngLut(kind: "hald" | "reshade"): Promise<void> {
  const exportLut = bakeExportLut(IMAGE_LUT_SIZE);
  const img = kind === "hald" ? lutToHald(exportLut) : lutToReShade(exportLut);
  const blob = await rgbaToPngBlob(img);
  const name = `lut-studio-${kind}${lutTimestamp()}.png`;
  downloadBlob(blob, name);
  status.textContent = `LUTを書き出しました: ${name}`;
}

function exportLutFile(format: LutExportFormat): void {
  if (format === "cube") {
    const cube = lutToCube(bakeExportLut(CUBE_LUT_SIZE));
    const name = `lut-studio${lutTimestamp()}.cube`;
    downloadBlob(new Blob([cube], { type: "text/plain" }), name);
    status.textContent = `LUTを書き出しました: ${name}`;
    return;
  }
  void exportPngLut(format);
}

/** 書き出し済みの画像ファイル名。同名画像があっても出力名が衝突しないよう管理する。 */
const exportedImageNames = new Set<string>();

/**
 * LUTを適用した画像をPNG化して保存する。原則として元ファイルの解像度
 * （仕様決定G）。ただし端末のcanvas上限を超える巨大画像はエラーにならず
 * ラスタが黙って縮小され画質が劣化するため、タッチ中心端末では事前に
 * EXPORT_MAX_SIDE_CONSTRAINED まで縮小し、それでも失敗した場合は
 * 半分ずつ縮小して再試行する（仕様決定Q）。
 */
/**
 * モバイル等のcanvas上限に安全に収める長辺(px)。これを超えるとブラウザが
 * ラスタを黙って縮小し、書き出しが「高解像度だが粗い」になるため。
 */
const EXPORT_MAX_SIDE_CONSTRAINED = 4096;

async function exportImage(
  entry: ImageEntry,
  exportLut: LutData,
): Promise<string> {
  const file = entry.file;
  // 縮小再試行の下限。プレビューに読み込めたサイズまでは必ず試す
  const limit = Math.max(entry.width, entry.height, 1);
  // プレビュー用に縮小済みのbitmapではなく、元ファイルからフル解像度で再デコードする
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // フル解像度のデコード自体がメモリで失敗する環境では読み込み済みサイズに縮小する
    bitmap = await createImageBitmap(file, {
      resizeWidth: entry.width,
      resizeHeight: entry.height,
      resizeQuality: "high",
    });
  }
  // タッチ中心端末ではcanvasの暗黙縮小を防ぐため先に縮小する
  const constrained =
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 640px)").matches;
  // 縮小して書き出したときの出力寸法。成功時のステータスに残す
  let shrunkNote: string | null = null;
  if (
    constrained &&
    Math.max(bitmap.width, bitmap.height) > EXPORT_MAX_SIDE_CONSTRAINED
  ) {
    const scale =
      EXPORT_MAX_SIDE_CONSTRAINED / Math.max(bitmap.width, bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    bitmap.close();
    bitmap = await createImageBitmap(file, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "high",
    });
    shrunkNote = `${w}×${h}に縮小`;
    status.textContent = `${entry.name} は端末のcanvas上限のため ${w}×${h} に縮小して書き出します`;
  }
  try {
    for (;;) {
      const width = bitmap.width;
      const height = bitmap.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("canvasコンテキストを取得できません");
        ctx.drawImage(bitmap, 0, 0);
        const pixels = ctx.getImageData(0, 0, width, height);
        applyLutToRgba(exportLut, pixels.data);
        ctx.putImageData(pixels, 0, 0);
        const blob = await canvasToPngBlob(canvas);
        // エンコード済みのcanvasバッファはすぐ手放し、一括書き出し時のピークを抑える
        canvas.width = 0;
        canvas.height = 0;
        const filename = uniqueImageExportName(
          baseName(entry.name),
          exportedImageNames,
        );
        downloadBlob(blob, filename);
        return shrunkNote ? `${filename}（${shrunkNote}）` : filename;
      } catch (e) {
        canvas.width = 0;
        canvas.height = 0;
        const nextW = Math.floor(width / 2);
        const nextH = Math.floor(height / 2);
        if (Math.max(nextW, nextH) < limit) throw e;
        shrunkNote = `${nextW}×${nextH}に縮小`;
        status.textContent = `${entry.name} はメモリ上限のため ${nextW}×${nextH} に縮小して書き出します`;
        bitmap.close();
        bitmap = await createImageBitmap(file, {
          resizeWidth: nextW,
          resizeHeight: nextH,
          resizeQuality: "high",
        });
      }
    }
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

/** ベースLUTの適用と表示更新。成功時のみ baseLut を差し替える。 */
function setBaseLut(imported: ImportedLut, fileName: string): void {
  baseLut = imported;
  baseLutLabel = `${fileName}（${imported.lut.size}³）`;
  scheduleRebake();
  rebuildPanel();
  status.textContent = `ベースLUTを読み込みました: ${baseLutLabel}`;
}

function clearBaseLut(): void {
  baseLut = null;
  baseLutLabel = null;
  // 解除より前に開始した読み込みが完了後に再適用されないよう世代を進める
  lutLoadGeneration++;
  scheduleRebake();
  rebuildPanel();
  status.textContent = "ベースLUTを解除しました";
}

/** PNGをデコードしてRGBA8バッファにする。色情報がそのままLUTデータになる。 */
async function decodeToRgba(file: File): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvasコンテキストを取得できません");
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    canvas.width = 0;
    canvas.height = 0;
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}

/**
 * 読み込み処理の世代番号。デコード待ちの古い読み込みが、後から選んだファイルや
 * 解除操作を完了時に上書きしないよう、完了時に最新世代だけを適用する。
 */
let lutLoadGeneration = 0;

/**
 * `.cube` またはPNG画像LUTをベースLUTとして読み込む（仕様決定R・T）。
 * エラー時はメッセージを表示し、現在のベースLUTは維持する。
 */
async function loadBaseLutFile(file: File): Promise<void> {
  const gen = ++lutLoadGeneration;
  // 新しい読み込みや解除が先に行われていたら、この結果もエラーも捨てる
  const stale = () => gen !== lutLoadGeneration;
  try {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".cube")) {
      const imported = parseCubeLut(await file.text());
      if (stale()) return;
      setBaseLut(imported, file.name);
      return;
    }
    if (lower.endsWith(".png") || file.type === "image/png") {
      let img: RgbaImage;
      try {
        img = await decodeToRgba(file);
      } catch {
        throw new Error("PNGのデコードに失敗しました");
      }
      if (stale()) return;
      const layout = detectImageLutLayout(img.width, img.height);
      if (layout === null) {
        throw new Error(
          `画像の寸法（${img.width}×${img.height}）がHaldCLUT・ReShadeのいずれの署名にも合いません`,
        );
      }
      setBaseLut(
        {
          lut: imageToLut(img, layout),
          domainMin: [0, 0, 0],
          domainMax: [1, 1, 1],
        },
        file.name,
      );
      return;
    }
    throw new Error("対応していない形式です（.cube またはPNG画像LUTのみ）");
  } catch (e) {
    if (stale()) return;
    status.textContent = `LUTの読み込みに失敗: ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
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
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-image";
  deleteButton.textContent = "✕";
  deleteButton.title = "この画像を削除";
  captionRow.append(captionName, exportButton, deleteButton);
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
  deleteButton.addEventListener("click", () => {
    renderer?.dispose();
    entry.bitmap.close();
    entries.delete(entry.id);
    figure.remove();
    updateStatus();
  });
}

/** 拡張子 `.cube`（大小不問）のみをLUTとして振り分ける（仕様決定T）。 */
function isCubeFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".cube");
}

async function addFiles(files: Iterable<File>): Promise<void> {
  const list = Array.from(files);
  const cubeFiles = list.filter(isCubeFile);
  const imageFiles = list.filter((f) => !isCubeFile(f));
  const parts: string[] = [];
  if (imageFiles.length > 0) {
    const { entries: loaded, skipped } = await loadImageFiles(imageFiles);
    for (const entry of loaded) addImage(entry);
    parts.push(`${entries.size} 枚読み込み済み`);
    if (skipped.length > 0) {
      parts.push(`${skipped.length} 件スキップ: ${skipped.join(", ")}`);
    }
  }
  // 複数の .cube が混在する場合は最後のものが有効（後勝ち）
  for (const file of cubeFiles) {
    await loadBaseLutFile(file);
    parts.push(status.textContent ?? "");
  }
  if (parts.length > 0) status.textContent = parts.join(" / ");
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
    loadLut: (file) => void loadBaseLutFile(file),
    clearLut: clearBaseLut,
    baseLutLabel: () => baseLutLabel,
    lutStrength: () => lutStrength,
    setLutStrength: (v) => {
      lutStrength = Math.min(100, Math.max(0, Math.round(v)));
      scheduleRebake();
    },
  },
);
