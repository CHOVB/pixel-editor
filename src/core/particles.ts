/**
 * 2D 파티클 시스템 (비, 눈, 불꽃, 연기, 반짝임 ...)
 * ------------------------------------------------------------
 * 작은 점(입자)들을 규칙에 따라 만들고 움직여서 자연 효과를 만듭니다.
 *  - 같은 설정이면 항상 같은 결과가 나오도록 "씨앗(seed)" 기반 난수를 사용합니다.
 *    → 프레임을 앞뒤로 넘겨도 결과가 같고, 저장/내보내기 결과도 같습니다.
 *  - 입자는 픽셀 단위로 찍히므로 도트 그림과 잘 어울립니다.
 *  - prewarm(미리 진행)을 켜면 처음부터 효과가 가득 찬 상태로 시작해서 반복 애니메이션에 좋습니다.
 */
import { hexToColor } from './color';
import { createBuffer } from './pixels';
import type { ParticleSettings, Project } from './types';

export const PARTICLE_PRESETS: Record<string, Omit<ParticleSettings, 'x' | 'y' | 'areaW' | 'areaH' | 'preset'>> = {
  rain: {
    rate: 3, burst: 0, lifetime: 18, lifetimeVar: 4, speed: 4, speedVar: 0.6, angle: 100, spread: 4,
    gravityX: 0, gravityY: 0.15, drag: 0, size: 1, sizeEnd: 1, colors: ['#8fd3ffcc', '#5fa8e6aa'], fade: false, seed: 1, prewarm: true,
  },
  snow: {
    rate: 1.2, burst: 0, lifetime: 60, lifetimeVar: 10, speed: 0.5, speedVar: 0.2, angle: 95, spread: 30,
    gravityX: 0.01, gravityY: 0.01, drag: 0.02, size: 1, sizeEnd: 1, colors: ['#ffffffff', '#dde8ffee'], fade: false, seed: 2, prewarm: true,
  },
  leaves: {
    rate: 0.4, burst: 0, lifetime: 70, lifetimeVar: 15, speed: 0.8, speedVar: 0.3, angle: 20, spread: 40,
    gravityX: 0.01, gravityY: 0.02, drag: 0.03, size: 2, sizeEnd: 2, colors: ['#e4a672ff', '#be4a2fff', '#feae34ff'], fade: false, seed: 3, prewarm: true,
  },
  fire: {
    rate: 4, burst: 0, lifetime: 12, lifetimeVar: 4, speed: 0.8, speedVar: 0.4, angle: -90, spread: 25,
    gravityX: 0, gravityY: -0.05, drag: 0.05, size: 2, sizeEnd: 1, colors: ['#fee761ff', '#feae34ff', '#f77622ff', '#e43b44cc', '#3e273166'], fade: true, seed: 4, prewarm: true,
  },
  smoke: {
    rate: 1, burst: 0, lifetime: 30, lifetimeVar: 8, speed: 0.4, speedVar: 0.2, angle: -90, spread: 20,
    gravityX: 0.01, gravityY: -0.01, drag: 0.04, size: 2, sizeEnd: 4, colors: ['#8b9bb4cc', '#5a698899', '#3a446644'], fade: true, seed: 5, prewarm: true,
  },
  sparkle: {
    rate: 0.6, burst: 0, lifetime: 10, lifetimeVar: 4, speed: 0.1, speedVar: 0.1, angle: -90, spread: 180,
    gravityX: 0, gravityY: 0, drag: 0, size: 1, sizeEnd: 1, colors: ['#ffffffff', '#fee761ff', '#2ce8f5cc'], fade: true, seed: 6, prewarm: true,
  },
  dust: {
    rate: 0, burst: 12, lifetime: 10, lifetimeVar: 3, speed: 0.9, speedVar: 0.5, angle: -90, spread: 70,
    gravityX: 0, gravityY: 0.04, drag: 0.1, size: 2, sizeEnd: 1, colors: ['#e8b796ee', '#c28569aa', '#73383966'], fade: true, seed: 7, prewarm: false,
  },
  magic: {
    rate: 2, burst: 0, lifetime: 16, lifetimeVar: 5, speed: 0.6, speedVar: 0.3, angle: -90, spread: 180,
    gravityX: 0, gravityY: -0.03, drag: 0.02, size: 1, sizeEnd: 1, colors: ['#b55088ff', '#f6757aff', '#2ce8f5ff', '#ffffffcc'], fade: true, seed: 8, prewarm: true,
  },
};

