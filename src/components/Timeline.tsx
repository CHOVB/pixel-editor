/**
 * 타임라인 (화면 아래쪽)
 * ------------------------------------------------------------
 * 애니메이션은 "프레임(장면)"을 빠르게 넘겨서 움직이는 것처럼 보이게 하는 것입니다.
 *  - 프레임 클릭: 그 프레임으로 이동 / Shift+클릭: 여러 프레임 범위 선택
 *  - 프레임 더블클릭: 재생 시간(ms) 바꾸기
 *  - 프레임을 끌어서 놓기: 순서 바꾸기
 *  - 태그: 프레임 구간에 이름 붙이기 (예: 걷기, 점프). 태그를 클릭하면 그 구간만 반복 재생
 *  - 어니언 스킨: 앞/뒤 프레임을 반투명하게 겹쳐 보여줘서 움직임을 맞추기 쉽게 합니다.
 */
import { useState } from 'react';
import { compositeFrame } from '../core/render';
import { frameVersion } from '../editor/celVersions';
import { useT } from '../i18n';
import {
  addFrameAction,
  deleteFramesAction,
  duplicateFramesAction,
  gotoFrame,
  moveCurrentFrameBy,
  moveFrameAction,
  nextFrame,
  prevFrame,
  reverseFramesAction,
  selectFrameRange,
  selectedFrames,
  setAllFps,
} from '../store/actions';
import { setState, useEditor, type LoopMode } from '../store/editorStore';
import { Icon } from './Icon';
import { Thumbnail } from './Thumbnail';
import { IconButton, NumberField } from './ui';

const CELL = 60; // 프레임 칸 너비(px) + 간격
const LOOP_ORDER: LoopMode[] = ['loop', 'pingpong', 'once'];

