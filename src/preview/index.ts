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
    // WebGL2の構築は捨てキャンバスで試す。表示キャンバス上で一度コンテキストを
    // 確保すると種別を変えられず、失敗時にWebGL1へ切り替えられなくなるため。
    const probe = createRendererWebgl2(document.createElement("canvas"));
    if (probe) {
      probe.dispose();
      return createRendererWebgl2(canvas);
    }
  }
  return createRendererWebgl1(canvas);
}
