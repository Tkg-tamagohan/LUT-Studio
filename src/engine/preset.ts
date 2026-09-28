import type {
  AdjustmentSet,
  CurvePoint,
  IsolationPosition,
  IsolationTarget,
} from "./adjustments";

/**
 * JSONプリセットの保存・読み込み（仕様決定E）。
 * 形式は AdjustmentSet をそのままJSON化したもの。
 * LUTから調整値への逆変換は不可能なため、再編集はプリセット経由で行う。
 */

/** AdjustmentSet をプリセットJSON文字列へ変換する。 */
export function presetToJson(adj: AdjustmentSet): string {
  return JSON.stringify(adj, null, 2);
}

function fail(reason: string): never {
  throw new Error(`プリセットの形式が不正です: ${reason}`);
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  path = key,
): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`${path} が数値ではありません`);
  }
  if (v < min || v > max) {
    fail(`${path} が範囲外です（${min}〜${max}）: ${v}`);
  }
  return v;
}

function readVec3(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): [number, number, number] {
  const v = obj[key];
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    !v.every((x) => typeof x === "number" && Number.isFinite(x))
  ) {
    fail(`${key} が数値3要素の配列ではありません`);
  }
  for (const x of v as number[]) {
    if (x < min || x > max) {
      fail(`${key} の要素が範囲外です（${min}〜${max}）: ${x}`);
    }
  }
  return [v[0], v[1], v[2]] as [number, number, number];
}

function readCurve(
  obj: Record<string, unknown>,
  key: string,
): CurvePoint[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    fail(`${key} が配列ではありません`);
  }
  return v.map((p, i) => {
    if (
      typeof p !== "object" ||
      p === null ||
      typeof p.x !== "number" ||
      typeof p.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      fail(`${key}[${i}] が {x, y} の数値ペアではありません`);
    }
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      fail(`${key}[${i}] が範囲外です（0〜1）: (${p.x}, ${p.y})`);
    }
    return { x: p.x, y: p.y };
  });
}

function readIsolationTarget(t: unknown, i: number): IsolationTarget {
  if (typeof t !== "object" || t === null) {
    fail(`isolation.targets[${i}] がオブジェクトではありません`);
  }
  const o = t as Record<string, unknown>;
  const path = `isolation.targets[${i}]`;
  const hue = readNumber(o, "hue", 0, 360, `${path}.hue`);
  const range = readNumber(o, "range", 0, 180, `${path}.range`);
  const feather = readNumber(o, "feather", 0, 90, `${path}.feather`);
  return { hue, range, feather };
}

/**
 * プリセットJSON文字列を解釈し、検証済みの AdjustmentSet を返す。
 * 形式が不正な場合は Error を投げる。未知のフィールドは無視する。
 */
export function presetFromJson(text: string): AdjustmentSet {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("JSONとして解釈できません");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("調整パラメータのオブジェクトではありません");
  }
  const obj = raw as Record<string, unknown>;

  const iso = obj.isolation;
  if (typeof iso !== "object" || iso === null || Array.isArray(iso)) {
    fail("isolation がオブジェクトではありません");
  }
  const isoObj = iso as Record<string, unknown>;
  if (typeof isoObj.enabled !== "boolean") {
    fail("isolation.enabled が真偽値ではありません");
  }
  if (!Array.isArray(isoObj.targets) || isoObj.targets.length === 0) {
    fail("isolation.targets が1要素以上の配列ではありません");
  }
  // isolation.position は後から追加されたフィールド（仕様決定Y）。
  // フィールドを持たない旧プリセットは "last" として読み込む。
  const pos = isoObj.position;
  let position: IsolationPosition;
  if (pos === undefined) {
    position = "last";
  } else if (pos === "first" || pos === "last") {
    position = pos;
  } else {
    fail("isolation.position が \"first\" / \"last\" ではありません");
  }

  return {
    exposure: readNumber(obj, "exposure", -3, 3),
    contrast: readNumber(obj, "contrast", -1, 1),
    saturation: readNumber(obj, "saturation", -1, 1),
    temperature: readNumber(obj, "temperature", -1, 1),
    hue: readNumber(obj, "hue", -180, 180),
    curveMaster: readCurve(obj, "curveMaster"),
    curveR: readCurve(obj, "curveR"),
    curveG: readCurve(obj, "curveG"),
    curveB: readCurve(obj, "curveB"),
    lift: readVec3(obj, "lift", -1, 1),
    gamma: readVec3(obj, "gamma", 0.2, 4),
    gain: readVec3(obj, "gain", 0.2, 4),
    isolation: {
      enabled: isoObj.enabled,
      strength: readNumber(isoObj, "strength", 0, 1),
      targets: isoObj.targets.map((t, i) => readIsolationTarget(t, i)),
      position,
    },
  };
}

/**
 * 検証済みプリセットを既存の AdjustmentSet へ書き込む。
 * UIは同じオブジェクトを参照し続けるため、置き換えず中身を更新する。
 */
export function applyPreset(dst: AdjustmentSet, src: AdjustmentSet): void {
  const fresh = {
    ...src,
    curveMaster: src.curveMaster.map((p) => ({ ...p })),
    curveR: src.curveR.map((p) => ({ ...p })),
    curveG: src.curveG.map((p) => ({ ...p })),
    curveB: src.curveB.map((p) => ({ ...p })),
    lift: [...src.lift] as [number, number, number],
    gamma: [...src.gamma] as [number, number, number],
    gain: [...src.gain] as [number, number, number],
    isolation: {
      ...src.isolation,
      targets: src.isolation.targets.map((t) => ({ ...t })),
    },
  };
  Object.assign(dst, fresh);
}
