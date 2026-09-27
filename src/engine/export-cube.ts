import { clamp01, lutIndex, type LutData } from "./lut";

/**
 * `.cube` 形式（Iridas/Adobeの3D LUTテキスト）に変換する。
 * `.cube` のデータ行は赤を最速・青を最遅に列挙する規約であり、
 * LUT内部配列（青最速）とは順序が異なるため、ここで走査順を変換する。
 */
export function lutToCube(lut: LutData, title = "LUT-Studio"): string {
  const lines: string[] = [
    `TITLE "${title}"`,
    `LUT_3D_SIZE ${lut.size}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
  ];
  for (let b = 0; b < lut.size; b++) {
    for (let g = 0; g < lut.size; g++) {
      for (let r = 0; r < lut.size; r++) {
        const i = lutIndex(lut.size, r, g, b);
        lines.push(
          `${fmt(lut.data[i])} ${fmt(lut.data[i + 1])} ${fmt(lut.data[i + 2])}`,
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

function fmt(v: number): string {
  return clamp01(v).toFixed(6);
}
