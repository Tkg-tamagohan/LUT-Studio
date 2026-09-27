import type { RgbaImage } from "../engine";

/** Blob をローカルファイルとしてダウンロードする。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox系ではDOMに接続しないとクリックが効かないことがあるため一度だけ追加する
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐ revoke するとダウンロード開始前に無効化されることがあるため遅延する
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** エンジンが生成したRGBA8バッファをPNGのBlobへエンコードする。 */
export function rgbaToPngBlob(img: RgbaImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvasコンテキストを取得できません"));
  // ImageData は通常の ArrayBuffer 由来の Uint8ClampedArray を要求するため複製する
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
    0,
    0,
  );
  return canvasToPngBlob(canvas);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNGエンコードに失敗しました")),
      "image/png",
    );
  });
}
