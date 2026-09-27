import { describe, expect, it } from "vitest";
import { uniqueImageExportName } from "../src/ui/export";

// 仕様決定G: 書き出し名は `<ベース名>-lut.png`。
// 同名画像が読み込まれた場合でも、ブラウザの自動改名に頼らず一意の名前で保存する。
describe("EXPORT-01: 画像書き出し名の一意化", () => {
  it("初回は <ベース名>-lut.png、重複時は -2 以降の連番になる", () => {
    const used = new Set<string>();
    expect(uniqueImageExportName("a", used)).toBe("a-lut.png");
    expect(uniqueImageExportName("a", used)).toBe("a-lut-2.png");
    expect(uniqueImageExportName("a", used)).toBe("a-lut-3.png");
  });

  it("別ベース名は互いに影響しない", () => {
    const used = new Set<string>();
    uniqueImageExportName("a", used);
    uniqueImageExportName("a", used);
    expect(uniqueImageExportName("b", used)).toBe("b-lut.png");
  });

  it("拡張子なし・空名でも壊れない", () => {
    const used = new Set<string>();
    expect(uniqueImageExportName("image", used)).toBe("image-lut.png");
    expect(uniqueImageExportName("", used)).toBe("-lut.png");
  });
});
