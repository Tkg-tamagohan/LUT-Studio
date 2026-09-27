import { describe, expect, it } from "vitest";
import {
  bakeLut,
  compileAdjustments,
  createNeutralLut,
  detectImageLutLayout,
  imageToLut,
  lutIndex,
  lutToCube,
  lutToHald,
  lutToReShade,
  neutralAdjustments,
  parseCubeLut,
  sampleLutTrilinear,
  withBaseLut,
  type ImportedLut,
  type LutData,
} from "../src/engine";

/**
 * 軸の入れ替わりを検出できるよう、チャネルを巡回する非対称LUTを作る。
 * 出力 = (b, r, g)。
 */
function permutedLut(size: number): LutData {
  return bakeLut(size, (r, g, b, out) => {
    out[0] = b;
    out[1] = r;
    out[2] = g;
  });
}

/** size=2 の最小 `.cube`。データ行は赤最速・青最遅の規約で恒等写像を並べる。 */
const MINIMAL_CUBE = [
  "LUT_3D_SIZE 2",
  "0 0 0",
  "1 0 0",
  "0 1 0",
  "1 1 0",
  "0 0 1",
  "1 0 1",
  "0 1 1",
  "1 1 1",
].join("\n");

function lutDiffMax(a: LutData, b: LutData): number {
  let max = 0;
  for (let i = 0; i < a.data.length; i++) {
    max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
  }
  return max;
}

function imported(
  lut: LutData,
  domainMin: [number, number, number] = [0, 0, 0],
  domainMax: [number, number, number] = [1, 1, 1],
): ImportedLut {
  return { lut, domainMin, domainMax };
}

/** 焼き付けLUTのノード番号から入力格子座標（0〜1）を復元する。青最速・赤最遅。 */
function bakedGrid(size: number, node: number, channel: number): number {
  const b = node % size;
  const g = Math.floor(node / size) % size;
  const r = Math.floor(node / (size * size));
  return [r, g, b][channel] / (size - 1);
}

describe("IMP-01: 最小限の .cube を解析できる", () => {
  it("size=2・データ8行が読める", () => {
    const { lut } = parseCubeLut(MINIMAL_CUBE);
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(8 * 3);
    // 行 k の入力格子は (r=k%size, g=⌊k/size⌋%size, b=⌊k/size²⌋)
    for (let k = 0; k < 8; k++) {
      const r = k % 2;
      const g = Math.floor(k / 2) % 2;
      const b = Math.floor(k / 4);
      const i = lutIndex(2, r, g, b);
      expect(lut.data[i]).toBe(r);
      expect(lut.data[i + 1]).toBe(g);
      expect(lut.data[i + 2]).toBe(b);
    }
  });
});

describe("IMP-02: 軸順を正しく内部表現へ変換する", () => {
  it("非対称LUTを .cube 経由で読み戻すと全格子一致する", () => {
    const original = permutedLut(17);
    const text = lutToCube(original);
    const { lut } = parseCubeLut(text);
    expect(lut.size).toBe(17);
    // 書き出し精度は小数6桁なので 1e-5 以内で一致
    expect(lutDiffMax(lut, original)).toBeLessThan(1e-5);
  });
});

describe("IMP-03: コメント・空行・改行コード・空白を許容する", () => {
  it("装飾を混ぜても IMP-01 と同じ LutData が得られる", () => {
    const decorated = [
      "# コメント行",
      "",
      "   LUT_3D_SIZE\t2  ",
      "\t0\t0\t0",
      " 1 0 0",
      "",
      "# データ途中のコメント",
      "0 1 0",
      "1 1 0",
      "0 0 1",
      "1 0 1",
      "0 1 1",
      "1 1 1",
    ].join("\r\n");
    const { lut } = parseCubeLut(decorated);
    expect(lut.data).toEqual(parseCubeLut(MINIMAL_CUBE).lut.data);
  });
});

