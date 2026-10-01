/**
 * 브라우저 자동 점검(E2E) 설정
 * ------------------------------------------------------------
 *   npm run e2e
 * 실제 배포용으로 빌드한 뒤(npm run build) 미리보기 서버를 띄우고, 크롬으로 주요 기능을 눌러 봅니다.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    // 오류 보고 기능을 시험하려고 보고 주소를 넣어 빌드합니다. (테스트가 이 주소로 가는 요청을 가로챔)
    // VITE_E2E_HOOKS: 오류 복구 화면 시험용 장치(일반 빌드에는 없음)
    env: { VITE_ERROR_REPORT_URL: `http://localhost:${PORT}/__error-report`, VITE_E2E_HOOKS: '1' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