export const PARTICLE_PRESET_IDS = Object.keys(PARTICLE_PRESETS);

export function createParticleSettings(preset: string, p: Project): ParticleSettings {
  const base = PARTICLE_PRESETS[preset] ?? PARTICLE_PRESETS.rain;
  const top = preset === 'rain' || preset === 'snow' || preset === 'leaves';
  return {
    preset,
    x: p.width / 2,
    y: top ? -2 : p.height * 0.75,
    areaW: top ? p.width : Math.max(2, Math.round(p.width / 6)),
    areaH: top ? 1 : 2,
    ...structuredClone(base),
  };
}

/** 결정적 난수 (같은 seed → 같은 순서) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** frameIndex 프레임의 파티클 모습을 그립니다. (처음부터 시뮬레이션) */
export function renderParticles(s: ParticleSettings, width: number, height: number, frameIndex: number): Uint8ClampedArray {
  const rand = mulberry32(s.seed * 9973 + 17);
  const warm = s.prewarm ? Math.max(0, Math.round(s.lifetime + s.lifetimeVar)) : 0;
  const steps = frameIndex + warm;
  const particles: Particle[] = [];
  let acc = 0;
  const spawn = () => {
    const ang = ((s.angle + (rand() * 2 - 1) * s.spread) * Math.PI) / 180;
    const speed = Math.max(0, s.speed + (rand() * 2 - 1) * s.speedVar);
    particles.push({
      x: s.x + (rand() - 0.5) * s.areaW,
      y: s.y + (rand() - 0.5) * s.areaH,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      age: 0,
      life: Math.max(1, Math.round(s.lifetime + (rand() * 2 - 1) * s.lifetimeVar)),
    });
  };
  for (let i = 0; i < Math.round(s.burst); i++) spawn();
  for (let step = 0; step < steps; step++) {
    acc += s.rate;
    while (acc >= 1) {
      spawn();
      acc -= 1;
    }
    for (const pt of particles) {
      pt.vx = (pt.vx + s.gravityX) * (1 - s.drag);
      pt.vy = (pt.vy + s.gravityY) * (1 - s.drag);
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.age++;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].age >= particles[i].life) particles.splice(i, 1);
    if (particles.length > 4000) particles.splice(0, particles.length - 4000);
  }
  const colors = s.colors.map((h) => hexToColor(h) ?? 0xffffffff);
  const out = createBuffer(width, height);
  for (const pt of particles) {
    const t = pt.age / pt.life;
    const c = colors.length ? colors[Math.min(colors.length - 1, Math.floor(t * colors.length))] : 0xffffffff;
    let a = c & 255;
    if (s.fade) a = Math.round(a * (1 - t));
    if (a <= 8) continue;
    const size = Math.max(1, Math.round(s.size + (s.sizeEnd - s.size) * t));
    const px = Math.round(pt.x - size / 2);
    const py = Math.round(pt.y - size / 2);
    for (let yy = 0; yy < size; yy++) {
      for (let xx = 0; xx < size; xx++) {
        const x = px + xx;
        const y = py + yy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        out[o] = (c >>> 24) & 255;
        out[o + 1] = (c >>> 16) & 255;
        out[o + 2] = (c >>> 8) & 255;
        out[o + 3] = Math.max(out[o + 3], a);
      }
    }
  }
  return out;
}
