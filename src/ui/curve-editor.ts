import { IDENTITY_CURVE, type AdjustmentSet, type CurvePoint } from "../engine";

/**
 * RGBカーブのエディタ。制御点をドラッグで移動、空白クリックで追加、
 * 制御点のダブルクリックで削除する。チャネルはマスター/R/G/B切替。
 */

type CurveKey = "curveMaster" | "curveR" | "curveG" | "curveB";

const CHANNELS: { key: CurveKey; label: string }[] = [
  { key: "curveMaster", label: "マスター" },
  { key: "curveR", label: "R" },
  { key: "curveG", label: "G" },
  { key: "curveB", label: "B" },
];

const WIDTH = 248;
const HEIGHT = 150;
const PAD = 10;
/** 制御点を拾う半径(CSS px)。指での操作も想定して広めに取る。 */
const HIT_RADIUS = 16;
/** 制御点の最小数（恒等カーブの両端）。 */
const MIN_POINTS = 2;
/** タッチ操作でダブルタップとみなす間隔(ms)。 */
const DOUBLE_TAP_MS = 350;

/**
 * <details>の開閉状態。パネル再構築（プリセット読み込み等）でエディタが
 * 作り直されても開閉を維持するためモジュールに置く。未操作なら画面幅で決める。
 */
let curveDetailsOpen: boolean | null = null;

