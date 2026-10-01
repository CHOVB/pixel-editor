/**
 * 브라우저 캔버스 관련 도우미
 * ------------------------------------------------------------
 * 픽셀 버퍼 ↔ PNG 이미지 변환처럼 "브라우저에서만" 가능한 작업을 모았습니다.
 * (나중에 데스크톱 앱으로 만들 때도 이 폴더만 바꾸면 됩니다)
 */

/** 픽셀 버퍼를 담은 캔버스 만들기 */
export function bufferToCanvas(buf: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), width, height), 0, 0);
  return canvas;
}

/** 픽셀 버퍼 → PNG Blob */
export function bufferToPngBlob(buf: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = bufferToCanvas(buf, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png-encode-failed'))), 'image/png');
  });
}

export interface DecodedImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 이미지 파일(PNG/JPG/GIF 첫 프레임/WebP...) → 픽셀 버퍼 */
export async function decodeImageFile(file: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no-2d-context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: data.data, width: canvas.width, height: canvas.height };
}

/** 체크무늬(투명 배경 표시용) 패턴 이미지 */
export function createCheckerTile(size: number, light: string, dark: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size * 2;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = dark;
    ctx.fillRect(size, 0, size, size);
    ctx.fillRect(0, size, size, size);
  }
  return c;
}
