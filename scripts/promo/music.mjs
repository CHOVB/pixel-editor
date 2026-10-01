/**
 * 홍보 영상 배경음 – 직접 만든 칩튠(8비트 느낌) 음악
 * ------------------------------------------------------------
 * 외부 음원을 쓰지 않으므로 저작권 걱정이 없습니다.
 * 120 BPM, C - Am - F - G 진행, 펄스파 아르페지오 + 사각파 멜로디 + 삼각파 베이스 + 노이즈 드럼
 *
 *   node scripts/promo/music.mjs out.wav [초]
 */
import { writeFileSync } from 'node:fs';

const RATE = 44100;
const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);

// 코드 (근음 MIDI, 구성음)
const CHORDS = [
  { root: 48, tones: [60, 64, 67, 72] }, // C
  { root: 45, tones: [57, 60, 64, 69] }, // Am
  { root: 41, tones: [53, 57, 60, 65] }, // F
  { root: 43, tones: [55, 59, 62, 67] }, // G
];

// 멜로디 (8분음표 8칸 × 4마디, null = 쉼표)
const MELODY = [
  [76, 79, 84, 79, 76, 79, 81, 79],
  [76, 72, 76, 81, 84, 83, 81, 76],
  [77, 81, 84, 81, 77, 81, 84, 86],
  [86, 83, 79, 83, 86, 88, 86, 83],
];
const MELODY_B = [
  [84, null, 83, 84, 88, null, 86, 84],
  [81, null, 79, 81, 84, null, 83, 81],
  [77, 79, 81, 84, 86, 84, 81, 79],
  [79, 83, 86, 91, 89, 86, 83, 79],
];

function pulse(phase, duty) {
  return phase % 1 < duty ? 1 : -1;
}
function triangle(phase) {
  const p = phase % 1;
  return p < 0.5 ? p * 4 - 1 : 3 - p * 4;
}

/** 간단한 음 하나 더하기 */
function addNote(buf, start, dur, hz, vol, shape, { attack = 0.004, release = 0.03, vibrato = 0 } = {}) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor((dur + release) * RATE);
  let phase = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const vib = vibrato ? 1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.15) : 1;
    phase += (hz * vib) / RATE;
    let env = t < attack ? t / attack : t < dur ? 1 - 0.35 * Math.min(1, (t - attack) / Math.max(0.001, dur)) : Math.max(0, 0.65 * (1 - (t - dur) / release));
    if (env < 0) env = 0;
    buf[s0 + i] += shape(phase) * vol * env;
  }
}

function addKick(buf, start, vol) {
  const s0 = Math.floor(start * RATE);
  let phase = 0;
  for (let i = 0; i < RATE * 0.18 && s0 + i < buf.length; i++) {
    const t = i / RATE;
    phase += (55 + 110 * Math.exp(-t * 30)) / RATE;
    buf[s0 + i] += Math.sin(2 * Math.PI * phase) * vol * Math.exp(-t * 18);
  }
}

let seed = 1;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x3fffffff) - 1;
};

function addNoise(buf, start, dur, vol, decay) {
  const s0 = Math.floor(start * RATE);
  let last = 0;
  for (let i = 0; i < RATE * dur && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const v = noise();
    // 아주 단순한 고역 통과 → 찰랑거리는 소리
    const hp = v - last * 0.6;
    last = v;
    buf[s0 + i] += hp * vol * Math.exp(-t * decay);
  }
}

export function makeChiptune(seconds = 32) {
  const buf = new Float32Array(Math.ceil(seconds * RATE));
  const bars = Math.ceil(seconds / BAR);
  for (let b = 0; b < bars; b++) {
    const t0 = b * BAR;
    const last = b === bars - 1;
    const chord = CHORDS[last ? 0 : b % 4];
    const intro = b < 2;
    // 아르페지오 (16분음표)
    for (let k = 0; k < 16; k++) {
      if (last && k > 0) break;
      const note = chord.tones[k % 4] + 12;
      addNote(buf, t0 + k * (BEAT / 4), last ? BAR : BEAT / 4 - 0.01, midiHz(note), intro ? 0.07 : 0.055, (p) => pulse(p, 0.25));
    }
    // 베이스 (8분음표)
    for (let k = 0; k < 8; k++) {
      if (last && k > 0) break;
      const note = chord.root + (k % 2 === 1 ? 12 : 0);
      addNote(buf, t0 + k * (BEAT / 2), last ? BAR : BEAT / 2 - 0.02, midiHz(note), intro ? 0.12 : 0.18, triangle);
    }
    if (intro) {
      // 인트로: 마디 끝에 드럼 채우기
      if (b === 1) for (let k = 0; k < 4; k++) addNoise(buf, t0 + BEAT * 3 + k * (BEAT / 4), 0.08, 0.1, 30);
      continue;
    }
    if (last) {
      addNote(buf, t0, BAR, midiHz(84), 0.12, (p) => pulse(p, 0.5), { vibrato: 0.006, release: 0.6 });
      addKick(buf, t0, 0.5);
      addNoise(buf, t0, 0.6, 0.12, 6);
      continue;
    }
    // 멜로디
    const mel = (b >= 6 && b < 10 ? MELODY_B : MELODY)[b % 4];
    mel.forEach((note, k) => {
      if (note === null) return;
      addNote(buf, t0 + k * (BEAT / 2), BEAT / 2 - 0.03, midiHz(note), 0.1, (p) => pulse(p, 0.5), { vibrato: 0.004 });
    });
    // 드럼: 쿵(1,3박) 짝(2,4박) 치치(8분)
    for (let beat = 0; beat < 4; beat++) {
      const tb = t0 + beat * BEAT;
      if (beat % 2 === 0) addKick(buf, tb, 0.55);
      else addNoise(buf, tb, 0.14, 0.22, 22);
      addNoise(buf, tb + BEAT / 2, 0.04, 0.06, 80);
      addNoise(buf, tb, 0.03, 0.04, 90);
    }
  }
  // 페이드 인/아웃 + 정규화
  const fadeIn = RATE * 0.3;
  const fadeOut = RATE * 2.5;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i < fadeIn) buf[i] *= i / fadeIn;
    if (i > buf.length - fadeOut) buf[i] *= (buf.length - i) / fadeOut;
    peak = Math.max(peak, Math.abs(buf[i]));
  }
  const gain = 0.85 / (peak || 1);
  for (let i = 0; i < buf.length; i++) buf[i] *= gain;
  return buf;
}

export function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? 'promo-music.wav';
  const seconds = Number(process.argv[3] ?? 32);
  writeWav(out, makeChiptune(seconds));
  console.log(`wrote ${out} (${seconds}s)`);
}
