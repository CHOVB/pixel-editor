# 코드 구조 설명서 (초보 개발자용)

이 문서는 "어떤 파일이 무슨 일을 하고, 서로 어떻게 연결되는지"를 설명합니다.
처음부터 다 이해하려 하지 말고, **아래 "데이터의 흐름"부터 따라가 보세요.**

---

## 1. 큰 그림: 3개의 층(Layer)

```
┌──────────────────────────────────────────────┐
│  components/  (화면, React)                   │  ← 사용자가 보고 클릭하는 부분
├──────────────────────────────────────────────┤
│  store/ + tools/ + editor/  (동작, 상태)       │  ← "무엇을 할지" 결정
├──────────────────────────────────────────────┤
│  core/  (순수 로직)                            │  ← 실제 계산 (화면과 무관)
└──────────────────────────────────────────────┘
```

- **core** 는 React 도 브라우저도 모릅니다. 그래서 `tests/` 에서 바로 테스트할 수 있어요.
- **store/tools/editor** 는 core 의 함수들을 불러서 "명령"을 수행합니다.
- **components** 는 store 의 상태를 화면에 보여주고, 클릭을 명령으로 바꿉니다.

> 💡 이렇게 나누면 나중에 화면을 완전히 바꾸거나(예: 데스크톱 앱), 기능을 추가할 때
> 다른 부분을 거의 건드리지 않아도 됩니다. 상용 프로그램에서 아주 중요한 습관이에요.

---

## 2. 그림 데이터는 어떻게 생겼나? (`core/types.ts`)

```
Project (프로젝트 = 파일 하나)
 ├─ width, height          그림 크기
 ├─ layers[]               레이어 목록 (0번이 맨 아래, 그룹 안은 parentId 로 연결)
 │   └─ kind               pixel | group | reference(밑그림 이미지) | particles
 │      guide              밑그림(스케치) 레이어 → 내보내기 제외
 │      anim               키프레임 움직임 (위치/회전/크기/불투명도 + 이징)
 │      effects[]          비파괴 효과 스택
 │      bind               뼈대 연결 (rigid=통째로 / mesh=휘어지게)
 │      particles          파티클 설정
 ├─ frames[]               프레임 목록 (각 프레임의 재생 시간 포함)
 ├─ cels{ }                실제 픽셀! key = "레이어id|프레임id"  (같은 버퍼를 공유하면 "링크 셀")
 ├─ tags[]                 애니메이션 구간 이름 (걷기 0~5 ...)
 ├─ palette[]              팔레트 색 목록
 ├─ bones[]                뼈대 (부모, 기본 자세, 뼈 키프레임)
 └─ assets{ }              밑그림 이미지 같은 외부 파일
```

레이어 × 프레임 = **격자**입니다. 격자의 한 칸을 **셀(Cel)** 이라고 부릅니다.

```
            프레임1   프레임2   프레임3
 레이어2 │  [셀]     [셀]     [ 비어있음 ]
 레이어1 │  [셀]     [셀]     [셀]
```

셀의 픽셀은 `Uint8ClampedArray` 라는 숫자 배열입니다.
픽셀 하나 = 숫자 4개 (빨강, 초록, 파랑, 투명도). 픽셀 (x, y) 의 위치는 `(y * width + x) * 4` 번째입니다.

색은 `0xRRGGBBAA` 형태의 숫자 하나로 다룹니다. (`core/color.ts`)
예) 불투명한 빨강 = `0xff0000ff`

---

## 3. 데이터의 흐름: "연필로 점 하나 찍기"를 따라가 보자

1. **마우스를 누름** → `components/CanvasView.tsx` 의 `onPointerDown`
   - 화면 좌표를 픽셀 좌표로 바꿉니다. (`editor/view.ts` 의 `screenToPixel`)
   - 현재 도구(`TOOLS[tool]`)의 `begin()` 을 호출합니다.
