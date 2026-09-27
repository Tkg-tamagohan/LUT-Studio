import { describe, expect, it } from "vitest";
import {
  applyPreset,
  neutralAdjustments,
  presetFromJson,
  presetToJson,
} from "../src/engine";

/** 中立から大きく外れた調整一式。全フィールドを非中立値で埋める。 */
function dirtyAdjustments() {
  const adj = neutralAdjustments();
  adj.exposure = 1.25;
  adj.contrast = -0.4;
  adj.saturation = 0.3;
  adj.temperature = -0.6;
  adj.hue = 45;
  adj.curveMaster = [
    { x: 0, y: 0.1 },
    { x: 0.5, y: 0.6 },
    { x: 1, y: 0.9 },
  ];
  adj.curveR = [
    { x: 0, y: 0 },
    { x: 1, y: 0.8 },
  ];
  adj.lift = [0.05, -0.02, 0.01];
  adj.gamma = [1.1, 0.9, 1.3];
  adj.gain = [1.2, 1, 0.8];
  adj.isolation = {
    enabled: true,
    strength: 0.7,
    targets: [
      { hue: 20, range: 40, feather: 10 },
      { hue: 200, range: 25, feather: 20 },
    ],
  };
  return adj;
}

describe("PRESET-01 JSONプリセットのラウンドトリップ（仕様決定E）", () => {
  it("保存→読込で全調整値が一致する", () => {
    const adj = dirtyAdjustments();
    const restored = presetFromJson(presetToJson(adj));
    expect(restored).toEqual(adj);
  });

  it("中立の調整もそのまま往復する", () => {
    const adj = neutralAdjustments();
    expect(presetFromJson(presetToJson(adj))).toEqual(adj);
  });
});

describe("PRESET-02 不正なプリセットを拒否する", () => {
  it("JSONとして解釈できない文字列はエラー", () => {
    expect(() => presetFromJson("not json {")).toThrow();
  });

  it("オブジェクトでないJSONはエラー", () => {
    expect(() => presetFromJson("[1,2,3]")).toThrow();
    expect(() => presetFromJson("42")).toThrow();
  });

  it("必須フィールドの欠落はエラー", () => {
    const adj = dirtyAdjustments() as unknown as Record<string, unknown>;
    delete adj.saturation;
    expect(() => presetFromJson(JSON.stringify(adj))).toThrow(/saturation/);
  });

  it("型が違うフィールドはエラー", () => {
    const adj = dirtyAdjustments() as unknown as Record<string, unknown>;
    adj.exposure = "強め";
    expect(() => presetFromJson(JSON.stringify(adj))).toThrow(/exposure/);
  });

  it("範囲外の値はエラー", () => {
    const adj = dirtyAdjustments() as unknown as Record<string, unknown>;
    adj.exposure = 99;
    expect(() => presetFromJson(JSON.stringify(adj))).toThrow(/範囲外/);
  });

  it("カーブ制御点が0〜1の外にあるとエラー", () => {
    const adj = dirtyAdjustments() as unknown as Record<string, unknown>;
    adj.curveMaster = [{ x: 0, y: 1.5 }];
    expect(() => presetFromJson(JSON.stringify(adj))).toThrow(/curveMaster/);
  });

  it("isolation.targets の要素が不正だとエラー", () => {
    const adj = dirtyAdjustments() as unknown as Record<string, unknown>;
    adj.isolation = { enabled: true, strength: 1, targets: [{ hue: "赤" }] };
    expect(() => presetFromJson(JSON.stringify(adj))).toThrow(/targets/);
  });
});

describe("PRESET-03 applyPresetは既存オブジェクトの参照を保つ", () => {
  it("同じ参照に値が書き込まれ、ネストした配列は複製される", () => {
    const dst = neutralAdjustments();
    const src = dirtyAdjustments();
    applyPreset(dst, src);
    expect(dst).toEqual(src);
    // 参照共有を防ぐためネスト構造は別オブジェクトになっている
    expect(dst.curveMaster).not.toBe(src.curveMaster);
    expect(dst.isolation.targets).not.toBe(src.isolation.targets);
    expect(dst.isolation.targets[0]).not.toBe(src.isolation.targets[0]);
    // dst を書き換えても src に影響しない
    dst.curveMaster[0].y = 0.99;
    expect(src.curveMaster[0].y).toBe(0.1);
  });
});
