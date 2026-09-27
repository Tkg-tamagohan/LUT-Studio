import { clamp01, type ColorTransform } from "./lut";

export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * 色調整パラメータ一式。プリセットJSONの形式と同一にする（仕様決定E）。
 * 各パラメータの中立値は NEUTRAL_ADJUSTMENTS を参照。
 */
export interface AdjustmentSet {
  /** 露出。EV段。0で中立。 */
  exposure: number;
  /** コントラスト。-1〜1。0で中立。 */
  contrast: number;
  /** 彩度。-1〜1。0で中立。 */
  saturation: number;
  /** 色温度。-1〜1。0で中立。正で暖色方向。 */
  temperature: number;
  /** 色相回転。度。-180〜180。0で中立。 */
  hue: number;
  /** 輝度カーブ。0〜1の入出力を通る制御点列。 */
  curveMaster: CurvePoint[];
  curveR: CurvePoint[];
  curveG: CurvePoint[];
  curveB: CurvePoint[];
  /** リフト（シャドウ）。各色-1〜1。0で中立。 */
  lift: [number, number, number];
  /** ガンマ（ミッドトーン）。各色0より大きい。1で中立。 */
  gamma: [number, number, number];
  /** ゲイン（ハイライト）。各色0より大きい。1で中立。 */
  gain: [number, number, number];
}

export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export function neutralAdjustments(): AdjustmentSet {
  return {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    hue: 0,
    curveMaster: IDENTITY_CURVE.map((p) => ({ ...p })),
    curveR: IDENTITY_CURVE.map((p) => ({ ...p })),
    curveG: IDENTITY_CURVE.map((p) => ({ ...p })),
    curveB: IDENTITY_CURVE.map((p) => ({ ...p })),
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
  };
}

/**
 * 制御点を区分線形補間して評価する。制御点が2点未満、または空なら恒等。
 * 両端の外側は端点の値に平坦化する。
 */
export function evaluateCurve(points: CurvePoint[], x: number): number {
  if (points.length < 2) return clamp01(x);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (x <= first.x) return clamp01(first.y);
  if (x >= last.x) return clamp01(last.y);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = a.x === b.x ? 0 : (x - a.x) / (b.x - a.x);
      return clamp01(a.y + (b.y - a.y) * t);
    }
  }
  return clamp01(last.y);
}

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** 色温度の最大シフト量。-1〜1の入力に対するチャネル値の変化幅。 */
const TEMPERATURE_SHIFT = 0.15;

/** カーブ評価テーブルの段数。区分線形カーブを線形補間で引くため精度上十分。 */
const CURVE_TABLE_SIZE = 1024;

type CurveTable = Float32Array;

/**
 * カーブを引き表に展開する。制御点が2点未満、または恒等写像になる場合は
 * null を返して呼び出し側で素通りさせる（量子化誤差を入れないため）。
 */
function buildCurveTable(points: CurvePoint[]): CurveTable | null {
  if (points.length < 2) return null;
  const table = new Float32Array(CURVE_TABLE_SIZE);
  let identity = true;
  for (let i = 0; i < CURVE_TABLE_SIZE; i++) {
    const v = evaluateCurve(points, i / (CURVE_TABLE_SIZE - 1));
    table[i] = v;
    if (Math.abs(v - i / (CURVE_TABLE_SIZE - 1)) > 1e-6) identity = false;
  }
  return identity ? null : table;
}

function lookupCurve(table: CurveTable | null, x: number): number {
  if (table === null) return x;
  const pos = clamp01(x) * (CURVE_TABLE_SIZE - 1);
  const i = Math.min(Math.floor(pos), CURVE_TABLE_SIZE - 2);
  const t = pos - i;
  return table[i] * (1 - t) + table[i + 1] * t;
}

/**
 * 調整一式を変換関数へコンパイルする。LUT焼き付けでは格子点ごとに呼ぶため、
 * カーブの引き表をここで一度だけ構築する（1画素ごとのソートを避ける）。
 * 適用順は 露出 → 色温度 → コントラスト → 彩度 → 色相 → カーブ →
 * リフト/ガンマ/ゲイン とし、最後に0〜1へ丸める。
 */
export function compileAdjustments(adj: AdjustmentSet): ColorTransform {
  const exp = Math.pow(2, adj.exposure);
  const tempShift = adj.temperature * TEMPERATURE_SHIFT;
  const contrastFactor = 1 + adj.contrast;
  const satFactor = 1 + adj.saturation;
  const theta = (adj.hue * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const tableMaster = buildCurveTable(adj.curveMaster);
  const tableR = buildCurveTable(adj.curveR);
  const tableG = buildCurveTable(adj.curveG);
  const tableB = buildCurveTable(adj.curveB);

  return (r, g, b, out) => {
    r *= exp;
    g *= exp;
    b *= exp;

    r += tempShift;
    b -= tempShift;

    r = (r - 0.5) * contrastFactor + 0.5;
    g = (g - 0.5) * contrastFactor + 0.5;
    b = (b - 0.5) * contrastFactor + 0.5;

    const luma = r * LUMA_R + g * LUMA_G + b * LUMA_B;
    r = luma + (r - luma) * satFactor;
    g = luma + (g - luma) * satFactor;
    b = luma + (b - luma) * satFactor;

    if (adj.hue !== 0) {
      const k = 1 / Math.sqrt(3);
      const dot = (r + g + b) * k;
      const crossR = k * (b - g);
      const crossG = k * (r - b);
      const crossB = k * (g - r);
      const common = dot * (1 - cos);
      const nr = r * cos + crossR * sin + k * common;
      const ng = g * cos + crossG * sin + k * common;
      const nb = b * cos + crossB * sin + k * common;
      r = nr;
      g = ng;
      b = nb;
    }

    r = lookupCurve(tableR, lookupCurve(tableMaster, r));
    g = lookupCurve(tableG, lookupCurve(tableMaster, g));
    b = lookupCurve(tableB, lookupCurve(tableMaster, b));

    out[0] = applyLgg(r, adj.lift[0], adj.gamma[0], adj.gain[0]);
    out[1] = applyLgg(g, adj.lift[1], adj.gamma[1], adj.gain[1]);
    out[2] = applyLgg(b, adj.lift[2], adj.gamma[2], adj.gain[2]);
  };
}

/** 単色への適用。LUT焼き付けでは compileAdjustments を使う。 */
export function applyAdjustments(
  r: number,
  g: number,
  b: number,
  adj: AdjustmentSet,
  out: Float32Array,
): void {
  compileAdjustments(adj)(r, g, b, out);
}

/** リフト・ガンマ・ゲイン。in=0にlift、in=1にgainが効き、中間はガンマで歪める。 */
function applyLgg(
  input: number,
  lift: number,
  gamma: number,
  gain: number,
): number {
  const lifted = input * gain + lift * (1 - input);
  const safeGamma = gamma <= 0 ? 1 : gamma;
  return clamp01(Math.pow(clamp01(lifted), 1 / safeGamma));
}
