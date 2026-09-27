import { clamp01, type ColorTransform, type LutData } from "./lut";
import { sampleLutTrilinear } from "./apply-lut";

/**
 * 外部から読み込んだLUT（仕様決定R）。中立LUTの代わりとなるベースLUTとして
 * 保持し、調整の前段に合成する（仕様決定S）。
 */
export interface ImportedLut {
  lut: LutData;
  /** .cube の TITLE。PNG由来は undefined。 */
  title?: string;
  /** 入力ドメインの下限。既定は (0,0,0)。 */
  domainMin: [number, number, number];
  /** 入力ドメインの上限。既定は (1,1,1)。 */
  domainMax: [number, number, number];
}

/**
 * ベースLUTを変換の前段に合成する。出力は `next(base(入力))` の順になる。
 * `base` が null のときは `next` をそのまま返し、既存の中立LUT経路と等価になる。
 * 入力色はドメインで正規化してからベースLUTを三線形補間で引くため、
 * サイズの違いはサンプリングが吸収する（仕様決定U）。
 *
 * `strength`（0〜1、既定1）はベースLUTの適用強度。出力は
 * `入力 + strength × (base(入力) − 入力)` の線形補間になり、
 * 0 で未適用（`next` 直通）、1 でフル適用になる（仕様決定W）。
 */
export function withBaseLut(
  base: ImportedLut | null,
  next: ColorTransform,
  strength = 1,
): ColorTransform {
  if (base === null || strength <= 0) return next;
  const { lut, domainMin, domainMax } = base;
  const tmp = new Float32Array(3);
  if (strength >= 1) {
    return (r, g, b, out) => {
      const ur = clamp01((r - domainMin[0]) / (domainMax[0] - domainMin[0]));
      const ug = clamp01((g - domainMin[1]) / (domainMax[1] - domainMin[1]));
      const ub = clamp01((b - domainMin[2]) / (domainMax[2] - domainMin[2]));
      sampleLutTrilinear(lut, ur, ug, ub, tmp);
      next(tmp[0], tmp[1], tmp[2], out);
    };
  }
  return (r, g, b, out) => {
    const ur = clamp01((r - domainMin[0]) / (domainMax[0] - domainMin[0]));
    const ug = clamp01((g - domainMin[1]) / (domainMax[1] - domainMin[1]));
    const ub = clamp01((b - domainMin[2]) / (domainMax[2] - domainMin[2]));
    sampleLutTrilinear(lut, ur, ug, ub, tmp);
    // 未適用側はドメイン正規化前の元入力に対する補間（0% で画像を素通しにするため）
    next(
      r + strength * (tmp[0] - r),
      g + strength * (tmp[1] - g),
      b + strength * (tmp[2] - b),
      out,
    );
  };
}