export function createCurveEditor(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
): void {
  // スマホではパネルのスクロール操作がキャンバスに吸われてカーブが
  // 意図せず変わるため、detailsで格納する。既定はスマホで畳み、
  // デスクトップで展開。一度操作したらその状態を維持する。
  const details = document.createElement("details");
  details.className = "curve-details";
  const summary = document.createElement("summary");
  summary.textContent = "RGBカーブ";
  details.appendChild(summary);
  details.open =
    curveDetailsOpen ?? !window.matchMedia("(max-width: 640px)").matches;
  details.addEventListener("toggle", () => {
    curveDetailsOpen = details.open;
  });
  container.appendChild(details);

  let active: CurveKey = "curveMaster";

  // チャネル切替ボタン
  const channelRow = document.createElement("div");
  channelRow.className = "curve-channels";
  const channelButtons = new Map<CurveKey, HTMLButtonElement>();
  for (const ch of CHANNELS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = ch.label;
    btn.addEventListener("click", () => {
      active = ch.key;
      syncChannelButtons();
      draw();
    });
    channelButtons.set(ch.key, btn);
    channelRow.appendChild(btn);
  }
  details.appendChild(channelRow);

  const syncChannelButtons = () => {
    for (const [key, btn] of channelButtons) {
      btn.classList.toggle("active", key === active);
    }
  };
  syncChannelButtons();

  const canvas = document.createElement("canvas");
  canvas.className = "curve-editor";
  details.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;

  // 表示サイズはCSS（パネル幅いっぱい）に任せ、描画は実寸のCSSピクセル座標で行う。
  // バッファはResizeObserverで表示サイズ×dprに張り直す。
  let cssW = WIDTH;
  let cssH = HEIGHT;

  const toPx = (p: CurvePoint): [number, number] => [
    PAD + p.x * (cssW - PAD * 2),
    cssH - PAD - p.y * (cssH - PAD * 2),
  ];
  const toCurve = (px: number, py: number): CurvePoint => ({
    x: Math.min(1, Math.max(0, (px - PAD) / (cssW - PAD * 2))),
    y: Math.min(1, Math.max(0, (cssH - PAD - py) / (cssH - PAD * 2))),
  });

  function points(): CurvePoint[] {
    return adj[active];
  }

  function draw(): void {
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue("--fg").trim() || "#888";
    const dim = css.getPropertyValue("--fg-dim").trim() || "#555";
    const border = css.getPropertyValue("--border").trim() || "#333";

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // グリッド（4分割）と外枠
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, PAD, cssW - PAD * 2, cssH - PAD * 2);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const x = PAD + ((cssW - PAD * 2) * i) / 4;
      const y = PAD + ((cssH - PAD * 2) * i) / 4;
      ctx.moveTo(x, PAD);
      ctx.lineTo(x, cssH - PAD);
      ctx.moveTo(PAD, y);
      ctx.lineTo(cssW - PAD, y);
    }
    ctx.stroke();

    // 恒等線（対角線）を薄く引く
    ctx.strokeStyle = dim;
    ctx.beginPath();
    ctx.moveTo(PAD, cssH - PAD);
    ctx.lineTo(cssW - PAD, PAD);
    ctx.stroke();

    // カーブ本体（制御点をx順に繋ぐ区分線形）
    const sorted = [...points()].sort((a, b) => a.x - b.x);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sorted.forEach((p, i) => {
      const [x, y] = toPx(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 制御点
    for (const p of sorted) {
      const [x, y] = toPx(p);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  const canvasPos = (e: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const hitIndex = (px: number, py: number): number => {
    const pts = points();
    let best = -1;
    let bestDist = HIT_RADIUS;
    pts.forEach((p, i) => {
      const [x, y] = toPx(p);
      const d = Math.hypot(px - x, py - y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  let dragging = -1;
  let lastTap = { time: 0, x: 0, y: 0 };

  // ポインターイベントでマウスとタッチを統一的に扱う。
  // setPointerCapture により指・カーソルがキャンバス外へ出ても追従する。
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const [px, py] = canvasPos(e);
    const idx = hitIndex(px, py);
    canvas.setPointerCapture(e.pointerId);

    // タッチではdblclickが発火しにくいため、制御点上の連続2タップを削除とみなす
    const now = performance.now();
    const isDoubleTap =
      e.pointerType === "touch" &&
      now - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(px - lastTap.x, py - lastTap.y) <= HIT_RADIUS;
    lastTap = { time: now, x: px, y: py };
    if (isDoubleTap && idx >= 0 && points().length > MIN_POINTS) {
      points().splice(idx, 1);
      lastTap.time = 0;
      draw();
      onChange();
      return;
    }

    if (idx >= 0) {
      dragging = idx;
    } else {
      // 空白をタップで制御点を追加し、そのままドラッグ継続
      const p = toCurve(px, py);
      const pts = points();
      pts.push(p);
      pts.sort((a, b) => a.x - b.x);
      dragging = pts.indexOf(p);
      draw();
      onChange();
    }
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (dragging < 0) return;
    const [px, py] = canvasPos(e);
    const p = toCurve(px, py);
    const pts = points();
    pts[dragging] = p;
    // ドラッグ中にxを越えたら順序を保ってインデックスを追従する
    pts.sort((a, b) => a.x - b.x);
    dragging = pts.indexOf(p);
    draw();
    onChange();
  });

  const endDrag = () => {
    dragging = -1;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("dblclick", (e) => {
    const [px, py] = canvasPos(e);
    const idx = hitIndex(px, py);
    if (idx >= 0 && points().length > MIN_POINTS) {
      points().splice(idx, 1);
      draw();
      onChange();
    }
  });

  const hint = document.createElement("p");
  hint.className = "curve-hint";
  hint.textContent =
    "クリック/タップで追加・ドラッグで移動・ダブルクリック/ダブルタップで削除";
  details.appendChild(hint);

  const resetCurve = document.createElement("button");
  resetCurve.type = "button";
  resetCurve.className = "curve-reset";
  resetCurve.textContent = "このチャネルを直線に戻す";
  resetCurve.addEventListener("click", () => {
    adj[active] = IDENTITY_CURVE.map((p) => ({ ...p }));
    draw();
    onChange();
  });
  details.appendChild(resetCurve);

  const resizeObserver = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * devicePixelRatio);
    canvas.height = Math.round(cssH * devicePixelRatio);
    draw();
  });
  resizeObserver.observe(canvas);

  draw();
}