export function Timeline() {
  const t = useT();
  const project = useEditor((s) => s.project);
  useEditor((s) => s.docVersion); // 문서가 바뀌면 다시 그리기
  const currentFrame = useEditor((s) => s.currentFrame);
  const frameRange = useEditor((s) => s.frameRange);
  const playing = useEditor((s) => s.playing);
  const loopMode = useEditor((s) => s.loopMode);
  const activeTagId = useEditor((s) => s.activeTagId);
  const onion = useEditor((s) => s.onion);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const frames = project.frames;
  const [rangeA, rangeB] = frameRange ? [Math.min(...frameRange), Math.max(...frameRange)] : [-1, -1];
  const current = frames[Math.min(currentFrame, frames.length - 1)];
  const fps = Math.round(1000 / current.duration);
  const totalMs = frames.reduce((sum, f) => sum + f.duration, 0);

  const loopIcon = loopMode === 'loop' ? 'loop' : loopMode === 'pingpong' ? 'pingpong' : 'once';
  const loopLabel = t(loopMode === 'loop' ? 'timeline.loop' : loopMode === 'pingpong' ? 'timeline.pingpong' : 'timeline.once');

  return (
    <section className="timeline" aria-label={t('panel.timeline')}>
      <div className="timeline-controls">
        <div className="btn-group">
          <IconButton icon="first" label={t('timeline.first')} onClick={() => gotoFrame(0)} size={14} />
          <IconButton icon="prev" label={t('shortcut.prevFrame')} shortcut="," onClick={prevFrame} size={14} />
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? t('menu.pause') : t('menu.play')}
            shortcut="Enter"
            onClick={() => setState({ playing: !playing })}
            active={playing}
            size={16}
            className="play-btn"
          />
          <IconButton icon="next" label={t('shortcut.nextFrame')} shortcut="." onClick={nextFrame} size={14} />
          <IconButton icon="last" label={t('timeline.last')} onClick={() => gotoFrame(frames.length - 1)} size={14} />
        </div>
        <IconButton
          icon={loopIcon}
          label={`${t('timeline.loopMode')}: ${loopLabel}`}
          onClick={() => setState({ loopMode: LOOP_ORDER[(LOOP_ORDER.indexOf(loopMode) + 1) % LOOP_ORDER.length] })}
          size={16}
        />
        <label className="opt" data-tip={t('timeline.fpsTip')}>
          <span>FPS</span>
          <NumberField value={fps} min={1} max={60} width={44} onChange={(v) => setAllFps(v)} />
        </label>

        <div className="divider" />

        <IconButton
          icon="onion"
          label={t('menu.onion')}
          shortcut="Shift+O"
          active={onion.enabled}
          onClick={() => setState({ onion: { ...onion, enabled: !onion.enabled } })}
          size={16}
        />
        {onion.enabled && (
          <div className="onion-opts">
            <label className="opt" data-tip={t('timeline.onionBefore')}>
              <span className="onion-dot prev" />
              <NumberField value={onion.before} min={0} max={5} width={36} onChange={(v) => setState({ onion: { ...onion, before: v } })} />
            </label>
            <label className="opt" data-tip={t('timeline.onionAfter')}>
              <span className="onion-dot next" />
              <NumberField value={onion.after} min={0} max={5} width={36} onChange={(v) => setState({ onion: { ...onion, after: v } })} />
            </label>
            <label className="opt" data-tip={t('timeline.onionOpacity')}>
              <input
                type="range"
                min={5}
                max={90}
                value={Math.round(onion.opacity * 100)}
                onChange={(e) => setState({ onion: { ...onion, opacity: Number(e.target.value) / 100 } })}
                aria-label={t('timeline.onionOpacity')}
              />
            </label>
            <label className="toggle-inline">
              <input type="checkbox" checked={onion.tint} onChange={(e) => setState({ onion: { ...onion, tint: e.target.checked } })} />
              {t('timeline.onionTint')}
            </label>
          </div>
        )}

        <div className="divider" />

        <div className="btn-group">
          <IconButton icon="plus" label={t('menu.newFrame')} shortcut="N" onClick={addFrameAction} size={16} />
          <IconButton icon="copy" label={t('menu.duplicateFrame')} shortcut="Shift+D" onClick={duplicateFramesAction} size={16} />
          <IconButton icon="trash" label={t('menu.deleteFrame')} onClick={deleteFramesAction} size={16} />
          <IconButton icon="left" label={t('menu.frameLeft')} onClick={() => moveCurrentFrameBy(-1)} size={16} />
          <IconButton icon="right" label={t('menu.frameRight')} onClick={() => moveCurrentFrameBy(1)} size={16} />
          <IconButton icon="reverse" label={t('menu.reverseFrames')} onClick={reverseFramesAction} size={16} />
          <IconButton
            icon="tag"
            label={t('menu.newTag')}
            onClick={() => {
              const [from, to] = selectedFrames();
              setState({ dialog: { id: 'tag', payload: { from, to } } });
            }}
            size={16}
          />
        </div>

        <span className="spacer" />
        <span className="timeline-info">
          {t('timeline.info', { count: frames.length, seconds: (totalMs / 1000).toFixed(2) })}
        </span>
      </div>

      <div className="timeline-scroll">
        <div className="timeline-inner" style={{ width: frames.length * CELL + 64 }}>
          <div className="tag-row">
            {project.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={`tag-chip ${activeTagId === tag.id ? 'active' : ''}`}
                style={{
                  left: tag.from * CELL,
                  width: (tag.to - tag.from + 1) * CELL - 4,
                  ['--tag' as string]: tag.color,
                }}
                onClick={() => setState({ activeTagId: activeTagId === tag.id ? null : tag.id })}
                onDoubleClick={() => setState({ dialog: { id: 'tag', payload: { tagId: tag.id } } })}
                data-tip={t('timeline.tagTip')}
              >
                {tag.name}
              </button>
            ))}
            {project.tags.length === 0 && <span className="tag-empty">{t('timeline.noTags')}</span>}
          </div>

          <div className="frame-row">
            {frames.map((frame, i) => {
              const inRange = i >= rangeA && i <= rangeB;
              return (
                <div
                  key={frame.id}
                  className={`frame-cell ${i === currentFrame ? 'active' : ''} ${inRange ? 'in-range' : ''} ${dropAt === i && dragFrom !== i ? 'drop-target' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                  }}
                  onDragOver={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    setDropAt(i);
                  }}
                  onDragLeave={() => setDropAt(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null && dragFrom !== i) moveFrameAction(dragFrom, i);
                    setDragFrom(null);
                    setDropAt(null);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDropAt(null);
                  }}
                  onClick={(e) => {
                    if (e.shiftKey) selectFrameRange(i);
                    else gotoFrame(i);
                  }}
                  onDoubleClick={() => setState({ dialog: { id: 'frameDuration', payload: { index: i } } })}
                  data-tip={t('timeline.frameTip', { n: i + 1, ms: frame.duration })}
                >
                  <Thumbnail
                    getPixels={() => compositeFrame(project, i)}
                    width={project.width}
                    height={project.height}
                    size={44}
                    version={frameVersion(project, i)}
                    className="checker"
                  />
                  <div className="frame-meta">
                    <span className="frame-num">{i + 1}</span>
                    <span className="frame-ms">{frame.duration}ms</span>
                  </div>
                </div>
              );
            })}
            <button type="button" className="frame-add" onClick={addFrameAction} data-tip={t('menu.newFrame')} aria-label={t('menu.newFrame')}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
