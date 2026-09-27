import {
  bakeLut,
  compileAdjustments,
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

/** スライダ変更を受けてLUTを再焼き付けし、全画像を再描画する。連続入力はrAFでまとめる。 */
function scheduleRebake(): void {
  if (bakeScheduled) return;
  bakeScheduled = true;
  requestAnimationFrame(() => {
    bakeScheduled = false;
    lut = bakeLut(PREVIEW_LUT_SIZE, compileAdjustments(adjustments));
    for (const { renderer } of entries.values()) {
      renderer?.setLut(lut);
      renderer?.render();
    }
  });
}

function renderAll(): void {
  for (const { renderer } of entries.values()) renderer?.render();
}

function addImage(entry: ImageEntry): void {
  const figure = document.createElement("figure");
  figure.className = "preview-card";
  const canvas = document.createElement("canvas");
  canvas.className = "preview-canvas";
  canvas.style.aspectRatio = `${entry.width} / ${entry.height}`;
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
  if (fileInput.files) void addFiles(fileInput.files);
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
  if (e.dataTransfer) void addFiles(e.dataTransfer.files);
});

window.addEventListener("resize", renderAll);

const panel = document.getElementById("panel")!;
createAdjustmentPanel(panel, adjustments, scheduleRebake);
