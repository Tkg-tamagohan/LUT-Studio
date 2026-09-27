/**
 * RGBの3次元LUT。
 * data は入力 (r, g, b) に対する出力色を、青を最速・赤を最遅とする順序
 * （.cube 形式と同じインデックス順）で格納する。
 */
export interface LutData {
  /** 各軸の格子点数。 */
  size: number;
  /** 長さ size³×3 のフラット配列。 */
  data: Float32Array;
}

export function lutIndex(size: number, r: number, g: number, b: number): number {
  return ((r * size + g) * size + b) * 3;
}

/** すべての入力色をそのまま出力する恒等LUTを生成する。 */
export function createNeutralLut(size: number): LutData {
  const data = new Float32Array(size * size * size * 3);
  const max = size - 1;
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const i = lutIndex(size, r, g, b);
        data[i] = r / max;
        data[i + 1] = g / max;
        data[i + 2] = b / max;
      }
    }
  }
  return { size, data };
}

/** 正規化入力色を受け取り、出力色を out（長さ3）へ書き込む変換。 */
export type ColorTransform = (
  r: number,
  g: number,
  b: number,
  out: Float32Array,
) => void;

/** 中立LUTに変換を適用し、結果を焼き付けたLUTを生成する。 */
export function bakeLut(size: number, transform: ColorTransform): LutData {
  const lut = createNeutralLut(size);
  const tmp = new Float32Array(3);
  for (let i = 0; i < lut.data.length; i += 3) {
    transform(lut.data[i], lut.data[i + 1], lut.data[i + 2], tmp);
    lut.data[i] = tmp[0];
    lut.data[i + 1] = tmp[1];
    lut.data[i + 2] = tmp[2];
  }
  return lut;
}

/**
 * 最近傍格子点でLUTを引く。プレビュー描画はシェーダで3線形補間するため、
 * この関数はエンジン内の参照・テスト用途とする。
 */
export function sampleLut(
  lut: LutData,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const max = lut.size - 1;
  const ri = Math.round(clamp01(r) * max);
  const gi = Math.round(clamp01(g) * max);
  const bi = Math.round(clamp01(b) * max);
  const i = lutIndex(lut.size, ri, gi, bi);
  return [lut.data[i], lut.data[i + 1], lut.data[i + 2]];
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
