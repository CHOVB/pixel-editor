/**
 * 주요 기능 브라우저 점검 (실제 화면을 마우스/키보드로 조작)
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BLEND_MODES } from '../src/core/blend';
import { serializeProject } from '../src/core/fileFormat';
import { addLayer, createProject, ensureCel } from '../src/core/project';

const SPRITE = fileURLToPath(new URL('./fixtures/ai-sprite.png', import.meta.url));

test.beforeEach(async ({ context }) => {
  // 자동 점검에서는 운영체제 저장 창 대신 "다운로드" 방식으로 저장되게 합니다.
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = undefined;
    w.showOpenFilePicker = undefined;
  });
});

async function menu(page: Page, title: string, item: string): Promise<void> {
  await page.locator('.menu-title', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('.menu-dropdown .menu-item', { hasText: item }).first().click();
}

/** 캔버스의 픽셀 좌표 → 화면 좌표 */
async function canvasMapper(page: Page) {
  const box = (await page.locator('.main-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const status = (await page.locator('.statusbar').textContent())!.replace(/\s+/g, ' ');
  const zoom = Number(status.match(/🔍 (\d+)%/)![1]) / 100;
  const [, cx, cy] = status.match(/📍 (\d+), (\d+)/)!.map(Number);
  return (x: number, y: number) => [box.x + box.width / 2 + (x - cx) * zoom, box.y + box.height / 2 + (y - cy) * zoom] as const;
}

async function frameCount(page: Page): Promise<number> {
  return page.locator('.tl-frame-head').count();
}

test('opens a sample from the welcome screen and plays it', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sample-card', { hasText: '통통 슬라임' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await frameCount(page)).toBe(8);
  await expect(page.locator('.tl-layer', { hasText: '슬라임' })).toBeVisible();
});

test('draws two poses and generates in-betweens', async ({ page }) => {
  await page.goto('/');
  await page.locator('.preset-grid.big .preset').nth(1).click(); // 32×32
  const P = await canvasMapper(page);
  await page.keyboard.press('u');
  const [ax, ay] = P(6, 10);
  const [bx, by] = P(13, 22);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Shift+D');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('v');
  const [mx, my] = P(9, 15);
  const [nx, ny] = P(20, 15);
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(nx, ny, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  expect(await frameCount(page)).toBe(2);
  await page.keyboard.press('Shift+I');
  await expect(page.locator('.modal h2')).toHaveText('자동 중간 프레임 만들기');
  await page.locator('.modal .btn.primary').click();
  await expect.poll(() => frameCount(page)).toBe(8);
});

test('moves every frame at once with the frame transform dialog', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sample-card', { hasText: '통통 슬라임' }).click();
  await page.keyboard.press('Alt+t');
  await expect(page.locator('.modal h2')).toHaveText('프레임 일괄 변형');
  await page.locator('.modal .segmented button', { hasText: '모든 프레임' }).click();
  await expect(page.locator('.modal .foot-info')).toHaveText('8개 프레임');
  await page.locator('.modal .toggle', { hasText: '좌우 뒤집기' }).click();
  await page.locator('.modal .btn.primary').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.toast').last()).toContainText('프레임 일괄 변형');
});

test('effect values can be keyframed', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome .btn.ghost.continue').click();
  for (let i = 0; i < 5; i++) await page.keyboard.press('n');
  expect(await frameCount(page)).toBe(6);
  await page.locator('.tl-frame-head').first().click();
  await menu(page, '효과', '효과 패널 열기');
  await page.locator('.fx-presets .chip', { hasText: '번쩍 → 사라짐' }).click();
  await expect(page.locator('.tl-cell .kf.fx')).toHaveCount(2);
  await expect(page.locator('.fx-key-list')).toHaveText('◆1◆4');
  // 3번 프레임에서 값을 바꾸면 키가 자동으로 생겨요
  await page.locator('.tl-frame-head').nth(2).click();
  const amount = page.locator('.fx-param.keyed input[type="number"], .fx-param.keyed [role="spinbutton"]').first();
  await amount.fill('70');
  await amount.press('Enter');
  await expect(page.locator('.tl-cell .kf.fx')).toHaveCount(3);
  await expect(page.locator('.fx-key-list')).toHaveText('◆1◆3◆4');
});

/** 모든 블렌드 모드 + 반투명 + 그룹을 쓰는 시험용 프로젝트 파일 */
async function blendTestFile(): Promise<Buffer> {
  const W = 48;
  const p = createProject(W, W, { name: 'blend-test' });
  const fill = (buf: Uint8ClampedArray, f: (x: number, y: number) => [number, number, number, number]) => {
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const [r, g, b, a] = f(x, y);
        buf.set([r, g, b, a], (y * W + x) * 4);
      }
  };
  fill(ensureCel(p, p.layers[0].id, p.frames[0].id), (x, y) => [x * 5, y * 5, 128, y < 40 ? 255 : 120]);
  BLEND_MODES.forEach((mode, i) => {
    const layer = addLayer(p, undefined, mode);
    layer.blendMode = mode;
    layer.opacity = i % 2 ? 0.8 : 1;
    fill(ensureCel(p, layer.id, p.frames[0].id), (x, y) =>
      (x + y + i * 3) % 7 < 3 ? [(i * 40 + x * 3) % 256, (200 - y * 4 + i * 9) % 256, (i * 70) % 256, 90 + ((x * 7 + i * 13) % 166)] : [0, 0, 0, 0],
    );
  });
  const group = addLayer(p, undefined, 'group', 'group');
  group.opacity = 0.7;
  const child = addLayer(p, undefined, 'child', 'pixel', group.id);
  child.blendMode = 'screen';
  fill(ensureCel(p, child.id, p.frames[0].id), (x) => (x % 5 === 0 ? [255, 220, 40, 200] : [0, 0, 0, 0]));
  return Buffer.from(await serializeProject(p));
}

