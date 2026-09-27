import {
  hueDegrees,
  IDENTITY_CURVE,
  isolationMaskAt,
  type AdjustmentSet,
  type IsolationTarget,
} from "../engine";
import { createCurveEditor } from "./curve-editor";

/** 画像上のクリックで色相を拾いたい時に呼ぶ。結果は色相（度）で返る。 */
type PickFromImage = (onPicked: (hueDeg: number) => void) => void;

/**
 * 調整パネル。スライダ操作で AdjustmentSet を直接書き換え、
 * 変更のたびに onChange を呼ぶ（呼び出し側でLUT再焼き付けを行う）。
 */

interface SliderSpec {
  key: "exposure" | "contrast" | "saturation" | "temperature" | "hue";
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Phase 2の基本調整項目（仕様決定Bのうちスライダ向きの5項目）。 */
const BASIC_SLIDERS: SliderSpec[] = [
  { key: "exposure", label: "露出 (EV)", min: -3, max: 3, step: 0.05 },
  { key: "contrast", label: "コントラスト", min: -1, max: 1, step: 0.01 },
  { key: "saturation", label: "彩度", min: -1, max: 1, step: 0.01 },
  { key: "temperature", label: "色温度", min: -1, max: 1, step: 0.01 },
  { key: "hue", label: "色相 (°)", min: -180, max: 180, step: 1 },
];

function makeSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  onChange: () => void,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "slider-row";

  const name = document.createElement("span");
  name.className = "slider-label";
  name.textContent = label;

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(get());

  const value = document.createElement("span");
  value.className = "slider-value";
  value.textContent = input.value;

  input.addEventListener("input", () => {
    set(Number(input.value));
    value.textContent = input.value;
    onChange();
  });

  row.append(name, input, value);
  return row;
}

function newIsolationTarget(): IsolationTarget {
  return { hue: 0, range: 30, feather: 15 };
}

/** 彩度最大・輝度中間（hsl(h,100%,50%)）の色相環上の色をRGBで返す。 */
function hueToRgb(hDeg: number): [number, number, number] {
  const h = ((hDeg % 360) + 360) % 360;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  if (h < 60) return [1, x, 0];
  if (h < 120) return [x, 1, 0];
  if (h < 180) return [0, 1, x];
  if (h < 240) return [0, x, 1];
  if (h < 300) return [x, 0, 1];
  return [1, 0, x];
}

const GRADIENT_STOPS = 33;

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** "#rrggbb" から色相（度）を求める。彩度・輝度は捨てて色相だけを採用する。 */
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return hueDegrees(r, g, b);
}

/**
 * 選択対象が色相環のどこを残すかを示すグラデーション（全周0〜360度）。
 * 範囲内はその色相の色、範囲外は脱色後の輝度で塗る。見た目がそのまま
 * LUTの脱色結果を表すよう、脱色量(strength)も反映する。
 */