describe("IMP-04: LUT_3D_SIZE 必須と範囲を検査する", () => {
  it("キーワード欠落はエラー", () => {
    const noSize = MINIMAL_CUBE.split("\n").slice(1).join("\n");
    expect(() => parseCubeLut(noSize)).toThrow(/LUT_3D_SIZE/);
  });
  it.each([1, 257])("size=%i はエラー", (n) => {
    const text = MINIMAL_CUBE.replace("LUT_3D_SIZE 2", `LUT_3D_SIZE ${n}`);
    expect(() => parseCubeLut(text)).toThrow();
  });
  it("非整数（33.5）はエラー", () => {
    const text = MINIMAL_CUBE.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 33.5");
    expect(() => parseCubeLut(text)).toThrow();
  });
});

describe("IMP-05: データ行の個数と数値性を検査する", () => {
  it("行数不足はエラー", () => {
    const text = MINIMAL_CUBE.split("\n").slice(0, -1).join("\n");
    expect(() => parseCubeLut(text)).toThrow(/行数/);
  });
  it("行数超過はエラー", () => {
    expect(() => parseCubeLut(MINIMAL_CUBE + "\n0 0 0")).toThrow(/行数/);
  });
  it("数値以外のトークンは行番号付きエラー", () => {
    const text = MINIMAL_CUBE.replace("0 1 0\n1 1 0", "0 x 0\n1 1 0");
    expect(() => parseCubeLut(text)).toThrow(/行目/);
  });
  it("2要素だけの行はエラー", () => {
    const text = MINIMAL_CUBE.replace("0 1 0\n1 1 0", "0 1\n1 1 0");
    expect(() => parseCubeLut(text)).toThrow();
  });
});

describe("IMP-06: LUT_1D_SIZE を含む入力を拒否する", () => {
  it("1Dのみはエラー", () => {
    expect(() =>
      parseCubeLut("LUT_1D_SIZE 256\n0 0 0\n1 1 1"),
    ).toThrow(/LUT_1D_SIZE/);
  });
  it("1D+3D併記もエラー", () => {
    const text = "LUT_1D_SIZE 256\n" + MINIMAL_CUBE;
    expect(() => parseCubeLut(text)).toThrow(/LUT_1D_SIZE/);
  });
});

describe("IMP-07: DOMAIN_MIN/DOMAIN_MAX を保持する", () => {
  it("指定値が読み取れる", () => {
    const text = "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n" +
      MINIMAL_CUBE.split("\n").slice(1).join("\n");
    const { domainMin, domainMax } = parseCubeLut(text);
    expect(domainMin).toEqual([0, 0, 0]);
    expect(domainMax).toEqual([2, 2, 2]);
  });
  it("省略時は (0,0,0)〜(1,1,1)", () => {
    const { domainMin, domainMax } = parseCubeLut(MINIMAL_CUBE);
    expect(domainMin).toEqual([0, 0, 0]);
    expect(domainMax).toEqual([1, 1, 1]);
  });
});

describe("IMP-08: 値の範囲外はクランプする", () => {
  it("負値と 1.0 超は 0〜1 にクランプされる", () => {
    const text = MINIMAL_CUBE.replace("0 0 0", "-0.5 0 0").replace(
      "1 1 1",
      "1.5 1 1",
    );
    const { lut } = parseCubeLut(text);
    expect(lut.data[lutIndex(2, 0, 0, 0)]).toBe(0);
    expect(lut.data[lutIndex(2, 1, 1, 1)]).toBe(1);
  });
});

describe("IMP-09: TITLE を保持する", () => {
  it('TITLE "foo" が読める', () => {
    const text = MINIMAL_CUBE.replace(
      "LUT_3D_SIZE 2",
      'TITLE "foo"\nLUT_3D_SIZE 2',
    );
    expect(parseCubeLut(text).title).toBe("foo");
  });
  it("TITLE なしは undefined", () => {
    expect(parseCubeLut(MINIMAL_CUBE).title).toBeUndefined();
  });
});

