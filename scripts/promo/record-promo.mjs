/**
 * 30초 홍보 영상 자동 녹화
 * ------------------------------------------------------------
 * 실제 프로그램을 자동으로 조작하면서 화면을 녹화하고(크롬 스크린캐스트),
 * 자막 · 키 입력 표시 · 타이틀 카드 · 칩튠 배경음을 붙여 MP4 로 만듭니다.
 * UI 가 바뀌면 이 스크립트만 다시 실행하면 새 영상이 나옵니다.
 *
 * 준비:  npm run build && npx vite preview --port 4173   (다른 터미널)
 * 실행:  node scripts/promo/record-promo.mjs [출력폴더]
 * 필요:  ffmpeg, python3 (AI 이미지 만들기), 한글 글꼴(Pretendard 권장)
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeChiptune, writeWav } from './music.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PROMO_URL || 'http://localhost:4173/';
const OUT = resolve(process.argv[2] || 'promo-out');
/** 완성 영상 길이(초). 실제 녹화가 더 길면 전체를 살짝 빠르게 맞춥니다. */
const TARGET = Number(process.env.PROMO_SECONDS || 30);
const FRAMES = join(OUT, 'frames');
const W = 1920;
const H = 1080;

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const SPRITE = join(OUT, 'ai-mushroom.png');
execFileSync('python3', [join(HERE, 'make-ai-sprite.py'), SPRITE], { stdio: 'inherit' });

/* ------------------------------------------------------------------ */
/* 영상용 화면 장식 (커서, 자막, 키 표시, 타이틀 카드)                       */
/* ------------------------------------------------------------------ */

