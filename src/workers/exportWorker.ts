/**
 * 내보내기 작업용 Web Worker
 * ------------------------------------------------------------
 * GIF 압축은 프레임이 많고 크기가 크면 몇 초씩 걸립니다.
 * 그 동안 화면이 멈추지 않도록 별도의 일꾼(Worker)에서 처리합니다.
 */
import { encodeGifFrames } from '../core/exporters';

export interface GifJob {
  kind: 'gif';
  frames: Uint8ClampedArray[];
  width: number;
  height: number;
  delays: number[];
  loop: boolean;
}

self.onmessage = (e: MessageEvent<GifJob>) => {
  try {
    const job = e.data;
    const bytes = encodeGifFrames(job.frames, job.width, job.height, job.delays, job.loop);
    (self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