2. **도구가 그림** → `tools/brushTools.ts` 의 `FreehandTool.begin()`
   - `PixelEditSession.start()` 로 "편집 세션"을 시작합니다. (`tools/session.ts`)
     - 레이어가 잠겼거나 숨겨졌으면 여기서 안내 메시지를 띄우고 멈춥니다.
     - 셀의 원본을 복사해 둡니다 (실행 취소용).
   - `session.stamp()` 로 픽셀을 칠합니다. (대칭, 선택 영역 자동 처리)
   - `requestRender()` 로 "다시 그려줘!" 신호를 보냅니다. (`editor/renderBus.ts`)
3. **캔버스가 다시 그려짐** → `CanvasView` 의 `draw()`
   - `core/render.ts` 의 `compositeFrame()` 이 레이어들을 겹쳐 한 장으로 만들고, 확대해서 그립니다.
4. **마우스를 뗌** → `FreehandTool.end()` → `session.commit()`
   - `store/actions.ts` 의 `commitPixels()` 가 원본과 비교해서 **바뀐 사각형 부분만** 실행 취소 기록에 저장합니다.
   - `docVersion` 숫자를 1 올립니다 → 타임라인 썸네일, 레이어 썸네일 등이 새로 그려집니다.
5. **Ctrl+Z** → `editor/shortcuts.ts` → `actions.undo()` → `history.undo()` → 저장해 둔 변경 전 픽셀로 되돌림

---

## 4. 상태 관리 (`store/`)

- `editorStore.ts`: 앱 전체가 함께 쓰는 값 (현재 도구, 색, 줌, 현재 프레임 ...)
  ```ts
  // 컴포넌트에서 읽기 (값이 바뀌면 자동으로 다시 그려짐)
  const tool = useEditor((s) => s.tool);
  // 어디서든 바꾸기
  setState({ tool: 'eraser' });
  ```
- `actions.ts`: 문서를 바꾸는 모든 명령. **실행 취소 기록도 여기서 만듭니다.**
  - 구조 변경(레이어 추가 등): `commitStructure(이름, (project) => { ...수정... })`
    → 변경 전/후 구조를 저장해 두고 실행 취소 시 통째로 되돌립니다.
  - 픽셀 변경: `commitPixels(...)` → 바뀐 부분만 저장
  - 선택 영역 변경: `commitSelection(...)`

---

## 5. 화면에 그려지는 순서 (렌더 파이프라인, `core/render.ts`)

레이어 하나는 프레임마다 아래 순서로 처리된 뒤 합성됩니다. (결과는 캐시에 저장해서 다시 계산하지 않음)

```
① 원본 그림 (셀)      → 이 프레임에 그림이 없으면 앞 프레임 그림을 "계속 사용(hold)"
                         hold 는 키프레임·뼈대·움직이는 효과(흔들림 등)가 있는 레이어만 (core/project.ts layerHolds)
② 뼈대 연결            → core/skeleton.ts  (rigid: 행렬 하나 / mesh: 격자 + 가중치)
③ 키프레임 움직임       → core/keyframes.ts + core/resample.ts (nearest 또는 RotSprite)
④ 효과 스택            → core/effects.ts   (frameDependent 효과는 프레임마다 결과가 다름)
                         효과 값 키프레임이 있으면 이 프레임의 값을 계산해서 적용 (core/effectKeys.ts)
⑤ 블렌드 모드로 합성     → core/blend.ts     (그룹은 자식들을 먼저 합성해서 한 장으로)
```

**캐시**: 레이어별 결과, 그룹 합성 결과, 프레임 전체 합성 결과를 "내용 키"(셀 버전 + 설정)로 저장합니다.
픽셀을 고치면 `markEdited()` 로 버전이 올라가서 자동으로 새로 계산됩니다. 메모리는 384MB 까지만 씁니다.

