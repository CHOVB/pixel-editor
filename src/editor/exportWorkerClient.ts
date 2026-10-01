/**
 * 내보내기 Worker 사용 도우미
 * ------------------------------------------------------------
 * Worker 를 쓸 수 없는 환경(아주 오래된 브라우저 등)에서는 그냥 화면 쪽에서 처리합니다.
 */
import { encodeGifFrames } from '../core/exporters';
import type { GifJob } from '../workers/exportWorker';

export async function encodeGifInBackground(job: Omit<GifJob, 'kind'>): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return encodeGifFrames(job.frames, job.width, job.height, job.delays, job.loop);
  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return encodeGifFrames(job.frames, job.width, job.height, job.delays, job.loop);
  }
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: boolean; bytes?: Uint8Array; error?: string }>) => {
        if (e.data.ok && e.data.bytes) resolve(e.data.bytes);
        else reject(new Error(e.data.error ?? 'worker failed'));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
      const message: GifJob = { kind: 'gif', ...job };
      worker.postMessage(
        message,
        job.frames.map((f) => f.buffer as ArrayBuffer),
      );
    });
  } catch (err) {
    console.warn('Worker 로 GIF 만들기 실패, 화면 쪽에서 다시 시도합니다.', err);
    // 프레임 버퍼는 Worker 로 넘어가서 비었을 수 있으므로 호출한 쪽에서 다시 준비해야 합니다.
    throw err;
  } finally {
    worker.terminate();
  }
}
