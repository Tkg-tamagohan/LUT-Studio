import { clamp01, lutIndex, type LutData } from "./lut";
import type { ImportedLut } from "./compose-lut";

/** `.cube` の LUT_3D_SIZE の許容範囲（仕様決定R）。 */
const MIN_SIZE = 2;
const MAX_SIZE = 256;

function fail(reason: string, lineNo?: number): never {
  const at = lineNo === undefined ? "" : `（${lineNo} 行目）`;
  throw new Error(`.cube の形式が不正です${at}: ${reason}`);
}

function parseVec3(
  tokens: string[],
  lineNo: number,
): [number, number, number] {
  if (tokens.length !== 3) {
    fail(`数値3要素が必要です`, lineNo);
  }
  const v = tokens.map((t) => Number(t));
  if (!v.every((x) => Number.isFinite(x))) {
    fail(`数値以外のトークンを含みます`, lineNo);
  }
  return [v[0], v[1], v[2]];
}

/**
 * `.cube` テキスト（Iridas/Adobeの3D LUT）を解析して ImportedLut を返す。
 * データ行は赤を最速・青を最遅とする `.cube` 規約で並ぶため、
 * 内部表現（青最速の lutIndex）へ軸順を写し替える。
 * 1Dシェーパー（LUT_1D_SIZE）を含むファイルは意図と異なる色になるため拒否する。
 */
export function parseCubeLut(text: string): ImportedLut {
  let size: number | null = null;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  // データ行の値を行順に並べたフラット配列（3要素ずつ）
  const values: number[] = [];

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/);
    const head = tokens[0];

    if (head === "TITLE") {
      // キーワード以降をそのままタイトルとし、両端の引用符は外す
      const rest = line.slice("TITLE".length).trim();
      title = rest.replace(/^"(.*)"$/s, "$1");
      continue;
    }
    if (head === "LUT_1D_SIZE") {
      fail("LUT_1D_SIZE を含むファイルは読み込めません", lineNo);
    }
    if (head === "LUT_3D_SIZE") {
      if (size !== null) {
        fail("LUT_3D_SIZE が複数あります", lineNo);
      }
      if (tokens.length !== 2) {
        fail("LUT_3D_SIZE は整数1つを取ります", lineNo);
      }
      const n = Number(tokens[1]);
      if (!Number.isInteger(n)) {
        fail(`LUT_3D_SIZE が整数ではありません: ${tokens[1]}`, lineNo);
      }
      if (n < MIN_SIZE || n > MAX_SIZE) {
        fail(
          `LUT_3D_SIZE が範囲外です（${MIN_SIZE}〜${MAX_SIZE}）: ${n}`,
          lineNo,
        );
      }
      size = n;
      continue;
    }
    if (head === "DOMAIN_MIN" || head === "DOMAIN_MAX") {
      const v = parseVec3(tokens.slice(1), lineNo);
      if (head === "DOMAIN_MIN") domainMin = v;
      else domainMax = v;
      continue;
    }

    const v = parseVec3(tokens, lineNo);
    values.push(v[0], v[1], v[2]);
  }

  if (size === null) {
    fail("LUT_3D_SIZE がありません");
  }
  const expected = size * size * size;
  if (values.length !== expected * 3) {
    fail(
      `データ行数が一致しません（期待 ${expected} 行、実際 ${values.length / 3} 行）`,
    );
  }
  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c] > domainMin[c])) {
      fail(
        `ドメインがゼロ幅または逆転しています（成分${"RGB"[c]}: ${domainMin[c]}〜${domainMax[c]}）`,
      );
    }
  }

  const data = new Float32Array(expected * 3);
  for (let k = 0; k < expected; k++) {
    const r = k % size;
    const g = Math.floor(k / size) % size;
    const b = Math.floor(k / (size * size));
    const dst = lutIndex(size, r, g, b);
    data[dst] = clamp01(values[k * 3]);
    data[dst + 1] = clamp01(values[k * 3 + 1]);
    data[dst + 2] = clamp01(values[k * 3 + 2]);
  }
  const lut: LutData = { size, data };
  return { lut, title, domainMin, domainMax };
}
