import { describe, expect, it } from "vitest";
import {
  applyAdjustments,
  bakeLut,
  createNeutralLut,
  evaluateCurve,
  lutIndex,
  lutToCube,
  lutToHald,
  lutToReShade,
  neutralAdjustments,
  sampleLut,
} from "../src/engine";

const EPS = 1e-6;

describe("LUT-01 中立LUTの生成", () => {
  it("格子点に入力色と同じ値を持つ", () => {
    const lut = createNeutralLut(33);
    expect(lut.data.length).toBe(33 * 33 * 33 * 3);
    expect(sampleLut(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(sampleLut(lut, 1, 1, 1)).toEqual([1, 1, 1]);
    // (r,g,b)=(0,0,1) の格子点は青軸1/32
    const i = lutIndex(33, 0, 0, 1);
    expect(lut.data[i + 2]).toBeCloseTo(1 / 32, EPS);
  });
});

describe("LUT-02 中立変換の焼き付けは恒等LUTになる", () => {
  it("恒等変換を適用したLUTは中立LUTと一致する", () => {
    const neutral = createNeutralLut(33);
    const adj = neutralAdjustments();
    const baked = bakeLut(33, (r, g, b, out) =>
      applyAdjustments(r, g, b, adj, out),
    );
    for (let i = 0; i < neutral.data.length; i++) {
      expect(baked.data[i]).toBeCloseTo(neutral.data[i], 5);
    }
  });
});

describe("LUT-03 .cube 書き出し", () => {
  const cube = lutToCube(createNeutralLut(33));
  const lines = cube.trimEnd().split("\n");

  it("ヘッダとデータ行数が形式に一致する", () => {
    expect(lines[0]).toBe('TITLE "LUT-Studio"');
    expect(lines[1]).toBe("LUT_3D_SIZE 33");
    expect(lines[2]).toBe("DOMAIN_MIN 0.0 0.0 0.0");
    expect(lines[3]).toBe("DOMAIN_MAX 1.0 1.0 1.0");
    expect(lines.length).toBe(4 + 33 * 33 * 33);
  });

  it("データ行は青を最速に進める順序である", () => {
    expect(lines[4]).toBe("0.000000 0.000000 0.000000");
    expect(lines[5]).toBe("0.000000 0.000000 0.031250");
    expect(lines[4 + 33]).toBe("0.000000 0.031250 0.000000");
    expect(lines[lines.length - 1]).toBe("1.000000 1.000000 1.000000");
  });
});

describe("LUT-04 HaldCLUT 書き出し", () => {
  it("サイズ64のLUTは512x512になる", () => {
    const img = lutToHald(createNeutralLut(64));
    expect(img.width).toBe(512);
    expect(img.height).toBe(512);
    expect(img.data.length).toBe(512 * 512 * 4);
  });

  it("中立LUTでは画素が入力色をそのまま保持する", () => {
    const img = lutToHald(createNeutralLut(64));
    const step = Math.round(255 / 63); // 1/63 → 4
    // 画素0: (0,0,0)
    expect([...img.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    // 画素1: 青が1段進む → (0,0,1/63)
    expect([...img.data.slice(4, 8)]).toEqual([0, 0, step, 255]);
    // 画素64²: 赤が1段進む → (1/63,0,0)
    const i64 = 64 * 64 * 4;
    expect([...img.data.slice(i64, i64 + 4)]).toEqual([step, 0, 0, 255]);
  });
});

describe("LUT-05 ReShade 書き出し", () => {
  it("サイズ64のLUTは4096x64になる", () => {
    const img = lutToReShade(createNeutralLut(64));
    expect(img.width).toBe(4096);
    expect(img.height).toBe(64);
  });

  it("xはタイル内で緑・タイル間で青、yは赤に対応する", () => {
    const img = lutToReShade(createNeutralLut(64));
    const step = Math.round(255 / 63);
    const px = (x: number, y: number) =>
      [...img.data.slice((y * 4096 + x) * 4, (y * 4096 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(1, 0)).toEqual([0, step, 0, 255]); // g=1/63
    expect(px(64, 0)).toEqual([0, 0, step, 255]); // 次タイル → b=1/63
    expect(px(0, 1)).toEqual([step, 0, 0, 255]); // r=1/63
  });
});

describe("LUT-06 HaldCLUT は平方数でないLUTサイズを拒否する", () => {
  it("サイズ33でエラーになる", () => {
    expect(() => lutToHald(createNeutralLut(33))).toThrow();
  });
});

describe("ADJ-01 中立調整は入力を変えない", () => {
  it("任意色で恒等になる", () => {
    const adj = neutralAdjustments();
    const out = new Float32Array(3);
    applyAdjustments(0.3, 0.5, 0.8, adj, out);
    expect(out[0]).toBeCloseTo(0.3, 5);
    expect(out[1]).toBeCloseTo(0.5, 5);
    expect(out[2]).toBeCloseTo(0.8, 5);
  });
});

describe("ADJ-02 露出は2のべき乗でスケールする", () => {
  it("EV+1で0.25が0.5になる", () => {
    const adj = { ...neutralAdjustments(), exposure: 1 };
    const out = new Float32Array(3);
    applyAdjustments(0.25, 0.25, 0.25, adj, out);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });
});

describe("ADJ-03 彩度-1は輝度へ退色する", () => {
  it("全チャネルが輝度値になる", () => {
    const adj = { ...neutralAdjustments(), saturation: -1 };
    const out = new Float32Array(3);
    applyAdjustments(0.8, 0.4, 0.2, adj, out);
    const luma = 0.8 * 0.2126 + 0.4 * 0.7152 + 0.2 * 0.0722;
    expect(out[0]).toBeCloseTo(luma, 5);
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
  });
});

describe("ADJ-04 コントラスト最大で0.5からの距離が2倍になる", () => {
  it("0.25は0に丸められる", () => {
    const adj = { ...neutralAdjustments(), contrast: 1 };
    const out = new Float32Array(3);
    applyAdjustments(0.25, 0.75, 0.5, adj, out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
    expect(out[2]).toBeCloseTo(0.5, 5);
  });
});

describe("ADJ-05 色相120°は赤を緑へ回す", () => {
  it("純赤が緑になる", () => {
    const adj = { ...neutralAdjustments(), hue: 120 };
    const out = new Float32Array(3);
    applyAdjustments(1, 0, 0, adj, out);
    expect(out[1]).toBeCloseTo(1, 4);
    expect(out[0]).toBeCloseTo(0, 4);
  });
});

describe("ADJ-06 カーブ評価", () => {
  it("恒等カーブ・空カーブ・中間点の線形補間", () => {
    expect(evaluateCurve([], 0.4)).toBeCloseTo(0.4, EPS);
    expect(
      evaluateCurve(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0.4,
      ),
    ).toBeCloseTo(0.4, EPS);
    expect(
      evaluateCurve(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.8 },
          { x: 1, y: 1 },
        ],
        0.25,
      ),
    ).toBeCloseTo(0.4, EPS);
    // 端の外側は平坦化
    expect(
      evaluateCurve(
        [
          { x: 0.2, y: 0.1 },
          { x: 0.8, y: 0.9 },
        ],
        0,
      ),
    ).toBeCloseTo(0.1, EPS);
  });
});

describe("ADJ-07 リフト・ガンマ・ゲイン", () => {
  it("リフトは黒を持ち上げ、ゲインは白をスケールし、ガンマは中間を歪める", () => {
    const out = new Float32Array(3);
    const adjLift = {
      ...neutralAdjustments(),
      lift: [0.2, 0.2, 0.2] as [number, number, number],
    };
    applyAdjustments(0, 0, 0, adjLift, out);
    expect(out[0]).toBeCloseTo(0.2, 5);

    const adjGain = {
      ...neutralAdjustments(),
      gain: [0.5, 0.5, 0.5] as [number, number, number],
    };
    applyAdjustments(1, 1, 1, adjGain, out);
    expect(out[0]).toBeCloseTo(0.5, 5);

    // gamma=2 → 0.25^(1/2)=0.5 で中間が持ち上がる
    const adjGamma = {
      ...neutralAdjustments(),
      gamma: [2, 2, 2] as [number, number, number],
    };
    applyAdjustments(0.25, 0.25, 0.25, adjGamma, out);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });
});

describe("ADJ-08 色温度は暖色方向で赤を増し青を減らす", () => {
  it("正の値で赤が増える", () => {
    const adj = { ...neutralAdjustments(), temperature: 1 };
    const out = new Float32Array(3);
    applyAdjustments(0.5, 0.5, 0.5, adj, out);
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[2]).toBeLessThan(0.5);
  });
});