function isolationGradientCss(
  target: IsolationTarget,
  strength: number,
): string {
  const stops: string[] = [];
  for (let i = 0; i <= GRADIENT_STOPS; i++) {
    const h = (i / GRADIENT_STOPS) * 360;
    const m = isolationMaskAt(target, h);
    // エンジンと同じ合成：mask=1 は原色、mask=0 は strength ぶん脱色
    const keep = m + (1 - m) * (1 - strength);
    const [r, g, b] = hueToRgb(h);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mix = (v: number) =>
      Math.round((luma + (v - luma) * keep) * 255);
    const pct = ((i / GRADIENT_STOPS) * 100).toFixed(1);
    stops.push(`rgb(${mix(r)} ${mix(g)} ${mix(b)}) ${pct}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function addIsolationControls(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
  rebuildPanel: () => void,
  onPickStart?: PickFromImage,
): void {
  const heading = document.createElement("h3");
  heading.textContent = "アイソレーション（分離）";
  container.appendChild(heading);

  const enabledRow = document.createElement("label");
  enabledRow.className = "check-row";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = adj.isolation.enabled;
  enabled.addEventListener("change", () => {
    adj.isolation.enabled = enabled.checked;
    onChange();
  });
  const enabledText = document.createElement("span");
  enabledText.textContent = "有効（選択した色相だけ彩色を残す）";
  enabledRow.append(enabled, enabledText);
  container.appendChild(enabledRow);

  // グラデーションバーの再描画関数を集め、どのスライダを動かしても全部更新する
  const refreshers: (() => void)[] = [];
  const refreshAll = () => {
    for (const refresh of refreshers) refresh();
  };
  const onChangeAndRefresh = () => {
    refreshAll();
    onChange();
  };

  container.appendChild(
    makeSlider(
      "範囲外の脱色量",
      0,
      1,
      0.01,
      () => adj.isolation.strength,
      (v) => (adj.isolation.strength = v),
      onChangeAndRefresh,
    ),
  );

  // 複数色相の選択対象（肌色＋別色を同時に残す用途）
  adj.isolation.targets.forEach((target, index) => {
    const box = document.createElement("fieldset");
    box.className = "iso-target";
    const legend = document.createElement("legend");
    legend.textContent = `選択 ${index + 1}`;
    box.appendChild(legend);

    // 色相環上で残る色の範囲をそのまま描くバー（スライダと同じ幅）
    const gradient = document.createElement("div");
    gradient.className = "iso-gradient";
    const refreshGradient = () => {
      gradient.style.background = isolationGradientCss(
        target,
        adj.isolation.strength,
      );
    };
    refreshGradient();
    refreshers.push(refreshGradient);
    box.appendChild(gradient);

    // 色から色相を選ぶ入力。スウォッチは現在の中心色相の色を示す。
    const pickRow = document.createElement("div");
    pickRow.className = "pick-row";
    const pickLabel = document.createElement("span");
    pickLabel.textContent = "色から選択";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = rgbToHex(...hueToRgb(target.hue));
    const applyPickedHue = (hex: string) => {
      target.hue = Math.round(hexToHue(hex));
      refreshAll();
      onChange();
    };
    colorInput.addEventListener("input", () => applyPickedHue(colorInput.value));
    // ダイアログを閉じた時点でスライダ表示も新しい色相へ揃える
    colorInput.addEventListener("change", () => {
      colorInput.value = rgbToHex(...hueToRgb(target.hue));
      rebuildPanel();
    });
    pickRow.append(pickLabel, colorInput);

    // プレビュー画像上をクリックして元画像の色から色相を拾う
    if (onPickStart) {
      const eyedrop = document.createElement("button");
      eyedrop.type = "button";
      eyedrop.textContent = "画像から拾う";
      eyedrop.addEventListener("click", () => {
        onPickStart((hue) => {
          target.hue = Math.round(hue);
          rebuildPanel();
          onChange();
        });
      });
      pickRow.appendChild(eyedrop);
    }
    box.appendChild(pickRow);

    box.appendChild(
      makeSlider("中心色相 (°)", 0, 360, 1, () => target.hue, (v) => (target.hue = v), () => {
        colorInput.value = rgbToHex(...hueToRgb(target.hue));
        onChangeAndRefresh();
      }),
    );
    box.appendChild(
      makeSlider("範囲 (°)", 0, 180, 1, () => target.range, (v) => (target.range = v), onChangeAndRefresh),
    );
    box.appendChild(
      makeSlider("ぼかし (°)", 0, 90, 1, () => target.feather, (v) => (target.feather = v), onChangeAndRefresh),
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "この選択を削除";
    remove.disabled = adj.isolation.targets.length <= 1;
    remove.addEventListener("click", () => {
      adj.isolation.targets.splice(index, 1);
      rebuildPanel();
      onChange();
    });
    box.appendChild(remove);
    container.appendChild(box);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "色相を追加";
  add.addEventListener("click", () => {
    // 追加は既存と被りにくい補色側を初期値にする
    const last = adj.isolation.targets[adj.isolation.targets.length - 1];
    adj.isolation.targets.push({
      ...newIsolationTarget(),
      hue: (last.hue + 180) % 360,
    });
    rebuildPanel();
    onChange();
  });
  container.appendChild(add);
}

/** リフト・ガンマ・ゲイン。チャネル別に小さいスライダを並べる。 */
function addLggControls(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
): void {
  const heading = document.createElement("h3");
  heading.textContent = "リフト・ガンマ・ゲイン";
  container.appendChild(heading);

  const groups: {
    key: "lift" | "gamma" | "gain";
    label: string;
    min: number;
    max: number;
    step: number;
  }[] = [
    { key: "lift", label: "リフト", min: -1, max: 1, step: 0.01 },
    { key: "gamma", label: "ガンマ", min: 0.2, max: 4, step: 0.01 },
    { key: "gain", label: "ゲイン", min: 0.2, max: 4, step: 0.01 },
  ];
  const CHANNEL_LABELS = ["R", "G", "B"] as const;

  for (const group of groups) {
    for (let ch = 0; ch < 3; ch++) {
      container.appendChild(
        makeSlider(
          `${group.label} ${CHANNEL_LABELS[ch]}`,
          group.min,
          group.max,
          group.step,
          () => adj[group.key][ch],
          (v) => (adj[group.key][ch] = v),
          onChange,
        ),
      );
    }
  }
}

export function createAdjustmentPanel(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
  onPickStart?: PickFromImage,
): void {
  const rebuildPanel = () => {
    container.replaceChildren();
    createAdjustmentPanel(container, adj, onChange, onPickStart);
  };

  const title = document.createElement("h2");
  title.textContent = "調整";
  container.appendChild(title);

  for (const spec of BASIC_SLIDERS) {
    container.appendChild(
      makeSlider(
        spec.label,
        spec.min,
        spec.max,
        spec.step,
        () => adj[spec.key],
        (v) => (adj[spec.key] = v),
        onChange,
      ),
    );
  }

  addLggControls(container, adj, onChange);

  createCurveEditor(container, adj, onChange);

  addIsolationControls(container, adj, onChange, rebuildPanel, onPickStart);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "リセット";
  reset.addEventListener("click", () => {
    for (const spec of BASIC_SLIDERS) adj[spec.key] = 0;
    adj.curveMaster = IDENTITY_CURVE.map((p) => ({ ...p }));
    adj.curveR = IDENTITY_CURVE.map((p) => ({ ...p }));
    adj.curveG = IDENTITY_CURVE.map((p) => ({ ...p }));
    adj.curveB = IDENTITY_CURVE.map((p) => ({ ...p }));
    adj.lift = [0, 0, 0];
    adj.gamma = [1, 1, 1];
    adj.gain = [1, 1, 1];
    adj.isolation = {
      enabled: false,
      strength: 1,
      targets: [newIsolationTarget()],
    };
    rebuildPanel();
    onChange();
  });
  container.appendChild(reset);
}
