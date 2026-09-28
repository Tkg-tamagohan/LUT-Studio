import { describe, expect, it } from "vitest";
import {
  applyAdjustments,
  applyLutToRgba,
  bakeLut,
  compileAdjustments,
  createNeutralLut,
  evaluateCurve,
  lutIndex,
  lutToCube,
  lutToHald,
  lutToReShade,
  neutralAdjustments,
  sampleLut,
  type LutData,
} from "../src/engine";

/**
 * 軸の入れ替わりを検出できるよう、チャネルを巡回する非対称LUTを作る。
 */
function permutedLut(size: number): LutData {
  return bakeLut(size, (r, g, b, out) => {
    out[0] = b;
    out[1] = r;
    out[2] = g;
  });
}

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
    // bakeLut は格子点ごとに変換を呼ぶため、コンパイルは一度だけ行う
    const transform = compileAdjustments(adj);
    const baked = bakeLut(33, transform);
    let mismatches = 0;
    for (let i = 0; i < neutral.data.length; i++) {
      if (Math.abs(baked.data[i] - neutral.data[i]) > 1e-5) mismatches++;
    }
    expect(mismatches).toBe(0);
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

  it("データ行は赤を最速に進める順序である", () => {
    expect(lines[4]).toBe("0.000000 0.000000 0.000000");
    expect(lines[5]).toBe("0.031250 0.000000 0.000000");
    expect(lines[4 + 33]).toBe("0.000000 0.031250 0.000000");
    expect(lines[4 + 33 * 33]).toBe("0.000000 0.000000 0.031250");
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
    // 画素1: 赤が1段進む → (1/63,0,0)
    expect([...img.data.slice(4, 8)]).toEqual([step, 0, 0, 255]);
    // 画素64: 緑が1段進む → (0,1/63,0)
    const i64 = 64 * 4;
    expect([...img.data.slice(i64, i64 + 4)]).toEqual([0, step, 0, 255]);
    // 画素64²: 青が1段進む → (0,0,1/63)
    const i4096 = 64 * 64 * 4;
    expect([...img.data.slice(i4096, i4096 + 4)]).toEqual([0, 0, step, 255]);
  });
});