const OVERLAY = () => {
  const css = `
  #promo-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; }
  #promo-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; transform: translate(960px, 540px); transition: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
  .promo-ripple { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid rgba(138,163,255,.95); animation: promo-ripple .55s ease-out forwards; }
  @keyframes promo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
  #promo-caption { position: absolute; left: calc((100% - 272px + 52px) / 2); bottom: 270px; transform: translate(-50%, 20px); opacity: 0;
    transition: opacity .35s ease, transform .35s ease; text-align: center; padding: 18px 34px 16px; border-radius: 18px;
    background: linear-gradient(135deg, rgba(20,18,40,.92), rgba(30,26,60,.92)); border: 1px solid rgba(138,163,255,.55);
    box-shadow: 0 18px 50px rgba(0,0,0,.55), 0 0 0 6px rgba(123,92,255,.12); white-space: nowrap; }
  #promo-caption.show { opacity: 1; transform: translate(-50%, 0); }
  #promo-caption b { display: block; font-size: 40px; font-weight: 800; letter-spacing: -.5px; color: #fff; }
  #promo-caption b em { font-style: normal; background: linear-gradient(90deg, #ff7eb3, #ffd166, #7cf2c9, #8aa3ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  #promo-caption small { display: block; margin-top: 6px; font-size: 19px; font-weight: 500; color: #b9bcd8; letter-spacing: .3px; }
  #promo-key { position: absolute; right: 320px; top: 110px; opacity: 0; transform: translateY(-10px); transition: all .25s ease; display: flex; gap: 8px; align-items: center; }
  #promo-key.show { opacity: 1; transform: translateY(0); }
  #promo-key kbd { font-family: 'Pretendard', sans-serif; font-size: 28px; font-weight: 700; color: #fff; padding: 8px 16px; border-radius: 10px;
    background: linear-gradient(#3a3b52, #26273a); border: 1px solid #6c6f99; box-shadow: 0 4px 0 #15161f, 0 10px 24px rgba(0,0,0,.5); }
  #promo-key span { font-size: 26px; color: #c9cbe6; font-weight: 700; }
  #promo-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; opacity: 1;
    transition: opacity .5s ease; background: radial-gradient(1200px 700px at 50% 40%, #2a2260 0%, #141428 55%, #0b0b16 100%); color: #fff; }
  #promo-card.hide { opacity: 0; }
  #promo-card .logo { display: grid; grid-template-columns: repeat(2, 64px); gap: 10px; padding: 22px; border-radius: 26px; background: #1e1f29; box-shadow: 0 20px 60px rgba(0,0,0,.6), 0 0 80px rgba(123,92,255,.35); }
  #promo-card .logo i { width: 64px; height: 64px; border-radius: 6px; transform: scale(0); animation: promo-pop .45s cubic-bezier(.2,1.6,.4,1) forwards; }
  #promo-card .logo i:nth-child(1) { background: #ff5e7e; animation-delay: .05s } #promo-card .logo i:nth-child(2) { background: #ffd166; animation-delay: .15s }
  #promo-card .logo i:nth-child(3) { background: #4ecdc4; animation-delay: .25s } #promo-card .logo i:nth-child(4) { background: #7c83fd; animation-delay: .35s }
  @keyframes promo-pop { to { transform: scale(1) } }
  #promo-card h1 { margin: 10px 0 0; font-size: 104px; font-weight: 900; letter-spacing: -3px; line-height: 1; }
  #promo-card h2 { margin: 0; font-size: 40px; font-weight: 700; color: #e9e8ff; letter-spacing: -.5px; }
  #promo-card h2 em { font-style: normal; background: linear-gradient(90deg, #ff7eb3, #ffd166, #7cf2c9, #8aa3ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  #promo-card p { margin: 0; font-size: 22px; color: #a9abc9; letter-spacing: .4px; }
  #promo-card .chips { display: flex; gap: 12px; margin-top: 8px; }
  #promo-card .chips span { padding: 9px 18px; border-radius: 999px; border: 1px solid rgba(138,163,255,.5); background: rgba(138,163,255,.12); font-size: 21px; font-weight: 600; color: #dfe3ff; }
  #promo-card .cta { margin-top: 16px; padding: 16px 40px; border-radius: 16px; font-size: 30px; font-weight: 800; background: linear-gradient(135deg, #7b5cff, #4f8cff); box-shadow: 0 14px 40px rgba(79,140,255,.45); }
  .promo-fade-up { opacity: 0; transform: translateY(18px); animation: promo-up .6s ease forwards; }
  @keyframes promo-up { to { opacity: 1; transform: none } }
  `;
  const ready = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'promo-root';
    root.innerHTML = `<div id="promo-card"></div><div id="promo-caption"><b></b><small></small></div><div id="promo-key"></div>
      <svg id="promo-cursor" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.4 L14.4 20.2 L11.4 13.7 L17.6 13.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(root);
    const cursor = root.querySelector('#promo-cursor');
    window.addEventListener('mousemove', (e) => (cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`), true);
    // 녹화 중에는 "저장하지 않은 작업" 확인 창을 화면에 보이지 않게 바로 확인합니다. (영상 편집용)
    new MutationObserver(() => {
      const modal = document.querySelector('.modal[aria-label="확인"]');
      if (!modal || modal.dataset.promoDone) return;
      modal.dataset.promoDone = '1';
      const backdrop = modal.closest('.modal-backdrop');
      if (backdrop) backdrop.style.visibility = 'hidden';
      setTimeout(() => modal.querySelector('.btn.primary')?.click(), 0);
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = 'promo-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      root.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.__promo = {
    card(html) {
      const c = document.getElementById('promo-card');
      c.innerHTML = html;
      c.classList.remove('hide');
    },
    hideCard() {
      document.getElementById('promo-card').classList.add('hide');
    },
    caption(ko, en) {
      const c = document.getElementById('promo-caption');
      if (!ko) {
        c.classList.remove('show');
        return;
      }
      c.querySelector('b').innerHTML = ko;
      c.querySelector('small').textContent = en || '';
      c.classList.add('show');
    },
    key(keys) {
      const k = document.getElementById('promo-key');
      k.innerHTML = keys.map((x, i) => (i ? '<span>+</span>' : '') + `<kbd>${x}</kbd>`).join('');
      k.classList.add('show');
      clearTimeout(k._t);
      k._t = setTimeout(() => k.classList.remove('show'), 1300);
    },
  };
};

/* ------------------------------------------------------------------ */
/* 녹화 준비                                                             */
/* ------------------------------------------------------------------ */

const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'ko-KR' });
await context.addInitScript(() => {
  // 파일 열기 창을 브라우저 기본 방식으로 (자동화용)
  window.showOpenFilePicker = undefined;
  window.showSaveFilePicker = undefined;
});
await context.addInitScript(OVERLAY);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const promo = (fn, arg) => page.evaluate(fn, arg);

