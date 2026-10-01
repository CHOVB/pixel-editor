/**
 * AI 도트 이미지 정리 대화상자 (이미지 → 진짜 도트)
 * ------------------------------------------------------------
 * AI 로 만든 도트 그림은 해상도가 커서 1칸이 여러 픽셀로 번져 있습니다.
 *  ① 이미지 열기 / 붙여넣기 / Codex 로 새로 만들기
 *  ② 왼쪽 그림에서 드래그해서 사용할 영역 선택 (안 하면 전체)
 *  ③ 크기: "자동 감지"(도트 격자를 찾아서 1칸=1픽셀) 또는 64, 32 같은 크기 지정
 *  ④ 배경 제거, 색 수 줄이기/팔레트 맞추기, 외톨이 픽셀 정리
 *  ⑤ 오른쪽 결과를 보고 → 새 프로젝트 또는 레이어로 가져오기
 * 여러 동작이 한 장에 그려진 경우(스프라이트시트) "나누기" 로 프레임을 만들 수 있습니다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { codexGenerateSprite } from '../../ai/aiTasks';
import { DITHER_MODES, type DitherMode } from '../../core/effects';
import { PALETTE_PRESETS, getPreset, presetToColors } from '../../core/palettes';
import { fixPixelArt, sliceFrames, type FixResult } from '../../core/pixelfix';
import type { Rect } from '../../core/types';
import { openFileObject } from '../../editor/fileActions';
import { addFramesAsLayer, openFramesAsProject } from '../../editor/importActions';
import { useT } from '../../i18n';
import { decodeImageFile, type DecodedImage } from '../../platform/canvas';
import { openFileDialog } from '../../platform/fileio';
import { notify } from '../../store/actions';
import { getState } from '../../store/editorStore';
import { ImagePreview, type PreviewTransform } from '../ImagePreview';
import { NumberField, Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

const SIZE_CHIPS = [16, 24, 32, 48, 64, 96, 128];

export function PixelFixerDialog({ file }: { file?: File }) {
  const t = useT();
  const [source, setSource] = useState<(DecodedImage & { name: string; file?: File }) | null>(null);
  const [region, setRegion] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<'auto' | 'size'>('auto');
  const [cellOverride, setCellOverride] = useState(0);
  const [targetW, setTargetW] = useState(64);
  const [removeBg, setRemoveBg] = useState(true);
  const [bgTolerance, setBgTolerance] = useState(40);
  const [colorMode, setColorMode] = useState<'auto' | 'project' | string>('auto');
  const [colors, setColors] = useState(16);
  const [dither, setDither] = useState<DitherMode>('none');
  const [cleanup, setCleanup] = useState(true);
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(1);
  const [result, setResult] = useState<FixResult | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLog, setAiLog] = useState('');

  const load = useCallback(async (f: Blob, name: string) => {
    try {
      const img = await decodeImageFile(f);
      setSource({ ...img, name, file: f instanceof File ? f : undefined });
      setRegion(null);
      setCellOverride(0);
    } catch {
      notify(t('toast.openFailed'), 'error');
    }
  }, [t]);

  useEffect(() => {
    if (file) void load(file, file.name);
  }, [file, load]);

  // 대화상자가 열려 있는 동안 Ctrl+V 로 이미지 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        void load(f, 'clipboard.png');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [load]);

  // 설정이 바뀌면 잠시 후 결과 다시 계산 (너무 자주 계산하지 않도록)
  useEffect(() => {
    if (!source) return;
    const timer = setTimeout(() => {
      const palette =
        colorMode === 'project' ? getState().project.palette : colorMode !== 'auto' ? presetToColors(getPreset(colorMode)) : undefined;
      setResult(
        fixPixelArt(source.pixels, source.width, source.height, {
          region: region ?? undefined,
          mode,
          cellOverride: cellOverride || undefined,
          targetW,
          sample: 'mode',
          removeBg,
          bgTolerance,
          colors: colorMode === 'auto' ? colors : 0,
          palette,
          dither,
          ditherStrength: 40,
          cleanup,
        }),
      );
    }, 160);
    return () => clearTimeout(timer);
  }, [source, region, mode, cellOverride, targetW, removeBg, bgTolerance, colorMode, colors, dither, cleanup]);

  const sourceOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, tr: PreviewTransform) => {
      if (region) {
        ctx.strokeStyle = '#6c8cff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(tr.ox + region.x * tr.scale, tr.oy + region.y * tr.scale, region.w * tr.scale, region.h * tr.scale);
        ctx.setLineDash([]);
      }
      // 감지한 도트 격자를 얇게 표시
      const g = result?.grid;
      if (g && mode === 'auto' && g.cellW * tr.scale >= 4) {
        const r = region ?? { x: 0, y: 0, w: source?.width ?? 0, h: source?.height ?? 0 };
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = r.x + (g.offsetX % g.cellW); x <= r.x + r.w; x += g.cellW) {
          ctx.moveTo(tr.ox + x * tr.scale, tr.oy + r.y * tr.scale);
          ctx.lineTo(tr.ox + x * tr.scale, tr.oy + (r.y + r.h) * tr.scale);
        }
        for (let y = r.y + (g.offsetY % g.cellH); y <= r.y + r.h; y += g.cellH) {
          ctx.moveTo(tr.ox + r.x * tr.scale, tr.oy + y * tr.scale);
          ctx.lineTo(tr.ox + (r.x + r.w) * tr.scale, tr.oy + y * tr.scale);
        }
        ctx.stroke();
      }
    },
    [region, result, mode, source],
  );

  const onSourcePointer = (kind: 'down' | 'move' | 'up', x: number, y: number) => {
    if (!source) return;
    const cx = Math.max(0, Math.min(source.width, x));
    const cy = Math.max(0, Math.min(source.height, y));
    if (kind === 'down') {
      dragStart.current = { x: cx, y: cy };
      return;
    }
    const s = dragStart.current;
    if (!s) return;
    const r = { x: Math.floor(Math.min(s.x, cx)), y: Math.floor(Math.min(s.y, cy)), w: Math.ceil(Math.abs(cx - s.x)), h: Math.ceil(Math.abs(cy - s.y)) };
    if (kind === 'up') dragStart.current = null;
    setRegion(r.w >= 4 && r.h >= 4 ? r : kind === 'up' ? null : region);
  };

  const outputFrames = (): { frames: Uint8ClampedArray[]; w: number; h: number } | null => {
    if (!result) return null;
    if (cols * rows <= 1) return { frames: [result.pixels], w: result.width, h: result.height };
    const s = sliceFrames(result.pixels, result.width, result.height, cols, rows);
    return { frames: s.frames, w: s.frameW, h: s.frameH };
  };

  const generate = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiLog('');
    try {
      const blob = await codexGenerateSprite(aiPrompt.trim(), targetW, { onLog: setAiLog });
      await load(blob, 'codex.png');
    } catch (err) {
      notify(t('toast.codexFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const name = (source?.name ?? 'sprite').replace(/\.[^.]+$/, '');

  return (
    <Modal
      title={t('dialog.fixer.title')}
      width={980}
      className="fixer"
      footer={
        <>
          <span className="foot-info">{result ? t('dialog.fixer.info', { w: result.width, h: result.height, colors: result.colorCount }) : ''}</span>
          {source?.file && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const f = source.file;
                closeDialog();
                if (f) void openFileObject(f, null, { direct: true });
              }}
            >
              {t('dialog.fixer.openOriginal')}
            </button>
          )}
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!result}
            onClick={() => {
              const out = outputFrames();
              if (!out) return;
              addFramesAsLayer(out.frames, out.w, out.h, name);
              closeDialog();
            }}
          >
            {t('dialog.fixer.asLayer')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!result}
            onClick={() => {
              const out = outputFrames();
              if (!out) return;
              openFramesAsProject(out.frames, out.w, out.h, name);
              closeDialog();
            }}
          >
            {t('dialog.fixer.asProject')}
          </button>
        </>
      }
    >
      <p className="note">💡 {t('dialog.fixer.intro')}</p>
      <div className="fixer-grid">
        <div className="col">
          <div className="btn-row">
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                const r = await openFileDialog(['image/*']);
                if (r) void load(r.file, r.file.name);
              }}
            >
              {t('dialog.fixer.openImage')}
            </button>
            <span className="note">{t('dialog.fixer.pasteHint')}</span>
          </div>
          <ImagePreview
            pixels={source?.pixels ?? null}
            width={source?.width ?? 0}
            height={source?.height ?? 0}
            boxW={420}
            boxH={360}
            crisp={false}
            overlay={sourceOverlay}
            onPointer={onSourcePointer}
            version={`${region?.x},${region?.y},${region?.w},${region?.h}:${result?.grid?.cellW}`}
          />
          <div className="btn-row">
            <span className="note">
              {source ? `${source.width}×${source.height}` : t('dialog.fixer.noImage')}
              {region ? ` · ${t('dialog.fixer.region')}: ${region.w}×${region.h}` : ''}
            </span>
            {region && (
              <button type="button" className="link-btn" onClick={() => setRegion(null)}>
                {t('dialog.fixer.clearRegion')}
              </button>
            )}
          </div>
          <details className="ai-box">
            <summary>🤖 {t('dialog.fixer.codexTitle')}</summary>
            <div className="field">
              <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder={t('dialog.fixer.codexPlaceholder')} />
              <div className="btn-row">
                <button type="button" className="btn small accent" onClick={() => void generate()} disabled={aiBusy || !aiPrompt.trim()}>
                  {aiBusy ? t('dialog.export.working') : t('dialog.fixer.codexRun')}
                </button>
                <span className="note">{t('dialog.fixer.codexNote')}</span>
              </div>
              {aiBusy && <pre className="log-box small">{aiLog || t('dialog.codex.waiting')}</pre>}
            </div>
          </details>
        </div>

        <div className="col settings">
          <div className="field">
            <span className="field-label">{t('dialog.fixer.size')}</span>
            <div className="segmented">
              <button type="button" className={mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')} data-tip={t('dialog.fixer.autoTip')}>
                {t('dialog.fixer.auto')}
              </button>
              <button type="button" className={mode === 'size' ? 'active' : ''} onClick={() => setMode('size')}>
                {t('dialog.fixer.fixed')}
              </button>
            </div>
          </div>
          {mode === 'auto' ? (
            <label className="opt" data-tip={t('dialog.fixer.cellTip')}>
              {t('dialog.fixer.cell')}
              <NumberField
                value={cellOverride || Math.round((result?.grid?.cellW ?? 0) * 10) / 10}
                min={0}
                max={128}
                step={0.1}
                width={60}
                suffix="px"
                onChange={setCellOverride}
              />
              {cellOverride > 0 && (
                <button type="button" className="link-btn" onClick={() => setCellOverride(0)}>
                  {t('dialog.fixer.redetect')}
                </button>
              )}
            </label>
          ) : (
            <div className="scale-row">
              {SIZE_CHIPS.map((s) => (
                <button key={s} type="button" className={`chip ${targetW === s ? 'active' : ''}`} onClick={() => setTargetW(s)}>
                  {s}
                </button>
              ))}
              <NumberField value={targetW} min={4} max={1024} width={56} suffix="px" onChange={setTargetW} />
            </div>
          )}
          <Toggle checked={removeBg} onChange={setRemoveBg} tip={t('dialog.fixer.bgTip')}>
            {t('dialog.fixer.removeBg')}
          </Toggle>
          {removeBg && (
            <label className="opt">
              {t('opt.tolerance')}
              <input type="range" min={0} max={160} value={bgTolerance} onChange={(e) => setBgTolerance(Number(e.target.value))} />
              {bgTolerance}
            </label>
          )}
          <div className="field">
            <span className="field-label">{t('dialog.fixer.colors')}</span>
            <select value={colorMode} onChange={(e) => setColorMode(e.target.value)}>
              <option value="auto">{t('dialog.fixer.colorsAuto')}</option>
              <option value="project">{t('dialog.fixer.colorsProject')}</option>
              {PALETTE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {colorMode === 'auto' && (
              <label className="opt">
                <input type="range" min={2} max={64} value={colors} onChange={(e) => setColors(Number(e.target.value))} />
                {colors}
              </label>
            )}
          </div>
          <label className="opt">
            {t('fxParam.dither')}
            <select value={dither} onChange={(e) => setDither(e.target.value as DitherMode)}>
              {DITHER_MODES.map((d) => (
                <option key={d} value={d}>
                  {t(`fxOpt.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <Toggle checked={cleanup} onChange={setCleanup}>
            {t('dialog.fixer.cleanup')}
          </Toggle>
          <div className="field">
            <span className="field-label">{t('dialog.fixer.slice')}</span>
            <div className="scale-row">
              <NumberField value={cols} min={1} max={32} width={44} onChange={setCols} />×
              <NumberField value={rows} min={1} max={32} width={44} onChange={setRows} />
              <span className="note">{t('dialog.fixer.sliceTip')}</span>
            </div>
          </div>
        </div>

        <div className="col">
          <span className="field-label">{t('dialog.fixer.result')}</span>
          <ImagePreview pixels={result?.pixels ?? null} width={result?.width ?? 0} height={result?.height ?? 0} boxW={240} boxH={240} version={result ? result.width * 7 + result.colorCount : 0} />
          {result?.grid && mode === 'auto' && (
            <p className="note">
              {t('dialog.fixer.detected', { cell: result.grid.cellW.toFixed(1), conf: Math.round(result.grid.confidence * 100) })}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
