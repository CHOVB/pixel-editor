/**
 * 도우미 대화상자 모음
 * ------------------------------------------------------------
 *  - VfxDialog: 동작 분석 → VFX 넣을 프레임 추천 → 체크해서 한 번에 적용
 *  - CleanupDialog: 외곽선(흰 테두리 등) 추가, 외톨이/구멍/계단/번짐 정리
 *  - ReplaceColorDialog: 여러 프레임/레이어의 색 한 번에 바꾸기
 *  - ImportSheetDialog: 스프라이트시트 이미지를 칸 단위로 잘라 프레임으로 가져오기
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { colorToHex, hexToColor } from '../../core/color';
import { compositeFrame } from '../../core/render';
import { drawVfx, VFX_KINDS, VFX_LENGTH, type VfxKind } from '../../core/vfx';
import { addFramesAsLayer, openFramesAsProject, sliceSheet } from '../../editor/importActions';
import { useT, type TKey } from '../../i18n';
import { decodeImageFile, type DecodedImage } from '../../platform/canvas';
import { openFileDialog } from '../../platform/fileio';
import { replaceColorAction } from '../../store/animActions';
import { getState, useEditor } from '../../store/editorStore';
import { analyzeAnimation, applyCleanupAction, applyVfxAction, cleanupPreview, type CleanupOp, type VfxPlacement } from '../../store/toolActions';
import { ImagePreview, type PreviewTransform } from '../ImagePreview';
import { NumberField, Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

/* ------------------------------------------------------------------ */
/* VFX 추천                                                              */
/* ------------------------------------------------------------------ */

interface Row extends VfxPlacement {
  enabled: boolean;
  reason: string;
  score: number;
}