describe("IMP-10: ドメインの妥当性を検査する", () => {
  const dataLines = MINIMAL_CUBE.split("\n").slice(1).join("\n");
  it.each([
    ["ゼロ幅", "DOMAIN_MIN 0.5 0 0\nDOMAIN_MAX 0.5 1 1"],
    ["逆転", "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 -1 1"],
    ["非有限（NaN）", "DOMAIN_MIN NaN 0 0\nDOMAIN_MAX 1 1 1"],
    ["非有限（Infinity）", "DOMAIN_MIN 0 0 0\nDOMAIN_MAX Infinity 1 1"],
  ])("%s はエラー", (_label, domain) => {
    const text = `LUT_3D_SIZE 2\n${domain}\n${dataLines}`;
    expect(() => parseCubeLut(text)).toThrow();
  });
});

describe("IMP-11: HaldCLUT寸法を判別する", () => {
  it.each([
    [512, 512], // L=8 → LUTサイズ64
    [216, 216], // L=6 → LUTサイズ36
  ])("%i×%i → hald", (w, h) => {
    expect(detectImageLutLayout(w, h)).toBe("hald");
  });
});

describe("IMP-12: ReShade寸法を判別する", () => {
  it.each([
    [4096, 64], // size=64
    [1024, 32], // size=32
  ])("%i×%i → reshade", (w, h) => {
    expect(detectImageLutLayout(w, h)).toBe("reshade");
  });
});

describe("IMP-13: 署名のない寸法を拒否する", () => {
  it.each([
    [500, 500],
    [640, 480],
    [4096, 63],
    [1, 1],
  ])("%i×%i → null", (w, h) => {
    expect(detectImageLutLayout(w, h)).toBeNull();
  });
});

/** 量子化往復の期待値: 画素 = round(v*255)、読み戻し = 画素/255。 */
function quantized(v: number): number {
  return Math.round(v * 255) / 255;
}

describe("IMP-14: HaldCLUT書き出しと往復一致する", () => {
  it("非対称LUT(size=64)が量子化を経て一致する", () => {
    const original = permutedLut(64);
    const img = lutToHald(original);
    const lut = imageToLut(img, "hald");
    expect(lut.size).toBe(64);
    // Float32格納による表現誤差（~1e-7）までを一致とみなす
    for (let i = 0; i < lut.data.length; i++) {
      expect(Math.abs(lut.data[i] - quantized(original.data[i]))).toBeLessThan(
        1e-7,
      );
    }
  });
});

describe("IMP-15: ReShade書き出しと往復一致する", () => {
  it("非対称LUT(size=64)が量子化を経て一致する", () => {
    const original = permutedLut(64);
    const img = lutToReShade(original);
    const lut = imageToLut(img, "reshade");
    expect(lut.size).toBe(64);
    for (let i = 0; i < lut.data.length; i++) {
      expect(Math.abs(lut.data[i] - quantized(original.data[i]))).toBeLessThan(
        1e-7,
      );
    }
  });
});

describe("IMP-16: 不透明でない画素を拒否する", () => {
  it("アルファ255以外の画素を含むとエラー", () => {
    // size=2 の ReShade（4×2）を作り、1画素だけ半透明にする
    const img = lutToReShade(createNeutralLut(2));
    img.data[3] = 128;
    expect(() => imageToLut(img, "reshade")).toThrow(/不透明/);
  });
});

describe("IMP-21: base=null で既存経路と等価", () => {
  it("withBaseLut(null, t) は t をそのまま返す", () => {
    const t = compileAdjustments(neutralAdjustments());
    expect(withBaseLut(null, t)).toBe(t);
  });
  it("恒等変換を通すと中立LUTと一致する", () => {
    const neutral = createNeutralLut(33);
    const baked = bakeLut(
      33,
      withBaseLut(null, compileAdjustments(neutralAdjustments())),
    );
    expect(lutDiffMax(baked, neutral)).toBeLessThan(1e-5);
  });
});

