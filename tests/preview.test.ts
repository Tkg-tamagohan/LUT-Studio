import { describe, expect, it } from "vitest";
import { createNeutralLut } from "../src/engine";
import { fitWithin, isImageFile, MAX_PREVIEW_DIMENSION } from "../src/preview/images";
import { packLut2d } from "../src/preview/renderer-webgl1";

describe("IMG-01 プレビュー用縮小サイズの計算", () => {
  it("上限以下なら寸法を変えない", () => {
    expect(fitWithin(1920, 1080, MAX_PREVIEW_DIMENSION)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("横長画像は長辺が上限になる", () => {
    const { width, height } = fitWithin(4096, 2048, 2048);
    expect(width).toBe(2048);
    expect(height).toBe(1024);
  });

  it("縦長画像は長辺が上限になる", () => {
    const { width, height } = fitWithin(1000, 4000, 2048);
    expect(width).toBe(512);
    expect(height).toBe(2048);
  });

  it("上限ちょうどなら縮小しない", () => {
    expect(fitWithin(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it("極端な寸法でも1以上の整数を返す", () => {
    const { width, height } = fitWithin(1, 10000, 2048);
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBe(2048);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });
});

describe("IMG-02 画像ファイル判定", () => {
  it("MIMEタイプがimage/で始まるものだけ通す", () => {
    expect(isImageFile(new File([""], "a.png", { type: "image/png" }))).toBe(
      true,
    );
    expect(
      isImageFile(new File([""], "a.txt", { type: "text/plain" })),
    ).toBe(false);
  });
});

describe("IMG-03 WebGL1用LUT展開（packLut2d）", () => {
  // size=2 の中立LUT: タイル2枚が2列1行に並ぶ（texSize=4）
  it("タイルをceil(sqrt(size))列のグリッドへ展開する", () => {
    const packed = packLut2d(createNeutralLut(2));
    expect(packed.tilesPerRow).toBe(2);
    expect(packed.texSize).toBe(4);
    expect(packed.data.length).toBe(4 * 4 * 3);
  });

  it("各タイルの(r,g)位置に対応するLUT値を格納する", () => {
    const lut = createNeutralLut(2);
    const packed = packLut2d(lut);
    const at = (x: number, y: number) => {
      const o = (y * packed.texSize + x) * 3;
      return [packed.data[o], packed.data[o + 1], packed.data[o + 2]];
    };
    // b=0 タイル（左半分）: x=r, y=g
    expect(at(0, 0)).toEqual([0, 0, 0]); // r=0,g=0 → 黒
    expect(at(1, 0)).toEqual([255, 0, 0]); // r=1,g=0 → 赤
    expect(at(0, 1)).toEqual([0, 255, 0]); // r=0,g=1 → 緑
    // b=1 タイル（右半分）: x=2+r
    expect(at(2, 0)).toEqual([0, 0, 255]); // r=0,g=0 → 青
    expect(at(3, 1)).toEqual([255, 255, 255]); // r=1,g=1 → 白
  });

  it("64³ LUTは8×8タイルの512²テクスチャになる", () => {
    const packed = packLut2d(createNeutralLut(64));
    expect(packed.tilesPerRow).toBe(8);
    expect(packed.texSize).toBe(512);
  });
});