**GPU 합성 (화면 표시만)**: `platform/glCompositor.ts` 가 ①~④ 결과를 텍스처로 올리고 ⑤ 블렌드를 WebGL2 셰이더로 합니다.
바뀐 레이어만 다시 올리고, 결과는 2D 캔버스가 `drawImage` 로 확대합니다. WebGL2 가 없거나 꺼져 있으면 CPU 로 자동 전환.
PNG/GIF 내보내기와 굽기는 항상 CPU 경로(정확히 같은 결과)를 씁니다. 두 결과가 같은지는 E2E 테스트가 비교합니다.

"굽기(bake)"는 이 결과를 실제 픽셀로 바꿔 셀에 넣는 것입니다. (`core/bake.ts`) Aseprite 로 내보낼 때도 같은 결과를 씁니다.

---

## 6. 애니메이션 도우미 알고리즘

| 기능 | 파일 | 원리 (간단히) |
| --- | --- | --- |
| 자동 중간 프레임 | `core/inbetween.ts` | 같은 색 픽셀끼리 짝짓기 → 덩어리의 무게중심 이동으로 짝을 예측 → 이웃끼리 이동 방향 맞추기(중앙값) → 사이 위치에 찍고 빈틈 메우기 |
| 가려진 부분 채우기 | `core/inpaint.ts` | 떼어낸 영역 중 "몸통이 좌우/위아래로 감싼 곳"만 고름 → 가장자리부터 한 겹씩 주변에서 가장 많은 색으로 채움 |
| AI 도트 정리 | `core/pixelfix.ts` | 가장자리 변화량의 주기(DFT)로 도트 격자 크기 찾기 → 칸마다 가장 많은 색 → 비슷한 색 합치기 → 팔레트 맞추기 |
| VFX 추천 | `core/vfx.ts` | 프레임마다 위치/변화량 측정 → 착지·타격·휘두르기·이동·꼭대기 규칙으로 점수 |
| 파티클 | `core/particles.ts` | 씨앗값이 같으면 항상 같은 결과(결정적) → 반복 애니메이션이 매끄러움 |

---

## 7. AI(Codex) 연동 구조 – API 키를 쓰지 않습니다

```
[에디터 화면]  src/ai/codex.ts
     │  웹 브라우저: HTTP (127.0.0.1 만)        데스크톱 앱: Tauri 명령(invoke)
     ▼                                          ▼
bridge/codex-bridge.mjs (Node)          src-tauri/crates/codex_core (Rust)
     └──────────────┬───────────────────────────┘
                    ▼
     codex exec  (사용자가 `codex login` 으로 ChatGPT 계정에 로그인한 Codex CLI)
       - 작업마다 임시 폴더, --sandbox workspace-write, 지시문은 표준 입력
       - 로그인 안 됐으면 시작 전에 거절, 네트워크 끊김 감지, 시간 제한
                    ▼
     결과 PNG → src/ai/aiTasks.ts 가 도트 크기로 줄이고 프로젝트 팔레트에 맞춤
```

브리지는 내 컴퓨터(127.0.0.1)에서만 열리고, 허용된 에디터 주소(Origin)에서 온 요청만 받습니다.

---

## 8. 데스크톱 앱 / 웹 앱(PWA)

- **데스크톱 (Tauri 2, `src-tauri/`)**: 같은 화면(dist/)을 창에 띄우고, 파일 대화상자와 Codex 실행만 Rust 명령으로 제공합니다.
  화면 쪽은 `src/platform/desktop.ts` 가 "데스크톱이면 운영체제 대화상자, 아니면 브라우저 방식"으로 자동 선택합니다.
  저장은 사용자가 대화상자에서 고른 파일에만 허용됩니다. (`desktop_write`)
- **웹 (PWA)**: `public/manifest.webmanifest` + `public/sw.js`(서비스 워커) → 설치 · 오프라인 실행 · 파일 연결.

---

## 9. 상용 기능

