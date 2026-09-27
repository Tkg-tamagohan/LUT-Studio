import { describe, expect, it } from "vitest";
import { fitWithin, isImageFile, MAX_PREVIEW_DIMENSION } from "../src/preview/images";

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
