/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Vite 설정 파일
// - react(): JSX/TSX 변환과 빠른 새로고침(HMR)을 담당합니다.
// - define: 코드 안의 __APP_VERSION__ 을 package.json 의 버전으로 바꿔 넣습니다.
// - worker: 내보내기용 Web Worker 도 ES 모듈로 만듭니다.
// - test: Vitest(단위 테스트) 설정입니다.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