test('GPU (WebGL) canvas matches the CPU renderer for every blend mode', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome .btn.ghost.continue').click();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles({ name: 'blend-test.pxe', mimeType: 'application/json', buffer: await blendTestFile() });
  await expect(page.locator('.tl-layer', { hasText: 'hardLight' })).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(page.locator('.statusbar .renderer')).toHaveText('⚡ GPU');

  // 화면 캔버스 픽셀을 페이지 안에 저장해 두고, 비교도 페이지 안에서 합니다. (큰 배열을 주고받지 않게)
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.main-canvas')!;
    (window as unknown as { __gpuShot: Uint8ClampedArray }).__gpuShot = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  });

  await page.keyboard.press('Control+,');
  await page.locator('.settings-dialog .segmented button', { hasText: /^CPU$/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.statusbar .renderer')).toHaveText('CPU');
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.main-canvas')!;
    const cpu = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const gpu = (window as unknown as { __gpuShot: Uint8ClampedArray }).__gpuShot;
    let maxDiff = 0;
    let over = 0;
    let colorful = 0;
    for (let i = 0; i < cpu.length; i++) {
      const d = Math.abs(cpu[i] - gpu[i]);
      if (d > maxDiff) maxDiff = d;
      if (d > 2) over++;
    }
    for (let i = 0; i < cpu.length; i += 4) if (Math.abs(cpu[i] - cpu[i + 1]) > 30) colorful++;
    return { same: cpu.length === gpu.length, maxDiff, over, colorful };
  });
  expect(result.same).toBe(true);
  expect(result.colorful).toBeGreaterThan(10000); // 그림이 실제로 화면에 그려졌는지
  expect(result.over).toBe(0);
  expect(result.maxDiff).toBeLessThanOrEqual(2);
});

test('cleans up an AI-made pixel image to true pixel size', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome .btn.ghost.continue').click();
  await menu(page, '파일', 'AI 도트 이미지 정리');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.modal .btn.small', { hasText: '이미지 열기' }).first().click();
  await (await chooser).setFiles(SPRITE);
  await expect(page.locator('.modal .foot-info')).toContainText('12×12');
  await page.locator('.modal .btn.primary').click();
  await expect(page.locator('.statusbar')).toContainText('12 × 12');
});

test('custom shortcut works and can be reset', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome .btn.ghost.continue').click();
  await page.keyboard.press('Control+,');
  await page.locator('.settings-dialog .tabs button', { hasText: '단축키' }).click();
  const row = page.locator('.shortcut-edit-row', { hasText: '새 프레임' }).first();
  await row.locator('button', { hasText: '바꾸기' }).click();
  await page.keyboard.press('Shift+F');
  await expect(row.locator('kbd')).toHaveText('Shift+F');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.keyboard.press('Shift+F');
  expect(await frameCount(page)).toBe(2);
  // 기본값으로 되돌리기
  await page.keyboard.press('Control+,');
  await page.locator('.settings-dialog .tabs button', { hasText: '단축키' }).click();
  await page.locator('.settings-dialog .btn', { hasText: '모두 기본값' }).click();
  await expect(page.locator('.shortcut-edit-row', { hasText: '새 프레임' }).first().locator('kbd')).toHaveText('N');
});

test('exports and re-imports an Aseprite file', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sample-card', { hasText: '바람 부는 나무' }).click();
  await page.keyboard.press('Control+e');
  await page.locator('.modal .tabs button', { hasText: 'Aseprite' }).click();
  const download = page.waitForEvent('download');
  await page.locator('.modal .btn.primary').click();
  const file = await (await download).path();
  const bytes = readFileSync(file);
  expect(bytes.readUInt16LE(4)).toBe(0xa5e0);
  expect(bytes.readUInt16LE(6)).toBe(8); // 프레임 수

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles({ name: 'tree.aseprite', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('.tl-layer', { hasText: '나뭇잎' })).toBeVisible();
  expect(await frameCount(page)).toBe(8);
});

test('Codex window explains how to connect when the bridge is off', async ({ page }) => {
  await page.goto('/');
  await page.locator('.welcome .btn.ghost.continue').click();
  await page.locator('.ai-btn').click();
  await expect(page.locator('.modal')).toContainText('npm run codex-bridge');
  await expect(page.locator('.modal')).toContainText('API 키 없이');
});

test('tutorial panel walks through the steps', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tutorial-btn').click();
  const panel = page.locator('.tutorial-panel');
  await expect(panel).toContainText('1 / 9');
  await panel.locator('.btn', { hasText: '다음' }).click();
  await panel.locator('.btn', { hasText: '연필 고르기' }).click();
  await expect(page.locator('.tool-options')).toContainText('연필');
  await panel.locator('[aria-label="튜토리얼 닫기 (도움말 메뉴에서 다시 열 수 있어요)"]').click();
  await expect(panel).toHaveCount(0);
});