- **오류 대비**: `components/ErrorBoundary.tsx`(화면 오류 시 비상 저장 + 복구 화면), `editor/crashGuard.ts`(그 밖의 오류 기록 + 비상 저장)
- **라이선스**: `licensing/license.ts` – ECDSA P-256 서명 키를 공개 키로 오프라인 확인 (기능 제한 없음, 정품 표시용)
- **환경설정/단축키**: `components/dialogs/SettingsDialog.tsx`, `editor/shortcuts.ts`(사용자 단축키 저장 · 충돌 검사)
- **최근 파일**: `editor/recentFiles.ts` (브라우저: 파일 핸들, 데스크톱: 경로)
- **Web Worker**: `workers/exportWorker.ts` (GIF 압축을 화면과 분리)
- **자동 업데이트 (데스크톱)**: `platform/updates.ts` → Rust `update_*` 명령 → tauri-plugin-updater.
  latest.json 에서 새 버전을 찾고, 받은 파일은 앱 안의 **공개 키로 서명을 확인한 뒤에만** 설치합니다.
  공개 키가 없는 빌드에서는 플러그인을 아예 켜지 않습니다. (키 만들기: `npm run updater:keygen`)
- **오류 보고 (동의한 경우만)**: `platform/errorReport.ts` – 이메일·사용자 폴더 경로를 지우고, 같은 오류는 한 번, 실행당 5개까지.
  보내는 주소는 빌드할 때 고정(웹 `VITE_ERROR_REPORT_URL`, 데스크톱 `PIXEL_EDITOR_ERROR_REPORT_URL`). 예제 서버: `scripts/error-receiver.mjs`
- **출시 설정**: `scripts/release/tauri-release-config.mjs` – 저장소 비밀값이 있을 때만 코드 서명·업데이트 파일 만들기를 켭니다.

---

## 10. 다국어 (`i18n/`)

화면 글자는 코드에 직접 쓰지 않고 사전에서 꺼냅니다.

```tsx
const t = useT();
<button>{t('menu.save')}</button>   // 한국어: "저장", 영어: "Save"
```

새 문구를 추가하려면 `ko.ts` 에 먼저 추가하고 `en.ts` 에도 같은 키를 추가하세요.
빠뜨리면 `npm run typecheck` 가 알려줍니다.

---

## 11. 연습 문제: 새 도구 추가해 보기 🏋️

"클릭한 곳에 십자(+) 모양을 찍는 도구"를 만들어 봅시다.

1. `src/tools/crossTool.ts` 파일 만들기
   ```ts
   import { tr } from '../i18n';
   import { getState } from '../store/editorStore';
   import { PixelEditSession } from './session';
   import type { Tool, ToolPointer } from './types';

   export class CrossTool implements Tool {
     begin(e: ToolPointer): void {
       const session = PixelEditSession.start();
       if (!session) return;
       const color = getState().primary;
       for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
         session.plotSym(e.x + dx, e.y + dy, color);
       }
       session.commit(tr('tool.cross'));
     }
     move(): void {}
     end(): void {}
   }
   ```
2. `store/editorStore.ts` 의 `ToolId` 에 `'cross'` 추가
3. `tools/index.ts` 의 `TOOLS` 와 `TOOL_LIST` 에 한 줄씩 추가 (단축키도 지정)
4. `components/Icon.tsx` 에 `cross` 아이콘 추가: `cross: [P('M12 5v14 M5 12h14')]`
5. `i18n/ko.ts`, `i18n/en.ts` 에 `'tool.cross'`, `'hint.cross'` 문구 추가
6. `npm run typecheck` → `npm run dev` 로 확인!

---

## 12. 테스트

```bash
npm test            # tests/  : core 의 함수들을 화면 없이 테스트 (Vitest)
npm run e2e         # e2e/    : 빌드한 앱을 크롬으로 열어 실제로 클릭해 보는 테스트 (Playwright)
npm run rust:test   # src-tauri/crates/codex_core : 가짜 codex 로 연동 흐름 테스트 (Rust)
```

예) `tests/drawing.test.ts` – 타원이 상자 안에 대칭으로 그려지는지, 채우기가 벽을 넘지 않는지 확인
새 알고리즘을 만들면 테스트도 함께 만드는 습관을 들이세요. 나중에 코드를 고칠 때 망가지는 것을 바로 알 수 있습니다.
