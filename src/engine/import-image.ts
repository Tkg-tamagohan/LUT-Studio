import { lutIndex, type LutData } from "./lut";
import type { RgbaImage } from "./export-png";

/** PNG画像LUTの配置形式（仕様決定J・R）。 */
export type ImageLutLayout = "hald" | "reshade";

function fail(reason: string): never {
  throw new Error(`画像LUTの形式が不正です: ${reason}`);
}

/**
 * 画像の寸法署名から画像LUTのレイアウトを判別する。
 * 正方形かつ一辺が L³（L≥2）なら HaldCLUT（LUTサイズは L²）、
 * 幅が高さの平方（size²×size）で高さ≥2なら ReShade（LUTサイズは高さ）。
 * 両方を満たすのは縮退した 1×1 のみで、サイズ下限により除外される。
 * いずれの署名にも合わない場合は null を返す。
 */
export function detectImageLutLayout(
  width: number,
  height: number,
): ImageLutLayout | null {
  if (width === height) {
    const level = Math.round(Math.cbrt(width));
    if (level >= 2 && level * level * level === width) return "hald";
    return null;
  }
  if (height >= 2 && width === height * height) return "reshade";
  return null;
}

function requireOpaque(img: RgbaImage): void {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== 255) {
      fail(
        `不透明でない画素が含まれています（${Math.floor(i / 4)} 番目の画素）。` +
          "canvas 経由のデコードでは透明画素のRGBを復元できないため、画像LUTは不透明なPNGのみ対応です",
      );
    }
  }
}

/** HaldCLUT（L³×L³ 正方形）を LutData に戻す。lutToHald の逆写像。 */
function haldToLut(img: RgbaImage): LutData {
  const level = Math.round(Math.cbrt(img.width));
  const size = level * level;
  const levelSq = level * level;
  const data = new Float32Array(size * size * size * 3);
  const pixels = img.width * img.width;
  for (let i = 0; i < pixels; i++) {
    const r = i % levelSq;
    const g = Math.floor(i / levelSq) % levelSq;
    const b = Math.floor(i / (levelSq * levelSq));
    const src = i * 4;
    const dst = lutIndex(size, r, g, b);
    data[dst] = img.data[src] / 255;
    data[dst + 1] = img.data[src + 1] / 255;
    data[dst + 2] = img.data[src + 2] / 255;
  }
  return { size, data };
}

/** ReShade（size²×size 横長）を LutData に戻す。lutToReShade の逆写像。 */
function reshadeToLut(img: RgbaImage): LutData {
  const size = img.height;
  const data = new Float32Array(size * size * size * 3);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const b = Math.floor(x / size);
      const r = x % size;
      const g = y;
      const src = (y * img.width + x) * 4;
      const dst = lutIndex(size, r, g, b);
      data[dst] = img.data[src] / 255;
      data[dst + 1] = img.data[src + 1] / 255;
      data[dst + 2] = img.data[src + 2] / 255;
    }
  }
  return { size, data };
}

/**
 * デコード済みの RGBA8 画像を指定レイアウトの LutData に変換する。
 * 画素値は 8bit を 0〜1 に割り戻すため、往復では ±1/255 の量子化誤差を含む。
 * 寸法が layout の署名に合わない場合、および不透明でない画素を含む場合はエラー。
 */
export function imageToLut(img: RgbaImage, layout: ImageLutLayout): LutData {
  const actual = detectImageLutLayout(img.width, img.height);
  if (actual !== layout) {
    fail(`画像の寸法（${img.width}×${img.height}）がレイアウト ${layout} の署名に合いません`);
  }
  requireOpaque(img);
  return layout === "hald" ? haldToLut(img) : reshadeToLut(img);
}
