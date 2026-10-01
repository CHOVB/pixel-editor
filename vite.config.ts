/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 설정 파일
// - react(): JSX/TSX 변환과 빠른 새로고침(HMR)을 담당합니다.
// - test: Vitest(단위 테스트) 설정입니다.
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