export function VfxDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const currentFrame = useEditor((s) => s.currentFrame);
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [extend, setExtend] = useState(false);
  const [manualKind, setManualKind] = useState<VfxKind>('impact');
  const [preview, setPreview] = useState(0);

  useEffect(() => {
    const list = analyzeAnimation(scope);
    setRows(
      list.slice(0, 12).map((s, i) => ({
        enabled: i < 4,
        kind: s.kind,
        frame: s.frame,
        x: Math.round(s.x),
        y: Math.round(s.y),
        angle: Math.round(s.angle),
        reason: s.reason,
        score: s.score,
      })),
    );
  }, [scope, project]);

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const selected = rows[preview];

  // 선택한 추천을 미리보기: 해당 프레임 위에 이펙트 첫 장을 겹쳐 보여줌
  const previewPixels = useMemo(() => {
    if (!selected) return null;
    const base = compositeFrame(project, Math.min(selected.frame, project.frames.length - 1));
    const fx = drawVfx(selected.kind, Math.min(1, VFX_LENGTH[selected.kind] - 1), project.width, project.height, { x: selected.x, y: selected.y }, selected.angle);
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i + 3] === 0) continue;
      base[i] = fx[i];
      base[i + 1] = fx[i + 1];
      base[i + 2] = fx[i + 2];
      base[i + 3] = 255;
    }
    return base;
  }, [selected, project]);

  const apply = () => {
    applyVfxAction(
      rows.filter((r) => r.enabled).map(({ kind, frame, x, y, angle }) => ({ kind, frame, x, y, angle })),
      extend,
    );
    closeDialog();
  };

  return (
    <Modal
      title={t('dialog.vfx.title')}
      width={780}
      onSubmit={apply}
      footer={
        <>
          <Toggle checked={extend} onChange={setExtend} tip={t('dialog.vfx.extendTip')}>
            {t('dialog.vfx.extend')}
          </Toggle>
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply} disabled={!rows.some((r) => r.enabled)}>
            {t('dialog.vfx.apply', { count: rows.filter((r) => r.enabled).length })}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.vfx.intro')}</p>
      <div className="segmented">
        <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
          {t('dialog.vfx.scopeAll')}
        </button>
        <button type="button" className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')}>
          {t('dialog.vfx.scopeLayer')}
        </button>
      </div>
      <div className="two-col">
        <div className="col">
          {rows.length === 0 && <p className="note">{t('dialog.vfx.none')}</p>}
          <div className="vfx-list">
            {rows.map((r, i) => (
              <div key={i} className={`vfx-row ${preview === i ? 'active' : ''}`} onClick={() => setPreview(i)}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} onClick={(e) => e.stopPropagation()} />
                <span className="vfx-frame">#{r.frame + 1}</span>
                <span className="vfx-reason">{t(`vfxReason.${r.reason}` as TKey)}</span>
                <select value={r.kind} onChange={(e) => update(i, { kind: e.target.value as VfxKind })} onClick={(e) => e.stopPropagation()}>
                  {VFX_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`vfx.${k}` as TKey)}
                    </option>
                  ))}
                </select>
                <span className="vfx-score">{Math.round(r.score * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <select value={manualKind} onChange={(e) => setManualKind(e.target.value as VfxKind)}>
              {VFX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`vfx.${k}` as TKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const s = getState();
                const sel = s.selection?.bounds;
                setRows([
                  ...rows,
                  {
                    enabled: true,
                    kind: manualKind,
                    frame: currentFrame,
                    x: sel ? sel.x + sel.w / 2 : Math.round(s.project.width / 2),
                    y: sel ? sel.y + sel.h / 2 : Math.round(s.project.height / 2),
                    angle: 0,
                    reason: 'manual',
                    score: 1,
                  },
                ]);
                setPreview(rows.length);
              }}
            >
              {t('dialog.vfx.addManual')}
            </button>
          </div>
        </div>
        <div className="col">
          <ImagePreview pixels={previewPixels} width={project.width} height={project.height} boxW={260} boxH={260} version={JSON.stringify(selected)} />
          {selected && (
            <div className="prop-grid">
              <label>
                X <NumberField value={selected.x} min={-512} max={4096} width={50} onChange={(x) => update(preview, { x })} />
              </label>
              <label>
                Y <NumberField value={selected.y} min={-512} max={4096} width={50} onChange={(y) => update(preview, { y })} />
              </label>
              <label>
                {t('anim.rotation')} <NumberField value={selected.angle} min={-360} max={360} width={50} suffix="°" onChange={(angle) => update(preview, { angle })} />
              </label>
              <label>
                {t('dialog.vfx.frame')} <NumberField value={selected.frame + 1} min={1} max={project.frames.length} width={50} onChange={(f) => update(preview, { frame: f - 1 })} />
              </label>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 외곽선 / 정리                                                          */
/* ------------------------------------------------------------------ */

type CleanupKind = CleanupOp['kind'];

export function CleanupDialog() {
  const t = useT();
  const project = useEditor((s) => s.project);
  useEditor((s) => s.docVersion);
  const [kind, setKind] = useState<CleanupKind>('outline');
  const [color, setColor] = useState('#ffffffff');
  const [thickness, setThickness] = useState(1);
  const [position, setPosition] = useState<'outside' | 'inside'>('outside');
  const [diagonal, setDiagonal] = useState(true);
  const [auto, setAuto] = useState(false);
  const [tolerance, setTolerance] = useState(60);
  const [passes, setPasses] = useState(1);
  const [scope, setScope] = useState<'current' | 'range' | 'all'>('current');

  const op = useMemo<CleanupOp>(() => {
    const c = hexToColor(color) ?? 0xffffffff;
    if (kind === 'outline') return { kind, color: c, thickness, position, diagonal, auto };
    if (kind === 'halo') return { kind, color: c, tolerance, passes };
    return { kind } as CleanupOp;
  }, [kind, color, thickness, position, diagonal, auto, tolerance, passes]);
  const preview = useMemo(() => cleanupPreview(op), [op, project]);

  return (
    <Modal
      title={t('dialog.cleanup.title')}
      width={720}
      footer={
        <>
          <div className="segmented">
            {(['current', 'range', 'all'] as const).map((s) => (
              <button key={s} type="button" className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>
                {t(`dialog.cleanup.scope.${s}`)}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              applyCleanupAction(op, scope);
              closeDialog();
            }}
          >
            {t('common.apply')}
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(['outline', 'halo', 'orphans', 'pinholes', 'jaggies'] as const).map((k) => (
          <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {t(`dialog.cleanup.${k}`)}
          </button>
        ))}
      </div>
      <p className="note">💡 {t(`dialog.cleanup.${kind}Desc`)}</p>
      {(kind === 'outline' || kind === 'halo') && (
        <div className="btn-row">
          <span className="field-label">{t('fxParam.color')}</span>
          <input type="color" value={color.slice(0, 7)} onChange={(e) => setColor(`${e.target.value}ff`)} />
          {['#ffffffff', '#181425ff', '#000000ff'].map((c) => (
            <button key={c} type="button" className="color-dot" style={{ background: c.slice(0, 7) }} onClick={() => setColor(c)} aria-label={c} />
          ))}
          <button type="button" className="chip" onClick={() => setColor(colorToHex(getState().primary, true))}>
            {t('fx.usePrimary')}
          </button>
        </div>
      )}
      {kind === 'outline' && (
        <div className="btn-row">
          <label className="opt">
            {t('fxParam.thickness')} <NumberField value={thickness} min={1} max={4} width={40} onChange={setThickness} />
          </label>
          <div className="segmented">
            <button type="button" className={position === 'outside' ? 'active' : ''} onClick={() => setPosition('outside')}>
              {t('fxOpt.outside')}
            </button>
            <button type="button" className={position === 'inside' ? 'active' : ''} onClick={() => setPosition('inside')}>
              {t('fxOpt.inside')}
            </button>
          </div>
          <Toggle checked={diagonal} onChange={setDiagonal}>
            {t('fxParam.diagonal')}
          </Toggle>
          <Toggle checked={auto} onChange={setAuto} tip={t('dialog.cleanup.autoTip')}>
            {t('fxParam.auto')}
          </Toggle>
        </div>
      )}
      {kind === 'halo' && (
        <div className="btn-row">
          <label className="opt">
            {t('opt.tolerance')}
            <input type="range" min={0} max={200} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
            {tolerance}
          </label>
          <label className="opt">
            {t('dialog.cleanup.passes')} <NumberField value={passes} min={1} max={4} width={40} onChange={setPasses} />
          </label>
        </div>
      )}
      <div className="compare">
        <div>
          <span className="field-label">{t('dialog.cleanup.before')}</span>
          <ImagePreview pixels={preview?.before ?? null} width={project.width} height={project.height} boxW={300} boxH={260} />
        </div>
        <div>
          <span className="field-label">{t('dialog.cleanup.after')}</span>
          <ImagePreview pixels={preview?.after ?? null} width={project.width} height={project.height} boxW={300} boxH={260} version={JSON.stringify(op)} />
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 색 바꾸기                                                              */
/* ------------------------------------------------------------------ */

export function ReplaceColorDialog() {
  const t = useT();
  const s = getState();
  const [from, setFrom] = useState(colorToHex(s.primary, true));
  const [to, setTo] = useState(colorToHex(s.secondary, true));
  const [tolerance, setTolerance] = useState(0);
  const [layers, setLayers] = useState<'current' | 'all'>('current');
  const [frames, setFrames] = useState<'current' | 'range' | 'all'>('all');
  const apply = () => {
    replaceColorAction({ from: hexToColor(from) ?? 0, to: hexToColor(to) ?? 0, tolerance, layers, frames });
    closeDialog();
  };
  return (
    <Modal
      title={t('dialog.replace.title')}
      onSubmit={apply}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            {t('common.apply')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.replace.intro')}</p>
      <div className="btn-row">
        <span className="field-label">{t('dialog.replace.from')}</span>
        <input type="color" value={from.slice(0, 7)} onChange={(e) => setFrom(`${e.target.value}ff`)} />
        <span>→</span>
        <span className="field-label">{t('dialog.replace.to')}</span>
        <input type="color" value={to.slice(0, 7)} onChange={(e) => setTo(`${e.target.value}ff`)} />
      </div>
      <label className="opt">
        {t('opt.tolerance')}
        <input type="range" min={0} max={128} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
        {tolerance}
      </label>
      <div className="field-row">
        <div className="segmented">
          <button type="button" className={layers === 'current' ? 'active' : ''} onClick={() => setLayers('current')}>
            {t('dialog.inbetween.currentLayer')}
          </button>
          <button type="button" className={layers === 'all' ? 'active' : ''} onClick={() => setLayers('all')}>
            {t('dialog.inbetween.allLayers')}
          </button>
        </div>
        <div className="segmented">
          {(['current', 'range', 'all'] as const).map((f) => (
            <button key={f} type="button" className={frames === f ? 'active' : ''} onClick={() => setFrames(f)}>
              {t(`dialog.cleanup.scope.${f}`)}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 스프라이트시트 가져오기                                                 */
/* ------------------------------------------------------------------ */

export function ImportSheetDialog() {
  const t = useT();
  const [img, setImg] = useState<(DecodedImage & { name: string }) | null>(null);
  const [byCount, setByCount] = useState(true);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(1);
  const [frameW, setFrameW] = useState(32);
  const [frameH, setFrameH] = useState(32);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [gapX, setGapX] = useState(0);
  const [gapY, setGapY] = useState(0);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [duration, setDuration] = useState(100);

  const pick = async () => {
    const r = await openFileDialog(['image/*']);
    if (!r) return;
    const d = await decodeImageFile(r.file);
    setImg({ ...d, name: r.file.name.replace(/\.[^.]+$/, '') });
  };

  const fw = img && byCount ? Math.floor((img.width - offsetX - gapX * (cols - 1)) / Math.max(1, cols)) : frameW;
  const fh = img && byCount ? Math.floor((img.height - offsetY - gapY * (rows - 1)) / Math.max(1, rows)) : frameH;
  const frames = useMemo(
    () => (img && fw > 0 && fh > 0 ? sliceSheet(img.pixels, img.width, img.height, { frameW: fw, frameH: fh, offsetX, offsetY, gapX, gapY, skipEmpty }) : []),
    [img, fw, fh, offsetX, offsetY, gapX, gapY, skipEmpty],
  );

  const overlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: PreviewTransform) => {
      if (!img || fw <= 0 || fh <= 0) return;
      ctx.strokeStyle = 'rgba(108,140,255,0.9)';
      ctx.lineWidth = 1;
      for (let y = offsetY; y + fh <= img.height; y += fh + gapY) {
        for (let x = offsetX; x + fw <= img.width; x += fw + gapX) {
          ctx.strokeRect(tr.ox + x * tr.scale + 0.5, tr.oy + y * tr.scale + 0.5, fw * tr.scale - 1, fh * tr.scale - 1);
        }
      }
    },
    [img, fw, fh, offsetX, offsetY, gapX, gapY],
  );

  return (
    <Modal
      title={t('dialog.sheet.title')}
      width={760}
      footer={
        <>
          <span className="foot-info">{t('dialog.sheet.info', { count: frames.length, w: fw, h: fh })}</span>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={frames.length === 0}
            onClick={() => {
              addFramesAsLayer(frames, fw, fh, img?.name ?? 'sheet');
              closeDialog();
            }}
          >
            {t('dialog.fixer.asLayer')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={frames.length === 0}
            onClick={() => {
              openFramesAsProject(frames, fw, fh, img?.name ?? 'sheet', duration);
              closeDialog();
            }}
          >
            {t('dialog.fixer.asProject')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.sheet.intro')}</p>
      <div className="two-col">
        <div className="col">
          <button type="button" className="btn small" onClick={() => void pick()}>
            {t('dialog.fixer.openImage')}
          </button>
          <ImagePreview pixels={img?.pixels ?? null} width={img?.width ?? 0} height={img?.height ?? 0} boxW={400} boxH={300} overlay={overlay} version={`${fw}x${fh}:${offsetX},${offsetY}:${gapX},${gapY}`} />
        </div>
        <div className="col settings">
          <div className="segmented">
            <button type="button" className={byCount ? 'active' : ''} onClick={() => setByCount(true)}>
              {t('dialog.sheet.byCount')}
            </button>
            <button type="button" className={!byCount ? 'active' : ''} onClick={() => setByCount(false)}>
              {t('dialog.sheet.bySize')}
            </button>
          </div>
          {byCount ? (
            <div className="prop-grid">
              <label>
                {t('dialog.export.columns')} <NumberField value={cols} min={1} max={128} width={50} onChange={setCols} />
              </label>
              <label>
                {t('dialog.sheet.rows')} <NumberField value={rows} min={1} max={128} width={50} onChange={setRows} />
              </label>
            </div>
          ) : (
            <div className="prop-grid">
              <label>
                {t('dialog.width')} <NumberField value={frameW} min={1} max={2048} width={56} onChange={setFrameW} />
              </label>
              <label>
                {t('dialog.height')} <NumberField value={frameH} min={1} max={2048} width={56} onChange={setFrameH} />
              </label>
            </div>
          )}
          <div className="prop-grid">
            <label>
              {t('dialog.sheet.offset')} X <NumberField value={offsetX} min={0} max={4096} width={50} onChange={setOffsetX} />
            </label>
            <label>
              {t('dialog.sheet.offset')} Y <NumberField value={offsetY} min={0} max={4096} width={50} onChange={setOffsetY} />
            </label>
            <label>
              {t('dialog.sheet.gap')} X <NumberField value={gapX} min={0} max={512} width={50} onChange={setGapX} />
            </label>
            <label>
              {t('dialog.sheet.gap')} Y <NumberField value={gapY} min={0} max={512} width={50} onChange={setGapY} />
            </label>
          </div>
          <Toggle checked={skipEmpty} onChange={setSkipEmpty}>
            {t('dialog.sheet.skipEmpty')}
          </Toggle>
          <label className="opt">
            {t('dialog.duration.ms')} <NumberField value={duration} min={10} max={10000} width={60} suffix="ms" onChange={setDuration} />
          </label>
        </div>
      </div>
    </Modal>
  );
}
