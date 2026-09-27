import type { AdjustmentSet, IsolationMode } from "../engine";

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

const ISOLATION_MODES: { value: IsolationMode; label: string }[] = [
  { value: "off", label: "無効" },
  { value: "isolate", label: "分離（範囲外を脱色）" },
  { value: "select", label: "範囲補正（範囲内を強調）" },
  { value: "mask", label: "マスク表示" },
];

function addIsolationControls(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
): void {
  const heading = document.createElement("h3");
  heading.textContent = "アイソレーション";
  container.appendChild(heading);

  const modeRow = document.createElement("label");
  modeRow.className = "slider-row";
  const modeLabel = document.createElement("span");
  modeLabel.className = "slider-label";
  modeLabel.textContent = "モード";
  const select = document.createElement("select");
  for (const m of ISOLATION_MODES) {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    select.appendChild(opt);
  }
  select.value = adj.isolation.mode;
  select.addEventListener("change", () => {
    adj.isolation.mode = select.value as IsolationMode;
    onChange();
  });
  modeRow.append(modeLabel, select);
  container.appendChild(modeRow);

  const specs: { key: "hue" | "range" | "feather" | "strength"; label: string; min: number; max: number; step: number }[] = [
    { key: "hue", label: "中心色相 (°)", min: 0, max: 360, step: 1 },
    { key: "range", label: "範囲 (°)", min: 0, max: 180, step: 1 },
    { key: "feather", label: "ぼかし (°)", min: 0, max: 90, step: 1 },
    { key: "strength", label: "強度", min: 0, max: 1, step: 0.01 },
  ];
  for (const spec of specs) {
    const row = document.createElement("label");
    row.className = "slider-row";
    const name = document.createElement("span");
    name.className = "slider-label";
    name.textContent = spec.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(adj.isolation[spec.key]);
    const value = document.createElement("span");
    value.className = "slider-value";
    value.textContent = input.value;
    input.addEventListener("input", () => {
      adj.isolation[spec.key] = Number(input.value);
      value.textContent = input.value;
      onChange();
    });
    row.append(name, input, value);
    container.appendChild(row);
  }
}

export function createAdjustmentPanel(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
): void {
  const title = document.createElement("h2");
  title.textContent = "調整";
  container.appendChild(title);

  for (const spec of BASIC_SLIDERS) {
    const row = document.createElement("label");
    row.className = "slider-row";

    const name = document.createElement("span");
    name.className = "slider-label";
    name.textContent = spec.label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(adj[spec.key]);

    const value = document.createElement("span");
    value.className = "slider-value";
    value.textContent = input.value;

    input.addEventListener("input", () => {
      adj[spec.key] = Number(input.value);
      value.textContent = input.value;
      onChange();
    });

    row.append(name, input, value);
    container.appendChild(row);
  }

  addIsolationControls(container, adj, onChange);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "リセット";
  reset.addEventListener("click", () => {
    for (const spec of BASIC_SLIDERS) adj[spec.key] = 0;
    adj.isolation = {
      mode: "off",
      hue: 0,
      range: 30,
      feather: 15,
      strength: 1,
    };
    // パネルを作り直してスライダ・選択肢を初期値に戻す
    container.replaceChildren();
    createAdjustmentPanel(container, adj, onChange);
    onChange();
  });
  container.appendChild(reset);
}
