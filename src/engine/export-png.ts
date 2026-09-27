import { clamp01, lutIndex, type LutData } from "./lut";

/** RGBA8の画像バッファ。PNGエンコードはUI側でcanvas経由で行う。 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * HaldCLUT形式に変換する（仕様決定J）。
 * レベルLのHald CLUTは L³×L³ ピクセルの正方形画像で、LUTサイズは L²。
 * 画素は行優先の連番で、赤を最遅・青を最速に入力色が割り当てられる。
 * LUTサイズの平方根が整数でない場合は生成できないためエラーとする。
 */
export function lutToHald(lut: LutData): RgbaImage {
  const level = Math.round(Math.sqrt(lut.size));
  if (level * level !== lut.size) {
    throw new Error(
      `HaldCLUTにはLUTサイズの平方根が整数である必要があります: ${lut.size}`,
    );
  }
  const dim = level * level * level;
  const pixels = dim * dim;
  const data = new Uint8ClampedArray(pixels * 4);
  const levelSq = level * level;
  for (let i = 0; i < pixels; i++) {
    const r = Math.floor(i / (levelSq * levelSq));
    const g = Math.floor(i / levelSq) % levelSq;
    const b = i % levelSq;
    const src = lutIndex(lut.size, r, g, b);
    const dst = i * 4;
    data[dst] = to8bit(lut.data[src]);
    data[dst + 1] = to8bit(lut.data[src + 1]);
    data[dst + 2] = to8bit(lut.data[src + 2]);
    data[dst + 3] = 255;
  }
  return { width: dim, height: dim, data };
}

/**
 * ReShade形式に変換する（仕様決定J）。
 * 幅 size²・高さ size の横長画像で、タイルが青軸、タイル内のxが緑軸、yが赤軸。
 */
export function lutToReShade(lut: LutData): RgbaImage {
  const size = lut.size;
  const width = size * size;
  const height = size;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = Math.floor(x / size);
      const g = x % size;
      const r = y;
      const src = lutIndex(size, r, g, b);
      const dst = (y * width + x) * 4;
      data[dst] = to8bit(lut.data[src]);
      data[dst + 1] = to8bit(lut.data[src + 1]);
      data[dst + 2] = to8bit(lut.data[src + 2]);
      data[dst + 3] = 255;
    }
  }
  return { width, height, data };
}

function to8bit(v: number): number {
  return Math.round(clamp01(v) * 255);
}
