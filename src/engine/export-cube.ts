import { clamp01, type LutData } from "./lut";

/**
 * `.cube` 形式（Iridas/Adobeの3D LUTテキスト）に変換する。
 * データ行は青を最速に進める順で書き出す（LUT内部配列と同じ順序）。
 */
export function lutToCube(lut: LutData, title = "LUT-Studio"): string {
  const lines: string[] = [
    `TITLE "${title}"`,
    `LUT_3D_SIZE ${lut.size}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
  ];
  for (let i = 0; i < lut.data.length; i += 3) {
    lines.push(
      `${fmt(lut.data[i])} ${fmt(lut.data[i + 1])} ${fmt(lut.data[i + 2])}`,
    );
  }
  return lines.join("\n") + "\n";
}

function fmt(v: number): string {
  return clamp01(v).toFixed(6);
}
