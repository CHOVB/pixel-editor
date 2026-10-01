# 출시(배포) 안내서

이 문서는 "만든 프로그램을 사용자에게 전달하는 방법"을 순서대로 설명합니다.

---

## 0. 출시 전 점검 (매번)

```bash
npm ci                 # 깨끗하게 설치
npm run typecheck      # 타입 오류 0개
npm test               # 단위 테스트 전부 통과
npm run e2e            # 브라우저 점검 전부 통과 (처음 한 번: npx playwright install chromium)
npm run rust:test      # 데스크톱 Codex 연동 테스트 (Rust 설치 필요)
```
GitHub 에 올리면 `.github/workflows/ci.yml` 이 같은 점검을 자동으로 합니다.

버전 올리기: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` 의 `version` 을 같은 값으로 바꾸고 `CHANGELOG.md` 에 변경 내용을 적습니다.

---

## 1. 웹 버전 (PWA)

```bash
npm run build          # dist/ 폴더 생성
```
`dist/` 폴더를 정적 호스팅(Netlify, Vercel, Cloudflare Pages, GitHub Pages 등)에 올리면 끝입니다.
- **https 주소**여야 설치(PWA)·오프라인 실행·라이선스 확인이 동작합니다.
- 상대 경로(`base: './'`)로 빌드하므로 하위 폴더 주소에서도 동작합니다.
- 새 버전을 올리면 서비스 워커가 자동으로 새 파일을 받아 옵니다. (버전별 캐시)

웹 버전에서 AI 기능을 쓰려면 사용자가 자기 컴퓨터에서 `npm run codex-bridge` 를 실행해야 합니다.
배포 주소가 `http://localhost:5173` 이 아니라면 브리지에 허용 주소를 알려 줘야 합니다:
```bash
CODEX_BRIDGE_ORIGINS=https://my-pixel-editor.example.com npm run codex-bridge
```

---

## 2. 데스크톱 버전 (Tauri – Windows / macOS / Linux)

### 준비 (한 번만)
1. Rust 설치: https://rustup.rs
2. 운영체제별 준비물: https://tauri.app/start/prerequisites/
   - Windows: Microsoft C++ Build Tools, WebView2 (Windows 11 은 기본 설치)
   - macOS: Xcode Command Line Tools (`xcode-select --install`)
   - Linux(Ubuntu): `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

### 실행 / 설치 파일 만들기
```bash
npm run desktop:dev     # 개발용 창 열기 (코드 수정이 바로 반영)
npm run desktop:build   # 설치 파일 생성 → src-tauri/target/release/bundle/
```
- Windows: `.msi`, `.exe`(NSIS) / macOS: `.dmg`, `.app` / Linux: `.deb`, `.rpm`, `.AppImage`
- 아이콘을 바꾸려면: 512×512 PNG 를 준비하고 `npx tauri icon 내아이콘.png`

### GitHub 에서 자동으로 만들기
`v1.0.0` 같은 태그를 올리면 `.github/workflows/release.yml` 이 세 운영체제 설치 파일을 만들어 **GitHub Release 초안**에 올립니다.
```bash
git tag v1.0.0 && git push origin v1.0.0
```

### 코드 서명 (판매용이라면 강력 추천)
서명하지 않으면 Windows "알 수 없는 게시자" 경고, macOS "확인되지 않은 개발자" 경고가 뜹니다.
- **macOS**: Apple Developer Program 가입 → Developer ID 인증서 → 저장소 Secrets 에
  `APPLE_CERTIFICATE`(base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`(앱 암호), `APPLE_TEAM_ID`
- **Windows**: 코드 서명 인증서(OV/EV) 구매 → https://tauri.app/distribute/sign/windows/ 참고

### 자동 업데이트 (선택)
Tauri updater 플러그인을 쓰면 앱이 새 버전을 스스로 받습니다. 업데이트 서명 키를 만들고(`npx tauri signer generate`),
릴리스 주소를 `tauri.conf.json` 에 넣어야 하므로 판매/배포 주소가 정해진 뒤에 연결합니다.
https://tauri.app/plugin/updater/

---

## 3. AI 기능 (Codex) 안내 – 사용자용

AI 기능은 **OpenAI API 키를 쓰지 않고**, 사용자의 **ChatGPT 계정으로 로그인한 Codex CLI** 를 실행합니다.
사용량은 사용자의 ChatGPT 요금제 한도에서 차감됩니다.

```bash
npm install -g @openai/codex     # 1) 설치 (Node.js 필요)
codex login                      # 2) 브라우저에서 ChatGPT 로그인
```
- 데스크톱 앱: 바로 사용 가능 (앱이 codex 를 직접 실행)
- 웹 버전: `npm run codex-bridge` 를 켜 둔 상태에서 사용
- 에디터의 **🤖 Codex** 버튼 → 연결 상태 확인 (설치 / 로그인 / 로그인 방식)
- `codex login status` 가 API 키 로그인이라고 나오면 `codex logout` 후 `codex login` 으로 다시 로그인하세요.

---

## 4. 라이선스 키 판매

키는 **판매자만 가진 개인 키**로 서명하고, 프로그램에는 **공개 키**만 들어갑니다. 인터넷 없이 확인됩니다.
(기능 제한은 없고 "정품 등록" 표시만 바뀝니다. 기능을 막고 싶다면 `src/licensing/license.ts` 의 `currentLicense()` 결과를 이용하세요.)

```bash
# 1) 처음 한 번: 키 쌍 만들기 (개인 키 파일은 절대 git 에 올리지 마세요!)
npm run license -- keygen ./license-private.json
#    → 화면에 나온 공개 키로 src/licensing/publicKey.ts 를 바꾸고 다시 빌드

# 2) 판매할 때마다: 키 발급
npm run license -- issue ./license-private.json "홍길동" hong@example.com pro "" ORDER-0001
#    plan: personal | pro | team,  만료일을 넣으려면 "" 대신 2027-12-31

# 3) 문의가 오면: 키 확인
npm run license -- verify ./license-private.json PXE1.xxxx.yyyy
```
⚠ 지금 `publicKey.ts` 에 들어 있는 값은 **개발용**입니다. 판매 전에 반드시 1)을 실행해 바꾸세요.

---

## 5. 개인정보 · 상표

- 프로그램은 작업 내용을 외부로 보내지 않습니다. 예외: 사용자가 AI 기능을 실행할 때 그 작업에 필요한 이미지/설명만 Codex(OpenAI)로 전송됩니다.
- 오류 보고는 자동 전송하지 않고 "오류 내용 복사" 버튼만 제공합니다.
- 자동 저장/최근 파일/설정은 사용자의 브라우저(IndexedDB/localStorage)에만 저장됩니다.
- 프로그램 이름 "Pixel Editor" 는 임시 이름입니다. 판매 전 상표 검색 후 고유한 이름으로 바꾸는 것을 추천합니다.
- 포함된 오픈소스 라이브러리(React, Zustand, gifenc, gifuct-js, Tauri 등)의 라이선스 고지를 배포 페이지나 "정보" 창에 넣어 주세요.
