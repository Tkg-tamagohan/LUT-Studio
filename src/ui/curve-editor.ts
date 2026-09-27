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
/** 制御点を拾う半径(px)。 */
const HIT_RADIUS = 8;
/** 制御点の最小数（恒等カーブの両端）。 */
const MIN_POINTS = 2;

export function createCurveEditor(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
): void {
  const heading = document.createElement("h3");
  heading.textContent = "RGBカーブ";
  container.appendChild(heading);

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
  container.appendChild(channelRow);

  const syncChannelButtons = () => {
    for (const [key, btn] of channelButtons) {
      btn.classList.toggle("active", key === active);
    }
  };
  syncChannelButtons();

  const canvas = document.createElement("canvas");
  canvas.className = "curve-editor";
  canvas.width = WIDTH * devicePixelRatio;
  canvas.height = HEIGHT * devicePixelRatio;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;

  const toPx = (p: CurvePoint): [number, number] => [
    PAD + p.x * (WIDTH - PAD * 2),
    HEIGHT - PAD - p.y * (HEIGHT - PAD * 2),
  ];
  const toCurve = (px: number, py: number): CurvePoint => ({
    x: Math.min(1, Math.max(0, (px - PAD) / (WIDTH - PAD * 2))),
    y: Math.min(1, Math.max(0, (HEIGHT - PAD - py) / (HEIGHT - PAD * 2))),
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
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // グリッド（4分割）と外枠
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, PAD, WIDTH - PAD * 2, HEIGHT - PAD * 2);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const x = PAD + ((WIDTH - PAD * 2) * i) / 4;
      const y = PAD + ((HEIGHT - PAD * 2) * i) / 4;
      ctx.moveTo(x, PAD);
      ctx.lineTo(x, HEIGHT - PAD);
      ctx.moveTo(PAD, y);
      ctx.lineTo(WIDTH - PAD, y);
    }
    ctx.stroke();

    // 恒等線（対角線）を薄く引く
    ctx.strokeStyle = dim;
    ctx.beginPath();
    ctx.moveTo(PAD, HEIGHT - PAD);
    ctx.lineTo(WIDTH - PAD, PAD);
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
      ctx.arc(x, y, 4, 0, Math.PI * 2);
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

  canvas.addEventListener("mousedown", (e) => {
    const [px, py] = canvasPos(e);
    const idx = hitIndex(px, py);
    if (idx >= 0) {
      dragging = idx;
    } else {
      // 空白をクリックで制御点を追加し、そのままドラッグ継続
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

  window.addEventListener("mousemove", (e) => {
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

  window.addEventListener("mouseup", () => {
    dragging = -1;
  });

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
  hint.textContent = "クリックで追加・ドラッグで移動・ダブルクリックで削除";
  container.appendChild(hint);

  const resetCurve = document.createElement("button");
  resetCurve.type = "button";
  resetCurve.className = "curve-reset";
  resetCurve.textContent = "このチャネルを直線に戻す";
  resetCurve.addEventListener("click", () => {
    adj[active] = IDENTITY_CURVE.map((p) => ({ ...p }));
    draw();
    onChange();
  });
  container.appendChild(resetCurve);
}
