/**
 * 자동 애니메이션 마법사 (그림 한 장 → 걷기·달리기·점프…)
 * ------------------------------------------------------------
 * 손재주가 없어도 애니메이션을 만들 수 있게 3단계로 안내합니다.
 *  ① 점 찍기   : 머리·목·골반·손·발 7곳 (자동으로 먼저 찍어 주고, 끌어서 고치기)
 *  ② 부위 확인 : 색으로 나눈 부위를 보고, 틀린 곳은 붓으로 칠해서 고치기
 *  ③ 동작 고르기: 6가지 동작이 실제로 움직이는 미리보기를 보고 골라서 "만들기"
 * 이미 만든 리그가 있으면 ③ 부터 시작해서 동작만 더할 수 있습니다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { hexToColor } from '../../core/color';
import { contentBounds } from '../../core/pixels';
import { cropBuffer } from '../../core/pixelfix';
import { guessRigPoints, guessView, paintLabels, previewMotion, previewOnProject, type AutoAnimSetup, type MotionPreview } from '../../core/autoAnimate';
import {
  DEFAULT_BUILD,
  labelOverlay,
  PART_BONE,
  PART_COLORS,
  planJoints,
  RIG_PARTS,
  RIG_POINT_IDS,
  segmentParts,
  type BuildOptions,
  type RigPartId,
  type RigPointId,
  type RigPoints,
} from '../../core/autoRig';
import { motionTemplate, MOTION_IDS, type MotionId } from '../../core/motionTemplates';
import type { Color, Point } from '../../core/types';
import { openSample } from '../../editor/samples';
import { useT, type TKey } from '../../i18n';
import { autoAnimateAction, autoAnimSource, existingRigId, roomFor } from '../../store/autoAnimActions';
import { getState, useEditor } from '../../store/editorStore';
import { ImagePreview, type PreviewTransform } from '../ImagePreview';
import { Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

type Step = 'points' | 'parts' | 'motion';

const POINT_COLORS: Record<RigPointId, string> = {
  head: '#ffd166',
  neck: '#f78c6b',
  pelvis: '#4cc9f0',
  handF: '#ff6b6b',
  handB: '#b388ff',
  footF: '#06d6a0',
  footB: '#8d99ae',
};

const PART_COLOR_VALUES = Object.fromEntries(Object.entries(PART_COLORS).map(([k, v]) => [k, hexToColor(v) as Color])) as Record<RigPartId, Color>;

/** 움직이는 작은 미리보기 */
function AnimPreview({ preview, box, playing = true }: { preview: MotionPreview | null; box: number; playing?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !preview || preview.frames.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = box * dpr;
    c.height = box * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // 그림이 있는 곳만 크게 (모든 프레임을 감싸는 영역 + 여유)
    const b = preview.bounds ?? { x: 0, y: 0, w: preview.width, h: preview.height };
    const side = Math.max(b.w, b.h) + 4;
    const cx = b.x + b.w / 2 - side / 2;
    const cy = b.y + b.h / 2 - side / 2;
    const scale = Math.max(1, Math.floor((box * dpr) / side));
    const ox = (box * dpr - side * scale) / 2;
    const tmp = document.createElement('canvas');
    tmp.width = preview.width;
    tmp.height = preview.height;
    const tctx = tmp.getContext('2d');
    let frame = 0;
    let last = performance.now();
    let raf = 0;
    const draw = () => {
      if (!tctx) return;
      tctx.putImageData(new ImageData(new Uint8ClampedArray(preview.frames[frame]), preview.width, preview.height), 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, cx, cy, side, side, ox, ox, side * scale, side * scale);
    };
    const tick = (now: number) => {
      if (playing && now - last >= preview.durations[frame]) {
        last = now;
        frame = (frame + 1) % preview.frames.length;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    draw();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [preview, box, playing]);
  return <canvas ref={ref} className="anim-preview checker" style={{ width: box, height: box }} />;
}

export function AutoAnimateDialog() {
  const t = useT();
  const payload = useEditor((s) => s.dialog?.payload);
  const [src] = useState(() => autoAnimSource());
  const [rigId] = useState(() => existingRigId());
  const [reuse, setReuse] = useState(!!rigId);
  const [step, setStep] = useState<Step>(rigId ? 'motion' : 'points');

  const [view, setView] = useState<'side' | 'front'>(() => (src ? guessView(src.pixels, src.width, src.height) : 'side'));
  const [facing, setFacing] = useState<1 | -1>(1);
  const [points, setPoints] = useState<Partial<RigPoints>>(
    () => (payload?.points as RigPoints | undefined) ?? (src ? (guessRigPoints(src.pixels, src.width, src.height, 1) ?? {}) : {}),
  );
  const [active, setActive] = useState<RigPointId>('head');
  const dragging = useRef<RigPointId | null>(null);
  const [labels, setLabels] = useState<Int8Array | null>(null);
  const [labelsVersion, setLabelsVersion] = useState(0);
  const [brush, setBrush] = useState<RigPartId | null>(null);
  const painting = useRef(false);
  const [build, setBuild] = useState<BuildOptions>({ ...DEFAULT_BUILD, rebuildBackLimbs: view === 'side' });

  const [motions, setMotions] = useState<MotionId[]>(['walk']);
  const [strength, setStrength] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [expand, setExpand] = useState(true);
  const [previews, setPreviews] = useState<Partial<Record<MotionId, MotionPreview | null>>>({});

  const complete = RIG_POINT_IDS.every((k) => points[k]);
  // 점 찍기·부위 확인 화면은 캐릭터가 있는 곳만 크게 보여 줌 (둘레 4픽셀 여유)
  const crop = useMemo(() => {
    if (!src) return null;
    const b = contentBounds(src.pixels, src.width, src.height);
    if (!b) return { x: 0, y: 0, w: src.width, h: src.height };
    const x = Math.max(0, b.x - 4);
    const y = Math.max(0, b.y - 4);
    return { x, y, w: Math.min(src.width, b.x + b.w + 4) - x, h: Math.min(src.height, b.y + b.h + 4) - y };
  }, [src]);
  const cropped = useMemo(() => (src && crop ? cropBuffer(src.pixels, src.width, crop) : null), [src, crop]);
  const setup: AutoAnimSetup | null = complete ? { points: points as RigPoints, facing, view, build, labels: labels ?? undefined } : null;

  // 점이 바뀌면 부위 나누기를 다시 (사용자가 고친 것은 버림)
  const joints = useMemo(() => (src && complete ? planJoints(src.pixels, src.width, src.height, points as RigPoints, view) : null), [src, points, complete, view]);
  useEffect(() => setLabels(null), [points, view]);
  const ensureLabels = () => {
    if (!src || !joints) return null;
    if (labels) return labels;
    const l = segmentParts(src.pixels, src.width, src.height, joints);
    setLabels(l);
    return l;
  };

  // ③ 미리보기 만들기 (화면이 멈추지 않게 하나씩)
  useEffect(() => {
    if (step !== 'motion') return;
    let cancelled = false;
    setPreviews({});
    const ids = [...MOTION_IDS];
    const next = () => {
      const id = ids.shift();
      if (!id || cancelled) return;
      let prev: MotionPreview | null = null;
      try {
        if (reuse && rigId) prev = previewOnProject(getState().project, rigId, id, { strength, speed });
        else if (src && setup) prev = previewMotion(src.pixels, src.width, src.height, setup, id, { strength, speed });
      } catch (e) {
        console.warn(e);
      }
      if (cancelled) return;
      setPreviews((p) => ({ ...p, [id]: prev }));
      setTimeout(next, 0);
    };
    const timer = setTimeout(next, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // setup 은 매번 새 객체라서, 실제로 바뀌는 값들만 의존
  }, [step, strength, speed, reuse, rigId, src, facing, view, build, labelsVersion, labels, points]);

  const room = useMemo(() => {
    if (step !== 'motion' || !src || !setup || reuse) return null;
    return roomFor(src, setup, motions, { strength, speed });
  }, [step, src, motions, strength, speed, reuse, labelsVersion, build, facing, view]);
  const needsRoom = !!room && room.top + room.bottom + room.left + room.right > 0;
  const frameCount = motions.reduce((n, m) => n + motionTemplate(m).poses.length, 0);

  /* ---------------- 그림 위에 점/뼈 그리기 ---------------- */
  const pointOverlay = (ctx: CanvasRenderingContext2D, tf: PreviewTransform) => {
    const cx = crop?.x ?? 0;
    const cy = crop?.y ?? 0;
    const at = (q: Point) => ({ x: tf.ox + (q.x - cx) * tf.scale, y: tf.oy + (q.y - cy) * tf.scale });
    if (joints) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      for (const part of RIG_PARTS) {
        const [a, b] = PART_BONE[part];
        const pa = at(joints[a]);
        const pb = at(joints[b]);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    }
    RIG_POINT_IDS.forEach((k, n) => {
      const q = points[k];
      if (!q) return;
      const s = at(q);
      ctx.beginPath();
      ctx.arc(s.x, s.y, k === active ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = POINT_COLORS[k];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = k === active ? '#ffffff' : '#181425';
      ctx.stroke();
      ctx.fillStyle = '#181425';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n + 1), s.x, s.y + 0.5);
    });
  };

  const onPointPointer = (kind: 'down' | 'move' | 'up', px: number, py: number) => {
    if (!src) return;
    const x = px + (crop?.x ?? 0);
    const y = py + (crop?.y ?? 0);
    const inside = { x: Math.max(0, Math.min(src.width, x)), y: Math.max(0, Math.min(src.height, y)) };
    if (kind === 'down') {
      // 가까운 점을 잡으면 끌기, 아니면 지금 고른 점을 여기에
      let near: RigPointId | null = null;
      let best = 2.2;
      for (const k of RIG_POINT_IDS) {
        const q = points[k];
        if (!q) continue;
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < best) [best, near] = [d, k];
      }
      const target = near ?? active;
      dragging.current = target;
      setActive(target);
      setPoints((p) => ({ ...p, [target]: inside }));
    } else if (kind === 'move' && dragging.current) {
      const target = dragging.current;
      setPoints((p) => ({ ...p, [target]: inside }));
    } else if (kind === 'up' && dragging.current) {
      const placed = dragging.current;
      dragging.current = null;
      // 다음에 찍을 점으로 넘어가기
      const nextMissing = RIG_POINT_IDS.find((k) => k !== placed && !points[k]);
      if (nextMissing) setActive(nextMissing);
    }
  };

  const onPartPointer = (kind: 'down' | 'move' | 'up', px: number, py: number) => {
    if (!src || !brush) return;
    const x = px + (crop?.x ?? 0);
    const y = py + (crop?.y ?? 0);
    if (kind === 'down') painting.current = true;
    if (kind === 'up') {
      painting.current = false;
      return;
    }
    if (!painting.current) return;
    const l = ensureLabels();
    if (!l) return;
    if (paintLabels(l, src.pixels, src.width, src.height, x, y, 1.2, RIG_PARTS.indexOf(brush))) {
      setLabels(l);
      setLabelsVersion((v) => v + 1);
    }
  };

  const overlayPixels = useMemo(() => {
    if (step !== 'parts' || !src || !joints) return null;
    const l = labels ?? segmentParts(src.pixels, src.width, src.height, joints);
    if (!labels) setTimeout(() => setLabels(l), 0);
    const full = labelOverlay(src.pixels, l, PART_COLOR_VALUES, 0.6);
    return crop ? cropBuffer(full, src.width, crop) : full;
  }, [step, src, joints, labels, labelsVersion, crop]);

  const apply = () => {
    if (!setup && !reuse) return;
    const ok = autoAnimateAction({
      setup: setup ?? ({ points: {} as RigPoints, facing, view, build } as AutoAnimSetup),
      motions,
      options: { strength, speed },
      reuseRig: reuse,
      expandCanvas: expand,
    });
    if (ok) closeDialog();
  };

  /* ---------------- 그림이 없을 때 ---------------- */
  if (!src && !rigId) {
    return (
      <Modal title={t('autoAnim.title')} width={520}>
        <p className="note">{t('autoAnim.noDrawing')}</p>
        <button type="button" className="btn accent" onClick={() => openSample('hero', () => {})}>
          ⚔️ {t('autoAnim.openSample')}
        </button>
      </Modal>
    );
  }

  const stepIndex = ['points', 'parts', 'motion'].indexOf(step);
  const footer = (
    <>
      <span className="foot-info">{step === 'motion' ? t('autoAnim.summary', { count: motions.length, frames: frameCount }) : ''}</span>
      {step !== 'points' && !(step === 'motion' && reuse) && (
        <button type="button" className="btn" onClick={() => setStep(step === 'motion' ? 'parts' : 'points')}>
          {t('autoAnim.back')}
        </button>
      )}
      {step !== 'motion' ? (
        <button type="button" className="btn primary" disabled={!complete} onClick={() => setStep(step === 'points' ? 'parts' : 'motion')}>
          {t('autoAnim.next')}
        </button>
      ) : (
        <button type="button" className="btn primary" disabled={motions.length === 0} onClick={apply}>
          ✨ {t('autoAnim.apply')}
        </button>
      )}
    </>
  );

  return (
    <Modal title={t('autoAnim.title')} width={900} className="auto-anim" footer={footer}>
      {rigId && (
        <div className="segmented reuse-choice">
          <button type="button" className={reuse ? 'active' : ''} onClick={() => (setReuse(true), setStep('motion'))}>
            {t('autoAnim.reuse')}
          </button>
          <button type="button" className={!reuse ? 'active' : ''} disabled={!src} onClick={() => (setReuse(false), setStep('points'))}>
            {t('autoAnim.newRig')}
          </button>
        </div>
      )}
      {!(reuse && rigId) && (
        <ol className="wizard-steps">
          {(['points', 'parts', 'motion'] as Step[]).map((s, i) => (
            <li key={s} className={`${s === step ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}>
              {i + 1}. {t(`autoAnim.step.${s}` as TKey)}
            </li>
          ))}
        </ol>
      )}

      {step === 'points' && src && (
        <div className="two-col">
          <div className="col">
            <ImagePreview
              pixels={cropped}
              width={crop?.w ?? src.width}
              height={crop?.h ?? src.height}
              boxW={400}
              boxH={400}
              overlay={pointOverlay}
              onPointer={onPointPointer}
              version={JSON.stringify(points) + active}
              className="rig-canvas"
            />
          </div>
          <div className="col">
            <p className="note">💡 {t('autoAnim.pointsIntro')}</p>
            <ul className="rig-points">
              {RIG_POINT_IDS.map((k, n) => (
                <li key={k}>
                  <button type="button" className={k === active ? 'active' : ''} onClick={() => setActive(k)}>
                    <span className="dot" style={{ background: POINT_COLORS[k] }}>
                      {n + 1}
                    </span>
                    <span className="grow">{t(`autoAnim.point.${k}` as TKey)}</span>
                    <span className={points[k] ? 'ok' : 'todo'}>{points[k] ? '✓' : '…'}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="btn-row">
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  const g = guessRigPoints(src.pixels, src.width, src.height, facing);
                  if (g) setPoints(g);
                }}
              >
                🪄 {t('autoAnim.autoPoints')}
              </button>
            </div>
            <div className="field">
              <span className="field-label">{t('autoAnim.view')}</span>
              <div className="segmented">
                {(['side', 'front'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={view === v ? 'active' : ''}
                    onClick={() => {
                      setView(v);
                      setBuild((b) => ({ ...b, rebuildBackLimbs: v === 'side' }));
                    }}
                  >
                    {t(`autoAnim.view.${v}` as TKey)}
                  </button>
                ))}
              </div>
            </div>
            {view === 'side' && (
              <div className="field">
                <span className="field-label">{t('autoAnim.facing')}</span>
                <div className="segmented">
                  {([1, -1] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={facing === f ? 'active' : ''}
                      onClick={() => {
                        if (f === facing) return;
                        setFacing(f);
                        // 보는 방향이 바뀌면 앞/뒤 손발이 서로 바뀜
                        setPoints((p) => ({ ...p, handF: p.handB, handB: p.handF, footF: p.footB, footB: p.footF }));
                      }}
                    >
                      {t(f === 1 ? 'autoAnim.facing.right' : 'autoAnim.facing.left')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'parts' && src && (
        <div className="two-col">
          <div className="col">
            <ImagePreview
              pixels={overlayPixels}
              width={crop?.w ?? src.width}
              height={crop?.h ?? src.height}
              boxW={400}
              boxH={400}
              onPointer={onPartPointer}
              version={labelsVersion}
              className={`rig-canvas ${brush ? 'painting' : ''}`}
            />
          </div>
          <div className="col">
            <p className="note">💡 {t('autoAnim.partsIntro')}</p>
            <div className="part-legend">
              {RIG_PARTS.map((part) => (
                <button key={part} type="button" className={brush === part ? 'active' : ''} onClick={() => setBrush(brush === part ? null : part)}>
                  <span className="swatch" style={{ background: PART_COLORS[part] }} />
                  {t(`rigPart.${part}` as TKey)}
                </button>
              ))}
            </div>
            <p className="note tiny">{brush ? t('autoAnim.brushOn', { part: t(`rigPart.${brush}` as TKey) }) : t('autoAnim.brushHint')}</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setLabels(null);
                  setLabelsVersion((v) => v + 1);
                }}
              >
                ↺ {t('autoAnim.resetParts')}
              </button>
            </div>
            <div className="field toggles">
              <Toggle checked={build.liveOutline} onChange={(v) => setBuild({ ...build, liveOutline: v })} tip={t('autoAnim.liveOutlineTip')}>
                {t('autoAnim.liveOutline')}
              </Toggle>
              <Toggle checked={build.fillHoles} onChange={(v) => setBuild({ ...build, fillHoles: v })} tip={t('autoAnim.fillHolesTip')}>
                {t('autoAnim.fillHoles')}
              </Toggle>
              <Toggle checked={build.rebuildBackLimbs} onChange={(v) => setBuild({ ...build, rebuildBackLimbs: v })} tip={t('autoAnim.rebuildBackTip')}>
                {t('autoAnim.rebuildBack')}
              </Toggle>
            </div>
          </div>
        </div>
      )}

      {step === 'motion' && (
        <>
          <p className="note">💡 {t('autoAnim.motionIntro')}</p>
          <div className="motion-grid">
            {MOTION_IDS.map((m) => {
              const on = motions.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  className={`motion-card ${on ? 'active' : ''}`}
                  onClick={() => setMotions(on ? motions.filter((x) => x !== m) : MOTION_IDS.filter((x) => x === m || motions.includes(x)))}
                  data-tip={t(`motionTip.${m}` as TKey)}
                >
                  {previews[m] === undefined ? <div className="anim-preview loading">⏳</div> : <AnimPreview preview={previews[m] ?? null} box={120} />}
                  <span className="motion-name">
                    <input type="checkbox" readOnly checked={on} tabIndex={-1} /> {t(`motion.${m}` as TKey)}
                  </span>
                  <small>{t('autoAnim.frames', { n: motionTemplate(m).poses.length })}</small>
                </button>
              );
            })}
          </div>
          <div className="motion-options">
            <label className="opt">
              {t('autoAnim.strength')}
              <input type="range" min={0.5} max={1.5} step={0.1} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
              <span className="mono">{Math.round(strength * 100)}%</span>
            </label>
            <label className="opt">
              {t('autoAnim.speed')}
              <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
              <span className="mono">{Math.round(speed * 100)}%</span>
            </label>
            {needsRoom && room && (
              <Toggle checked={expand} onChange={setExpand} tip={t('autoAnim.expandTip')}>
                {t('autoAnim.expand', { top: room.top, bottom: room.bottom, side: room.left + room.right })}
              </Toggle>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
