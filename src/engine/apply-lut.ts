import { clamp01, lutIndex, type LutData } from "./lut";

/**
 * 三線形補間でLUTを引き、結果を out（長さ3）へ書き込む。
 * プレビュー描画の3Dテクスチャ線形補間と同等の品質で、
 * LUT適用済み画像の書き出し（仕様決定G）に使う。
 */
export function sampleLutTrilinear(
  lut: LutData,
  r: number,
  g: number,
  b: number,
  out: Float32Array,
): void {
  const size = lut.size;
  const max = size - 1;
  const rp = clamp01(r) * max;
  const gp = clamp01(g) * max;
  const bp = clamp01(b) * max;
  const r0 = Math.floor(rp);
  const g0 = Math.floor(gp);
  const b0 = Math.floor(bp);
  const r1 = Math.min(r0 + 1, max);
  const g1 = Math.min(g0 + 1, max);
  const b1 = Math.min(b0 + 1, max);
  const tr = rp - r0;
  const tg = gp - g0;
  const tb = bp - b0;
  const i000 = lutIndex(size, r0, g0, b0);
  const i001 = lutIndex(size, r0, g0, b1);
  const i010 = lutIndex(size, r0, g1, b0);
  const i011 = lutIndex(size, r0, g1, b1);
  const i100 = lutIndex(size, r1, g0, b0);
  const i101 = lutIndex(size, r1, g0, b1);
  const i110 = lutIndex(size, r1, g1, b0);
  const i111 = lutIndex(size, r1, g1, b1);
  for (let c = 0; c < 3; c++) {
    const v00 =
      lut.data[i000 + c] * (1 - tr) + lut.data[i100 + c] * tr;
    const v01 =
      lut.data[i001 + c] * (1 - tr) + lut.data[i101 + c] * tr;
    const v10 =
      lut.data[i010 + c] * (1 - tr) + lut.data[i110 + c] * tr;
    const v11 =
      lut.data[i011 + c] * (1 - tr) + lut.data[i111 + c] * tr;
    const v0 = v00 * (1 - tg) + v10 * tg;
    const v1 = v01 * (1 - tg) + v11 * tg;
    out[c] = v0 * (1 - tb) + v1 * tb;
  }
}

/**
 * RGBA8の画素列へLUTを適用する。アルファチャネルは保持する。
 * 画素値を0〜1へ正規化して引き、結果は0〜255へ丸めて書き戻す。
 */
export function applyLutToRgba(
  lut: LutData,
  pixels: Uint8ClampedArray,
): void {
  const out = new Float32Array(3);
  for (let i = 0; i < pixels.length; i += 4) {
    sampleLutTrilinear(
      lut,
      pixels[i] / 255,
      pixels[i + 1] / 255,
      pixels[i + 2] / 255,
      out,
    );
    pixels[i] = Math.round(clamp01(out[0]) * 255);
    pixels[i + 1] = Math.round(clamp01(out[1]) * 255);
    pixels[i + 2] = Math.round(clamp01(out[2]) * 255);
  }
}
