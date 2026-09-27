export * from "./images";
export * from "./renderer";
export * from "./renderer-webgl1";

import type { PreviewRenderer } from "./renderer";
import { createRendererWebgl2 } from "./renderer";
import { createRendererWebgl1 } from "./renderer-webgl1";

/**
 * WebGL2 を優先し、非対応なら WebGL1（2Dアトラス参照）へ落とす。
 * 検証用に ?webgl1 クエリで WebGL1 版を強制できる。
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
): PreviewRenderer | null {
  const forceWebgl1 = new URLSearchParams(location.search).has("webgl1");
  if (!forceWebgl1) {
    const r = createRendererWebgl2(canvas);
    if (r) return r;
  }
  return createRendererWebgl1(canvas);
}