describe("LUT-05 ReShade 書き出し", () => {
  it("サイズ64のLUTは4096x64になる", () => {
    const img = lutToReShade(createNeutralLut(64));
    expect(img.width).toBe(4096);
    expect(img.height).toBe(64);
  });

  it("xはタイル内で赤・タイル間で青、yは緑に対応する", () => {
    const img = lutToReShade(createNeutralLut(64));
    const step = Math.round(255 / 63);
    const px = (x: number, y: number) =>
      [...img.data.slice((y * 4096 + x) * 4, (y * 4096 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(1, 0)).toEqual([step, 0, 0, 255]); // r=1/63
    expect(px(64, 0)).toEqual([0, 0, step, 255]); // 次タイル → b=1/63
    expect(px(0, 1)).toEqual([0, step, 0, 255]); // g=1/63
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

describe("ISO-01 分離（部分色残し）", () => {
  const isolateRed = () => {
    const adj = neutralAdjustments();
    adj.isolation = {
      enabled: true,
      strength: 1,
      targets: [{ hue: 0, range: 30, feather: 10 }],
      position: "last",
    };
    return adj;
  };

  it("範囲内の色はそのまま残る", () => {
    const out = new Float32Array(3);
    applyAdjustments(1, 0, 0, isolateRed(), out);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
  });

  it("範囲外の色は輝度へ脱色される", () => {
    const out = new Float32Array(3);
    applyAdjustments(0, 0, 1, isolateRed(), out);
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
    expect(out[0]).toBeCloseTo(0.0722, 3);
  });

  it("強度が弱いと範囲外の脱色が緩和される", () => {
    const adj = isolateRed();
    adj.isolation.strength = 0.5;
    const out = new Float32Array(3);
    applyAdjustments(0, 0, 1, adj, out);
    // 青成分が輝度より残るが完全には残らない
    expect(out[2]).toBeGreaterThan(out[0] + 0.1);
    expect(out[2]).toBeLessThan(0.9);
  });

  it("色相環の0/360境界をまたいで選択できる", () => {
    const adj = isolateRed();
    adj.isolation.targets[0].hue = 350;
    const out = new Float32Array(3);
    applyAdjustments(1, 0, 0, adj, out);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0, 5);
  });
});

describe("ISO-02 複数色相の選択", () => {
  it("離れた2色相を同時に残せる", () => {
    const adj = neutralAdjustments();
    adj.isolation = {
      enabled: true,
      strength: 1,
      targets: [
        { hue: 0, range: 30, feather: 10 },
        { hue: 240, range: 30, feather: 10 },
      ],
      position: "last",
    };
    const out = new Float32Array(3);
    // 赤と青は残る
    applyAdjustments(1, 0, 0, adj, out);
    expect(out[0]).toBeCloseTo(1, 5);
    applyAdjustments(0, 0, 1, adj, out);
    expect(out[2]).toBeCloseTo(1, 5);
    // 緑（どちらの範囲にも入らない）は脱色される
    applyAdjustments(0, 1, 0, adj, out);
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
  });
});

describe("ISO-03 選択範囲のマスクプレビュー", () => {
  it("範囲内は白・範囲外は黒のグレースケールを返す", () => {
    const adj = neutralAdjustments();
    adj.isolation = {
      enabled: true,
      strength: 1,
      targets: [{ hue: 0, range: 30, feather: 10 }],
      position: "last",
    };
    const maskTransform = compileAdjustments(adj, { maskPreview: true });
    const out = new Float32Array(3);
    maskTransform(1, 0, 0, out);
    expect(out[0]).toBeCloseTo(1, 5);
    maskTransform(0, 0, 1, out);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
  });

  it("無彩色は色相を持たないため選択されない", () => {
    const adj = neutralAdjustments();
    adj.isolation = {
      enabled: true,
      strength: 1,
      targets: [{ hue: 0, range: 30, feather: 10 }],
      position: "last",
    };
    const maskTransform = compileAdjustments(adj, { maskPreview: true });
    const out = new Float32Array(3);
    maskTransform(0.5, 0.5, 0.5, out);
    expect(out[0]).toBeCloseTo(0, 5);
  });
});

describe("ISO-04 適用位置（仕様決定Y）", () => {
  // 位置ごとの適用順を値で区別するため、マスクの評価対象が変わる
  // 色相回転（first では回転前の色相、last では回転後の色相で選択される）と、
  // 脱色後の色に別の調整がかかるか（色温度のシフトが残るか）を見る。
  const isolateGreen = (position: "first" | "last") => {
    const adj = neutralAdjustments();
    adj.isolation = {
      enabled: true,
      strength: 1,
      targets: [{ hue: 120, range: 30, feather: 10 }],
      position,
    };
    return adj;
  };

  it("first は入力色・last は調整後の色で選択する（色相回転で区別）", () => {
    const out = new Float32Array(3);
    // 緑入力を色相-120°で赤に回す調整
    const first = isolateGreen("first");
    first.hue = -120;
    applyAdjustments(0, 1, 0, first, out);
    // first: 回転前の緑で選択 → 彩色が残り、その後の回転で赤になる
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[1]).toBeCloseTo(0, 4);
    expect(out[2]).toBeCloseTo(0, 4);

    const last = isolateGreen("last");
    last.hue = -120;
    applyAdjustments(0, 1, 0, last, out);
    // last: 回転後の赤で選択 → 緑ターゲットに合わず脱色される
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
    expect(out[0]).toBeCloseTo(0.2126, 4);
  });

  it("first は脱色結果に後続の調整がかかり、last は脱色が最終出力になる", () => {
    const out = new Float32Array(3);
    // 赤入力を緑ターゲットで脱色し、色温度を暖色方向に振る調整
    const first = isolateGreen("first");
    first.temperature = 1;
    applyAdjustments(1, 0, 0, first, out);
    // first: 先に脱色した輝度へ色温度シフトがかかる（R+・B-の着色が残る）
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);

    const last = isolateGreen("last");
    last.temperature = 1;
    applyAdjustments(1, 0, 0, last, out);
    // last: 調整後の色で選択して脱色 → 出力は着色されない輝度になる
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
  });

  it("マスクプレビューも位置に従い、選択位置の画素の選択度を返す", () => {
    const out = new Float32Array(3);
    // 緑入力を赤に回す調整で、先頭と末尾でマスクが逆になる
    const first = isolateGreen("first");
    first.hue = -120;
    const firstMask = compileAdjustments(first, { maskPreview: true });
    firstMask(0, 1, 0, out);
    // first: 入力の緑を評価 → 選択範囲内で白
    expect(out[0]).toBeCloseTo(1, 5);

    const last = isolateGreen("last");
    last.hue = -120;
    const lastMask = compileAdjustments(last, { maskPreview: true });
    lastMask(0, 1, 0, out);
    // last: 回転後の赤を評価 → 選択範囲外で黒
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
  });
});

// 以下は外部ソフト側の規約で書き出し物をデコードし、元LUTと全点照合する互換テスト。
// 各デコード関数は外部形式の仕様から独立に書き、実装の詳細を共有しない。

describe("LUT-07 .cube を標準規約（赤最速）で読み戻すと元LUTと一致する", () => {
  it("非対称LUTの全格子点が一致する", () => {
    const lut = permutedLut(33);
    const lines = lutToCube(lut).trimEnd().split("\n").slice(4);
    // 標準規約: 行k の入力は (r=k%size, g=floor(k/size)%size, b=floor(k/size²))
    const size = lut.size;
    let mismatches = 0;
    let firstMismatch = "";
    for (let k = 0; k < lines.length; k++) {
      const r = k % size;
      const g = Math.floor(k / size) % size;
      const b = Math.floor(k / (size * size));
      const [vr, vg, vb] = lines[k].split(" ").map(Number);
      const i = lutIndex(size, r, g, b);
      if (
        Math.abs(vr - lut.data[i]) > 1e-5 ||
        Math.abs(vg - lut.data[i + 1]) > 1e-5 ||
        Math.abs(vb - lut.data[i + 2]) > 1e-5
      ) {
        mismatches++;
        if (!firstMismatch)
          firstMismatch = `行${k}: got ${lines[k]}, want ${lut.data[i]} ${lut.data[i + 1]} ${lut.data[i + 2]}`;
      }
    }
    expect(mismatches, firstMismatch).toBe(0);
  });
});

describe("LUT-08 HaldCLUT を外部規約で読み戻すと元LUTと一致する", () => {
  it("非対称LUTの全画素が一致する", () => {
    const lut = permutedLut(64);
    const img = lutToHald(lut);
    // ImageMagick hald: 規約: 画素i の入力は (r=i%L², g=floor(i/L²)%L², b=floor(i/L⁴))
    const levelSq = lut.size;
    let mismatches = 0;
    let firstMismatch = -1;
    for (let i = 0; i < img.width * img.height; i++) {
      const r = i % levelSq;
      const g = Math.floor(i / levelSq) % levelSq;
      const b = Math.floor(i / (levelSq * levelSq));
      const src = lutIndex(lut.size, r, g, b);
      const dst = i * 4;
      if (
        img.data[dst] !== Math.round(lut.data[src] * 255) ||
        img.data[dst + 1] !== Math.round(lut.data[src + 1] * 255) ||
        img.data[dst + 2] !== Math.round(lut.data[src + 2] * 255)
      ) {
        mismatches++;
        if (firstMismatch < 0) firstMismatch = i;
      }
    }
    expect(mismatches, `最初の不一致画素: ${firstMismatch}`).toBe(0);
  });
});

describe("LUT-09 ReShade形式を外部規約で読み戻すと元LUTと一致する", () => {
  it("非対称LUTの全画素が一致する", () => {
    const lut = permutedLut(64);
    const img = lutToReShade(lut);
    const size = lut.size;
    // ReShade規約: 入力(r,g,b) は画素 (x=b*size+r, y=g)
    let mismatches = 0;
    let firstMismatch = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size * size; x++) {
        const g = y;
        const b = Math.floor(x / size);
        const r = x % size;
        const src = lutIndex(size, r, g, b);
        const dst = (y * img.width + x) * 4;
        if (
          img.data[dst] !== Math.round(lut.data[src] * 255) ||
          img.data[dst + 1] !== Math.round(lut.data[src + 1] * 255) ||
          img.data[dst + 2] !== Math.round(lut.data[src + 2] * 255)
        ) {
          mismatches++;
          if (!firstMismatch) firstMismatch = `(${x},${y})`;
        }
      }
    }
    expect(mismatches, `最初の不一致画素: ${firstMismatch}`).toBe(0);
  });
});

describe("LUT-10 画素へのLUT適用（applyLutToRgba）", () => {
  it("中立LUTは画素をほぼ変えずアルファを保持する", () => {
    const lut = createNeutralLut(64);
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 128, 255, 255, 255, 200, 30, 200, 90, 64,
    ]);
    applyLutToRgba(lut, pixels);
    // 三線形補間→8bit往復の丸め誤差は±1まで
    expect(Math.abs(pixels[0] - 0)).toBeLessThanOrEqual(1);
    expect(Math.abs(pixels[4] - 255)).toBeLessThanOrEqual(1);
    expect(Math.abs(pixels[8] - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(pixels[9] - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(pixels[10] - 90)).toBeLessThanOrEqual(1);
    // アルファは無変更
    expect(pixels[3]).toBe(128);
    expect(pixels[7]).toBe(200);
    expect(pixels[11]).toBe(64);
  });

  it("チャネル巡回LUTは画素のチャネルを入れ替える", () => {
    const lut = permutedLut(64); // out = (b, r, g)
    const pixels = new Uint8ClampedArray([255, 0, 128, 255]);
    applyLutToRgba(lut, pixels);
    expect(pixels[0]).toBe(128); // 元のB
    expect(pixels[1]).toBe(255); // 元のR
    expect(pixels[2]).toBe(0); // 元のG
    expect(pixels[3]).toBe(255);
  });

  it("格子点の間の色は三線形補間される", () => {
    // 全チャネルが入力の赤成分を返すLUT（size=2）。最近傍なら128は0か255に丸まる。
    const lut = bakeLut(2, (r, _g, _b, out) => {
      out[0] = r;
      out[1] = r;
      out[2] = r;
    });
    const pixels = new Uint8ClampedArray([128, 0, 0, 255]);
    applyLutToRgba(lut, pixels);
    expect(pixels[0]).toBe(128); // r=0.502 の補間値がそのまま出る
    expect(pixels[1]).toBe(128);
    expect(pixels[2]).toBe(128);
  });

  it("調整を焼いたLUTで画素が変換される（彩度-1で脱色）", () => {
    const adj = { ...neutralAdjustments(), saturation: -1 };
    const lut = bakeLut(64, compileAdjustments(adj));
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    applyLutToRgba(lut, pixels);
    // 輝度へ脱色されるため全チャネルが近い値になる
    expect(Math.abs(pixels[0] - pixels[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(pixels[1] - pixels[2])).toBeLessThanOrEqual(1);
  });
});