let mouse = { x: W / 2, y: H / 2 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** 사람처럼 부드럽게 마우스 이동 (정해진 시간 안에 도착) */
async function glide(x, y, ms = 500) {
  const from = { ...mouse };
  const start = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - start) / ms);
    const t = ease(k);
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
    if (k >= 1) break;
    await sleep(12);
  }
  mouse = { x, y };
}
async function centerOf(locator) {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`not visible: ${locator}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function clickOn(locator, ms = 450) {
  const c = await centerOf(locator);
  await glide(c.x, c.y, ms);
  await sleep(80);
  await page.mouse.down();
  await sleep(50);
  await page.mouse.up();
}
async function menu(title, item) {
  await clickOn(page.locator('.menu-title', { hasText: new RegExp(`^${title}$`) }), 380);
  await sleep(150);
  await clickOn(page.locator('.menu-dropdown .menu-item', { hasText: item }), 330);
}
// "저장하지 않은 작업" 확인 창은 화면 장식(OVERLAY)이 보이지 않게 바로 확인합니다.
async function confirmIfAsked() {
  await sleep(60);
}
async function openSampleFromMenu(name) {
  await menu('도움말', name);
  await confirmIfAsked();
}
async function press(keys, label) {
  await promo((k) => window.__promo.key(k), label);
  await sleep(180);
  await page.keyboard.press(keys);
}
const caption = (ko, en) => promo(([a, b]) => window.__promo.caption(a, b), [ko, en]);

await page.goto(BASE);
await page.waitForSelector('.sample-card');
await page.mouse.move(mouse.x, mouse.y);

// 녹화 시작 (화면이 바뀔 때마다 프레임이 들어옵니다)
const cdp = await context.newCDPSession(page);
const frames = [];
let frameNo = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = join(FRAMES, `f${String(frameNo++).padStart(5, '0')}.jpg`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* 장면 0: 타이틀 (0 ~ 3초)                                               */
/* ------------------------------------------------------------------ */
await promo(() =>
  window.__promo.card(`
    <div class="logo"><i></i><i></i><i></i><i></i></div>
    <h1 class="promo-fade-up" style="animation-delay:.35s">Pixel Editor</h1>
    <h2 class="promo-fade-up" style="animation-delay:.6s">누구나 바로 만드는 <em>도트 애니메이션</em></h2>
    <p class="promo-fade-up" style="animation-delay:.85s">Pixel art &amp; animation editor for everyone</p>`),
);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const t0 = Date.now();
await sleep(2400);
await promo(() => window.__promo.hideCard());
await sleep(350);

/* ------------------------------------------------------------------ */
/* 장면 1: 예제 열기 → 키프레임 슬라임 (3 ~ 7초)                            */
/* ------------------------------------------------------------------ */
await clickOn(page.locator('.sample-card', { hasText: '통통 슬라임' }), 550);
await sleep(150);
await caption('키프레임 + 이징으로 <em>살아 움직이는</em> 도트', 'Keyframes & easing curves — squash, stretch, bounce');
await glide(860, 470, 700);
await sleep(1900);
await caption('');

/* ------------------------------------------------------------------ */
/* 장면 2: 걷기 2장 → 자동 중간 프레임 (7 ~ 13초)                          */
/* ------------------------------------------------------------------ */
await openSampleFromMenu('걷기 2장');
await sleep(150);
await caption('2장만 그리면, <em>중간 프레임은 자동으로</em>', 'Draw 2 key poses — Auto In-betweens does the rest');
await sleep(350);
await press('Shift+I', ['Shift', 'I']);
await page.waitForSelector('.modal');
await sleep(600);
await clickOn(page.locator('.modal .toggle', { hasText: '돌아오는 동작도' }), 420);
await sleep(300);
await clickOn(page.locator('.modal .btn.primary'), 400);
await sleep(300);
await press('Enter', ['Enter']);
await glide(900, 520, 500);
await caption('2장 → <em>14장</em> 걷기 반복 완성', 'Walk cycle generated: 2 → 14 frames');
await sleep(1700);
await caption('');

/* ------------------------------------------------------------------ */
/* 장면 3: 바람 · 파티클 (13 ~ 17초)                                       */
/* ------------------------------------------------------------------ */
await openSampleFromMenu('바람 부는 나무');
await sleep(100);
await caption('바람 · 머리카락 · 파티클 — <em>클릭 한 번</em>', 'Wind sway, hair, particles — one-click natural effects');
await glide(1500, 500, 600);
await sleep(1900);
await caption('');

/* ------------------------------------------------------------------ */
/* 장면 4: AI 도트 이미지 정리 (17 ~ 22초)                                 */
/* ------------------------------------------------------------------ */
await menu('파일', 'AI 도트 이미지 정리');
await page.waitForSelector('.modal');
await caption('AI 그림을 <em>진짜 픽셀아트</em>로', 'AI image → true 1:1 pixel art · auto grid · palette fix');
const chooser = page.waitForEvent('filechooser');
await clickOn(page.locator('.modal .btn.small', { hasText: '이미지 열기' }), 450);
await (await chooser).setFiles(SPRITE);
await page.waitForFunction(() => document.querySelector('.modal .foot-info')?.textContent?.includes('×'));
await glide(1500, 420, 600);
await sleep(1100);
await clickOn(page.locator('.modal .btn.primary'), 450);
await confirmIfAsked();
await sleep(900);
await caption('');

/* ------------------------------------------------------------------ */
/* 장면 5: 뼈대 · VFX 추천 (22 ~ 26초)                                     */
/* ------------------------------------------------------------------ */
await openSampleFromMenu('팔 흔들기');
await sleep(100);
await press('p', ['P']);
await caption('뼈대 · IK로 <em>파츠 애니메이션</em>', 'Bones, IK & mesh deform for cut-out animation');
await glide(1010, 360, 600);
await sleep(1200);
await press('Shift+X', ['Shift', 'X']);
await page.waitForSelector('.modal');
await caption('VFX 넣을 프레임을 <em>자동 추천</em>', 'Smart VFX timing suggestions');
await sleep(1500);
await caption('');
await page.keyboard.press('Escape');

/* ------------------------------------------------------------------ */
/* 장면 6: 내보내기 (26 ~ 28.5초)                                          */
/* ------------------------------------------------------------------ */
await press('Control+e', ['Ctrl', 'E']);
await page.waitForSelector('.modal');
await caption('PNG · GIF · 스프라이트시트 · <em>Aseprite</em>', 'Export anywhere — game engines, social, Aseprite');
await clickOn(page.locator('.modal .tabs button', { hasText: 'GIF' }), 400);
await sleep(300);
await clickOn(page.locator('.modal .tabs button', { hasText: 'Aseprite' }), 350);
await sleep(600);
await caption('');

/* ------------------------------------------------------------------ */
/* 장면 7: 마무리 (28.5 ~ 32초)                                            */
/* ------------------------------------------------------------------ */
await promo(() =>
  window.__promo.card(`
    <div class="logo"><i></i><i></i><i></i><i></i></div>
    <h1 class="promo-fade-up" style="animation-delay:.25s">Pixel Editor</h1>
    <h2 class="promo-fade-up" style="animation-delay:.45s">그리기부터 <em>애니메이션 · 효과 · AI</em>까지, 하나로</h2>
    <div class="chips promo-fade-up" style="animation-delay:.65s"><span>Windows</span><span>macOS</span><span>Linux</span><span>Web</span><span>🤖 Codex AI</span></div>
    <div class="cta promo-fade-up" style="animation-delay:.9s">지금 바로 시작하세요</div>`),
);
await glide(1600, 950, 500);
await sleep(2600);
await cdp.send('Page.stopScreencast');
const total = (Date.now() - t0) / 1000;
await browser.close();
if (errors.length) console.warn('page errors:', errors);

/* ------------------------------------------------------------------ */
/* 영상 만들기 (ffmpeg)                                                   */
/* ------------------------------------------------------------------ */
// 녹화 길이가 목표보다 길면 전체 속도를 같은 비율로 살짝 높입니다. (1.35배 이상은 어색해서 제한)
const recorded = frames[frames.length - 1].t + 0.6 - frames[0].t;
const speed = Math.min(1.35, Math.max(1, recorded / TARGET));
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1]?.t ?? frames[i].t + 0.6;
  lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, (next - frames[i].t) / speed).toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file}'`);
writeFileSync(join(OUT, 'frames.txt'), lines.join('\n'));
const seconds = Math.ceil(recorded / speed + 0.5);
const music = join(OUT, 'music.wav');
writeWav(music, makeChiptune(seconds));
const mp4 = join(OUT, 'pixel-editor-promo.mp4');
execFileSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', join(OUT, 'frames.txt'),
    '-i', music,
    '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    mp4,
  ],
  { stdio: 'inherit' },
);
console.log(`frames: ${frames.length}, recorded ${total.toFixed(1)}s, speed x${speed.toFixed(2)} → ${(recorded / speed).toFixed(1)}s → ${mp4}`);
