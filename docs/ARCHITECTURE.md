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
 ├─ layers[]               레이어 목록 (0번이 맨 아래)
 ├─ frames[]               프레임 목록 (각 프레임의 재생 시간 포함)
 ├─ cels{ }                실제 픽셀! key = "레이어id|프레임id"
 ├─ tags[]                 애니메이션 구간 이름 (걷기 0~5 ...)
 └─ palette[]              팔레트 색 목록
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

## 5. 다국어 (`i18n/`)

화면 글자는 코드에 직접 쓰지 않고 사전에서 꺼냅니다.

```tsx
const t = useT();
<button>{t('menu.save')}</button>   // 한국어: "저장", 영어: "Save"
```

새 문구를 추가하려면 `ko.ts` 에 먼저 추가하고 `en.ts` 에도 같은 키를 추가하세요.
빠뜨리면 `npm run typecheck` 가 알려줍니다.

---

## 6. 연습 문제: 새 도구 추가해 보기 🏋️

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

## 7. 테스트 (`tests/`)

`core` 의 함수들은 화면 없이 테스트합니다.

```bash
npm test
```

예) `tests/drawing.test.ts` – 타원이 상자 안에 대칭으로 그려지는지, 채우기가 벽을 넘지 않는지 확인
새 알고리즘을 만들면 테스트도 함께 만드는 습관을 들이세요. 나중에 코드를 고칠 때 망가지는 것을 바로 알 수 있습니다.
