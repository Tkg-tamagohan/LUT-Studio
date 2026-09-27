/**
 * 画像ファイルの読み込みとプレビュー用ビットマップ管理。
 * 超大画像はプレビュー用に縮小する（仕様決定I：上限は設けない）。
 */

export interface ImageEntry {
  id: string;
  /** ファイル名（UI表示用）。 */
  name: string;
  bitmap: ImageBitmap;
  /** ビットマップの寸法（縮小後）。 */
  width: number;
  height: number;
}

/** プレビュー画像の最大辺長。これを超える画像は読み込み時に縮小する。 */
export const MAX_PREVIEW_DIMENSION = 2048;

/**
 * (width, height) を max 以内に収める寸法を返す。
 * 既に収まっていれば入力をそのまま返す。アスペクト比を維持する。
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export interface LoadResult {
  entries: ImageEntry[];
  /** 読み込めなかったファイル名。 */
  skipped: string[];
}

let nextId = 0;

async function loadOne(file: File): Promise<ImageEntry | null> {
  if (!isImageFile(file)) return null;
  const original = await createImageBitmap(file);
  const { width, height } = fitWithin(
    original.width,
    original.height,
    MAX_PREVIEW_DIMENSION,
  );
  let bitmap = original;
  if (width !== original.width || height !== original.height) {
    bitmap = await createImageBitmap(file, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    });
    original.close();
  }
  return { id: `img-${nextId++}`, name: file.name, bitmap, width, height };
}

/** 画像ファイル群を読み込む。非画像・デコード失敗は skipped に入れて続行する。 */
export async function loadImageFiles(
  files: Iterable<File>,
): Promise<LoadResult> {
  const entries: ImageEntry[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (!isImageFile(file)) {
      skipped.push(file.name);
      continue;
    }
    try {
      const entry = await loadOne(file);
      if (entry) entries.push(entry);
    } catch {
      skipped.push(file.name);
    }
  }
  return { entries, skipped };
}
