import type { AdjustmentSet, IsolationTarget } from "../engine";

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

function addIsolationControls(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
  rebuildPanel: () => void,
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

  container.appendChild(
    makeSlider(
      "範囲外の脱色量",
      0,
      1,
      0.01,
      () => adj.isolation.strength,
      (v) => (adj.isolation.strength = v),
      onChange,
    ),
  );

  // 複数色相の選択対象（肌色＋別色を同時に残す用途）
  adj.isolation.targets.forEach((target, index) => {
    const box = document.createElement("fieldset");
    box.className = "iso-target";
    const legend = document.createElement("legend");
    legend.textContent = `選択 ${index + 1}`;
    box.appendChild(legend);

    box.appendChild(
      makeSlider("中心色相 (°)", 0, 360, 1, () => target.hue, (v) => (target.hue = v), onChange),
    );
    box.appendChild(
      makeSlider("範囲 (°)", 0, 180, 1, () => target.range, (v) => (target.range = v), onChange),
    );
    box.appendChild(
      makeSlider("ぼかし (°)", 0, 90, 1, () => target.feather, (v) => (target.feather = v), onChange),
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

export function createAdjustmentPanel(
  container: HTMLElement,
  adj: AdjustmentSet,
  onChange: () => void,
): void {
  const rebuildPanel = () => {
    container.replaceChildren();
    createAdjustmentPanel(container, adj, onChange);
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

  addIsolationControls(container, adj, onChange, rebuildPanel);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "リセット";
  reset.addEventListener("click", () => {
    for (const spec of BASIC_SLIDERS) adj[spec.key] = 0;
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