describe("IMP-22: ベースLUTが先に適用される", () => {
  it("base=チャネル交換、next=彩度-1、入力=純赤 → ≈0.7152", () => {
    const base = imported(permutedLut(4));
    const adj = neutralAdjustments();
    adj.saturation = -1;
    const transform = withBaseLut(base, compileAdjustments(adj));
    const out = new Float32Array(3);
    transform(1, 0, 0, out);
    // 赤 →(b,r,g)交換→ 緑 →輝度脱色→ 0.7152。調整が先なら 0.2126 になる
    for (const v of out) expect(v).toBeCloseTo(0.7152, 4);
  });
});

describe("IMP-23: 中立調整のときベースLUTそのものになる", () => {
  it("焼き付け結果はベースLUTの三線形補間値に一致する", () => {
    const base = imported(permutedLut(17));
    const baked = bakeLut(
      64,
      withBaseLut(base, compileAdjustments(neutralAdjustments())),
    );
    const expected = new Float32Array(3);
    let max = 0;
    for (let i = 0; i < baked.data.length; i += 3) {
      sampleLutTrilinear(
        base.lut,
        bakedGrid(baked.size, i / 3, 0),
        bakedGrid(baked.size, i / 3, 1),
        bakedGrid(baked.size, i / 3, 2),
        expected,
      );
      for (let c = 0; c < 3; c++) {
        max = Math.max(max, Math.abs(baked.data[i + c] - expected[c]));
      }
    }
    expect(max).toBeLessThan(1e-5);
  });
});

describe("IMP-24: サイズ差をリサンプルする", () => {
  it("中立LUT(size=17)をベースに焼き付け(size=64)するとほぼ恒等", () => {
    const base = imported(createNeutralLut(17));
    const baked = bakeLut(
      64,
      withBaseLut(base, compileAdjustments(neutralAdjustments())),
    );
    const neutral = createNeutralLut(64);
    expect(lutDiffMax(baked, neutral)).toBeLessThan(1e-5);
  });
});

describe("IMP-25: ドメイン正規化が働く", () => {
  it("ドメイン0〜2の .cube では入力0.5が格子座標0.25として引かれる", () => {
    const { lut, domainMin, domainMax } = parseCubeLut(
      "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n" +
        MINIMAL_CUBE.split("\n").slice(1).join("\n"),
    );
    const base: ImportedLut = { lut, domainMin, domainMax };
    const transform = withBaseLut(base, (r, g, b, out) => {
      out[0] = r;
      out[1] = g;
      out[2] = b;
    });
    const out = new Float32Array(3);
    transform(0.5, 0.5, 0.5, out);
    // (0.5−0)/(2−0)=0.25 の位置で中立LUTを引くため 0.25 になる
    for (const v of out) expect(v).toBeCloseTo(0.25, 6);
  });
});

describe("IMP-26: PNG由来ベースLUTの8bit誤差を許容する", () => {
  it("HaldCLUT画像をbaseにした合成は ±1/255+ε の範囲内", () => {
    const original = permutedLut(64);
    const img = lutToHald(original);
    const base = imported(imageToLut(img, "hald"));
    const baked = bakeLut(
      64,
      withBaseLut(base, compileAdjustments(neutralAdjustments())),
    );
    const expected = new Float32Array(3);
    let max = 0;
    for (let i = 0; i < baked.data.length; i += 3) {
      sampleLutTrilinear(
        original,
        bakedGrid(baked.size, i / 3, 0),
        bakedGrid(baked.size, i / 3, 1),
        bakedGrid(baked.size, i / 3, 2),
        expected,
      );
      for (let c = 0; c < 3; c++) {
        max = Math.max(max, Math.abs(baked.data[i + c] - expected[c]));
      }
    }
    expect(max).toBeLessThan(1 / 255 + 1e-4);
  });
});

describe("IMP-27: .cube 往復はほぼロスレス", () => {
  it("lutToCube → parseCubeLut → lutToCube で出力が一致する", () => {
    const original = permutedLut(33);
    const once = lutToCube(original, "往復テスト");
    const twice = lutToCube(parseCubeLut(once).lut, "往復テスト");
    expect(twice).toBe(once);
  });
});
