import type { AdjustmentSet } from "../engine";

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

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "リセット";
  reset.addEventListener("click", () => {
    for (const spec of BASIC_SLIDERS) adj[spec.key] = 0;
    for (const input of container.querySelectorAll("input")) {
      input.value = "0";
    }
    for (const value of container.querySelectorAll(".slider-value")) {
      value.textContent = "0";
    }
    onChange();
  });
  container.appendChild(reset);
}
