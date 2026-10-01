/** vite.config.ts 의 define 으로 빌드할 때 채워지는 값 */
declare const __APP_VERSION__: string;

/** 빌드할 때 넣는 환경 변수 (.env 또는 CI) */
interface ImportMetaEnv {
  /** 오류 보고를 받을 주소 (웹 버전). 비어 있으면 오류 보고 기능이 꺼집니다. */
  readonly VITE_ERROR_REPORT_URL?: string;
  /** '1' 이면 자동 점검(E2E)용 장치를 넣어 빌드 (일반 빌드에서는 비워 두기) */
  readonly VITE_E2E_HOOKS?: string;
}
