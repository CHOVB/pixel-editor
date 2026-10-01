/**
 * 타임라인 (화면 아래쪽) – 레이어 × 프레임 격자
 * ------------------------------------------------------------
 *  가로 = 프레임(시간), 세로 = 레이어
 *
 *  칸(셀) 표시
 *   ●  그림이 있음
 *   ━  앞 프레임과 같은 그림(링크)   ┄  앞 그림을 계속 사용(움직이는 레이어)
 *   ◆  키프레임(움직임 기록)
 *
 *  - 칸 클릭: 그 레이어/프레임 선택 · Shift+클릭: 프레임 범위 선택
 *  - 오른쪽 클릭: 메뉴 (키프레임, 링크, 비우기 ...)
 *  - 프레임 머리(썸네일) 더블클릭: 재생 시간 / 끌어서 순서 바꾸기
 *  - 레이어 이름: 더블클릭으로 이름 변경, 끌어서 순서 변경(그룹 가운데에 놓으면 그룹 안으로)
 */
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { keyAt } from '../core/keyframes';
import { flattenTree, getCel, isLinkedToPrev, sourceFrameId, type TreeRow } from '../core/project';
import { compositeFrame } from '../core/render';
import type { Layer } from '../core/types';
import { useT } from '../i18n';
import {
  addFrameAction,
  addGroupAction,
  addLayerAction,
  addSketchLayerAction,
  bakeLayerAction,
  deleteFramesAction,
  deleteLayerAction,
  duplicateFramesAction,
  duplicateLayerAction,
  gotoFrame,
  mergeDownAction,
  moveCurrentFrameBy,
  moveFrameAction,
  moveLayerBy,
  nextFrame,
  openContextMenu,
  placeLayerAction,
  prevFrame,
  renameLayer,
  reverseFramesAction,
  selectFrameRange,
  selectLayer,
  selectedFrames,
  setAllFps,
  toggleGuide,
  toggleLayerExpanded,
  toggleLayerLocked,
  toggleLayerVisible,
} from '../store/actions';
import { clearCelsAction, gotoNeighborKey, linkCelsAction, openInbetweenDialog, toggleKeyframeAction, unlinkCelAction } from '../store/animActions';
import { getState, setState, useEditor, type LoopMode } from '../store/editorStore';
import { Icon, type IconName } from './Icon';
import { Thumbnail } from './Thumbnail';
import { IconButton, NumberField } from './ui';

const CELL = 34;
const LEFT = 210;
const LOOP_ORDER: LoopMode[] = ['loop', 'pingpong', 'once'];

function kindIcon(layer: Layer): IconName {
  if (layer.kind === 'group') return 'folder';
  if (layer.kind === 'reference') return 'image';
  if (layer.kind === 'particles') return 'sparkle';
  if (layer.guide) return 'sketch';
  return 'layers';
}

/** 위/아래 여백 비율로 "위에/아래에/안에" 놓을지 결정 */
function dropWhere(e: ReactDragEvent<HTMLDivElement>, isGroup: boolean): 'above' | 'below' | 'inside' {
  const r = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientY - r.top) / r.height;
  if (isGroup && ratio > 0.3 && ratio < 0.7) return 'inside';
  return ratio < 0.5 ? 'above' : 'below';
}

export function Timeline() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const docVersion = useEditor((s) => s.docVersion);
  const currentFrame = useEditor((s) => s.currentFrame);
  const currentLayerId = useEditor((s) => s.currentLayerId);
  const frameRange = useEditor((s) => s.frameRange);
  const playing = useEditor((s) => s.playing);
  const loopMode = useEditor((s) => s.loopMode);
  const activeTagId = useEditor((s) => s.activeTagId);
  const onion = useEditor((s) => s.onion);
  const linkOnDuplicate = useEditor((s) => s.linkOnDuplicate);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const [dropFrame, setDropFrame] = useState<number | null>(null);
  const [dragLayer, setDragLayer] = useState<string | null>(null);
  const [dropLayer, setDropLayer] = useState<{ id: string; where: 'above' | 'below' | 'inside' } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [onionOpen, setOnionOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const frames = project.frames;
  const [rangeA, rangeB] = frameRange ? [Math.min(...frameRange), Math.max(...frameRange)] : [-1, -1];
  const current = frames[Math.min(currentFrame, frames.length - 1)];
  const fps = Math.round(1000 / current.duration);
  const totalMs = frames.reduce((sum, f) => sum + f.duration, 0);
  const rows: TreeRow[] = flattenTree(project);
  const currentLayer = project.layers.find((l) => l.id === currentLayerId);
  const hasKeyHere = !!keyAt(currentLayer?.anim ?? null, current.id);

  // 현재 프레임이 보이도록 가로 스크롤 따라가기
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const x = LEFT + currentFrame * CELL;
    if (x < grid.scrollLeft + LEFT) grid.scrollLeft = x - LEFT;
    else if (x + CELL > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = x + CELL - grid.clientWidth + 8;
  }, [currentFrame]);

  const loopIcon: IconName = loopMode === 'loop' ? 'loop' : loopMode === 'pingpong' ? 'pingpong' : 'once';
  const loopLabel = t(loopMode === 'loop' ? 'timeline.loop' : loopMode === 'pingpong' ? 'timeline.pingpong' : 'timeline.once');

  const selectCell = (layerId: string, frameIndex: number, e: ReactMouseEvent) => {
    selectLayer(layerId);
    if (e.shiftKey) selectFrameRange(frameIndex);
    else gotoFrame(frameIndex);
  };

  const keepOrGoto = (index: number) => {
    const s = getState();
    if (!s.frameRange || index < Math.min(...s.frameRange) || index > Math.max(...s.frameRange)) gotoFrame(index);
  };

  const cellMenu = (layer: Layer, frameIndex: number, e: ReactMouseEvent) => {
    e.preventDefault();
    selectLayer(layer.id);
    keepOrGoto(frameIndex);
    const key = keyAt(layer.anim, frames[frameIndex].id);
    openContextMenu(e.clientX, e.clientY, [
      { label: key ? t('menu.removeKey') : t('menu.addKey'), run: toggleKeyframeAction, shortcut: 'K' },
      'sep',
      { label: t('menu.linkCels'), run: linkCelsAction },
      { label: t('menu.unlinkCels'), run: unlinkCelAction },
      { label: t('menu.clearCels'), run: clearCelsAction, danger: true },
      'sep',
      { label: t('menu.duplicateFrame'), run: () => duplicateFramesAction(), shortcut: 'Shift+D' },
      { label: t('menu.inbetween'), run: openInbetweenDialog },
      { label: t('menu.deleteFrame'), run: deleteFramesAction, danger: true },
    ]);
  };

  const layerMenu = (layer: Layer, e: ReactMouseEvent) => {
    e.preventDefault();
    selectLayer(layer.id);
    openContextMenu(e.clientX, e.clientY, [
      { label: t('menu.layerProps'), run: () => setState({ dialog: { id: 'layerProps' } }) },
      { label: t('menu.duplicateLayer'), run: duplicateLayerAction },
      { label: t('menu.mergeDown'), run: mergeDownAction, disabled: layer.kind === 'group' },
      { label: t('menu.bakeLayer'), run: () => bakeLayerAction(layer.id), disabled: layer.kind === 'reference' },
      {
        label: layer.guide ? t('menu.unmarkSketch') : t('menu.markSketch'),
        run: () => toggleGuide(layer.id),
        checked: layer.guide,
        disabled: layer.kind !== 'pixel',
      },
      'sep',
      { label: t('menu.deleteLayer'), run: () => deleteLayerAction(layer.id), danger: true },
    ]);
  };

  const frameMenu = (index: number, e: ReactMouseEvent) => {
    e.preventDefault();
    keepOrGoto(index);
    const s = getState();
    const pinned = s.onion.pinnedFrameId === frames[index].id;
    openContextMenu(e.clientX, e.clientY, [
      { label: t('menu.frameDuration'), run: () => setState({ dialog: { id: 'frameDuration', payload: { index } } }) },
      { label: t('menu.duplicateFrame'), run: () => duplicateFramesAction() },
      { label: t('menu.inbetween'), run: openInbetweenDialog },
      { label: t('menu.frameTransform'), run: () => setState({ dialog: { id: 'frameTransform' } }) },
      {
        label: t('menu.newTag'),
        run: () => {
          const [from, to] = selectedFrames();
          setState({ dialog: { id: 'tag', payload: { from, to } } });
        },
      },
      {
        label: pinned ? t('menu.unpinOnion') : t('menu.pinOnion'),
        run: () => setState({ onion: { ...s.onion, enabled: true, pinnedFrameId: pinned ? null : frames[index].id } }),
      },
      'sep',
      { label: t('menu.deleteFrame'), run: deleteFramesAction, danger: true },
    ]);
  };

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
          <NumberField value={fps} min={1} max={60} width={42} onChange={(v) => setAllFps(v)} />
        </label>

        <div className="divider" />

        <div className="popover-anchor">
          <IconButton
            icon="onion"
            label={t('menu.onion')}
            shortcut="Shift+O"
            active={onion.enabled}
            onClick={() => setState({ onion: { ...onion, enabled: !onion.enabled } })}
            size={16}
          />
          <button
            type="button"
            className="mini-caret"
            onClick={() => setOnionOpen(!onionOpen)}
            data-tip={t('timeline.onionSettings')}
            aria-label={t('timeline.onionSettings')}
          >
            ▾
          </button>
          {onionOpen && (
            <div className="popover" onMouseLeave={() => setOnionOpen(false)}>
              <label className="opt">
                <span className="onion-dot prev" /> {t('timeline.onionBeforeShort')}
                <NumberField value={onion.before} min={0} max={6} width={40} onChange={(v) => setState({ onion: { ...onion, before: v } })} />
              </label>
              <label className="opt">
                <span className="onion-dot next" /> {t('timeline.onionAfterShort')}
                <NumberField value={onion.after} min={0} max={6} width={40} onChange={(v) => setState({ onion: { ...onion, after: v } })} />
              </label>
              <label className="opt">
                {t('timeline.onionOpacity')}
                <input
                  type="range"
                  min={5}
                  max={90}
                  value={Math.round(onion.opacity * 100)}
                  onChange={(e) => setState({ onion: { ...onion, opacity: Number(e.target.value) / 100 } })}
                />
              </label>
              <label className="toggle-inline">
                <input type="checkbox" checked={onion.tint} onChange={(e) => setState({ onion: { ...onion, tint: e.target.checked } })} />
                {t('timeline.onionTint')}
              </label>
              <label className="toggle-inline">
                <input type="checkbox" checked={onion.wrap} onChange={(e) => setState({ onion: { ...onion, wrap: e.target.checked } })} />
                {t('timeline.onionWrap')}
              </label>
              <label className="toggle-inline" data-tip={t('timeline.onionKeysOnlyTip')}>
                <input type="checkbox" checked={onion.keysOnly} onChange={(e) => setState({ onion: { ...onion, keysOnly: e.target.checked } })} />
                {t('timeline.onionKeysOnly')}
              </label>
              <p className="note">{t('timeline.onionPinTip')}</p>
            </div>
          )}
        </div>

        <div className="divider" />

        <div className="btn-group">
          <IconButton icon="plus" label={t('menu.newFrame')} shortcut="N" onClick={addFrameAction} size={16} />
          <IconButton icon="copy" label={t('menu.duplicateFrame')} shortcut="Shift+D" onClick={() => duplicateFramesAction()} size={16} />
          <IconButton icon="link" label={t('timeline.linkOnDuplicate')} active={linkOnDuplicate} onClick={() => setState({ linkOnDuplicate: !linkOnDuplicate })} size={15} />
          <IconButton icon="trash" label={t('menu.deleteFrame')} onClick={deleteFramesAction} size={16} />
          <IconButton icon="left" label={t('menu.frameLeft')} onClick={() => moveCurrentFrameBy(-1)} size={16} />
          <IconButton icon="right" label={t('menu.frameRight')} onClick={() => moveCurrentFrameBy(1)} size={16} />
          <IconButton icon="reverse" label={t('menu.reverseFrames')} onClick={reverseFramesAction} size={16} />
        </div>

        <div className="divider" />

        <div className="btn-group">
          <IconButton icon="prevKey" label={t('timeline.prevKey')} onClick={() => gotoNeighborKey(-1)} size={15} />
          <IconButton icon="diamond" label={hasKeyHere ? t('menu.removeKey') : t('menu.addKey')} shortcut="K" active={hasKeyHere} onClick={toggleKeyframeAction} size={15} />
          <IconButton icon="nextKey" label={t('timeline.nextKey')} onClick={() => gotoNeighborKey(1)} size={15} />
        </div>

        <button type="button" className="btn small accent" onClick={openInbetweenDialog} data-tip={t('timeline.inbetweenTip')}>
          <Icon name="magic" size={14} /> {t('menu.inbetween')}
        </button>
        <IconButton
          icon="tag"
          label={t('menu.newTag')}
          onClick={() => {
            const [from, to] = selectedFrames();
            setState({ dialog: { id: 'tag', payload: { from, to } } });
          }}
          size={16}
        />

        <span className="spacer" />
        <span className="timeline-info">{t('timeline.info', { count: frames.length, seconds: (totalMs / 1000).toFixed(2) })}</span>
      </div>

      <div className="tl-grid" ref={gridRef} style={{ gridTemplateColumns: `${LEFT}px repeat(${frames.length}, ${CELL}px) 56px` }}>
        {/* 왼쪽 위 모서리: 레이어 버튼 */}
        <div className="tl-corner">
          <div className="tl-corner-buttons">
            <IconButton icon="plus" label={t('menu.newLayer')} shortcut="Shift+N" onClick={addLayerAction} size={14} />
            <IconButton icon="folder" label={t('menu.newGroup')} onClick={addGroupAction} size={14} />
            <IconButton icon="sketch" label={t('menu.newSketch')} onClick={addSketchLayerAction} size={14} />
            <IconButton icon="copy" label={t('menu.duplicateLayer')} onClick={duplicateLayerAction} size={14} />
            <IconButton icon="trash" label={t('menu.deleteLayer')} onClick={() => deleteLayerAction()} size={14} />
          </div>
          <div className="tl-corner-buttons">
            <IconButton icon="up" label={t('menu.layerUp')} shortcut="Ctrl+↑" onClick={() => moveLayerBy(1)} size={14} />
            <IconButton icon="down" label={t('menu.layerDown')} shortcut="Ctrl+↓" onClick={() => moveLayerBy(-1)} size={14} />
            <IconButton icon="merge" label={t('menu.mergeDown')} onClick={mergeDownAction} size={14} />
            <IconButton icon="bake" label={t('menu.bakeLayer')} onClick={() => bakeLayerAction()} size={14} />
          </div>
        </div>

        {/* 태그 줄 */}
        <div className="tl-tags" style={{ gridColumn: `2 / span ${frames.length + 1}` }}>
          {project.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`tag-chip ${activeTagId === tag.id ? 'active' : ''}`}
              style={{ left: tag.from * CELL, width: (tag.to - tag.from + 1) * CELL - 3, ['--tag' as string]: tag.color }}
              onClick={() => setState({ activeTagId: activeTagId === tag.id ? null : tag.id })}
              onDoubleClick={() => setState({ dialog: { id: 'tag', payload: { tagId: tag.id } } })}
              data-tip={t('timeline.tagTip')}
            >
              {tag.name}
            </button>
          ))}
          {project.tags.length === 0 && <span className="tag-empty">{t('timeline.noTags')}</span>}
        </div>

        {/* 프레임 머리 (썸네일) */}
        {frames.map((frame, i) => {
          const inRange = i >= rangeA && i <= rangeB;
          return (
            <div
              key={frame.id}
              className={`tl-frame-head ${i === currentFrame ? 'active' : ''} ${inRange ? 'in-range' : ''} ${dropFrame === i && dragFrame !== i ? 'drop-target' : ''} ${onion.pinnedFrameId === frame.id ? 'pinned' : ''}`}
              style={{ gridColumn: i + 2 }}
              draggable
              onDragStart={(e) => {
                setDragFrame(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', `frame:${i}`);
              }}
              onDragOver={(e) => {
                if (dragFrame === null) return;
                e.preventDefault();
                setDropFrame(i);
              }}
              onDragLeave={() => setDropFrame(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrame !== null && dragFrame !== i) moveFrameAction(dragFrame, i);
                setDragFrame(null);
                setDropFrame(null);
              }}
              onDragEnd={() => {
                setDragFrame(null);
                setDropFrame(null);
              }}
              onClick={(e) => (e.shiftKey ? selectFrameRange(i) : gotoFrame(i))}
              onDoubleClick={() => setState({ dialog: { id: 'frameDuration', payload: { index: i } } })}
              onContextMenu={(e) => frameMenu(i, e)}
              data-tip={t('timeline.frameTip', { n: i + 1, ms: frame.duration })}
            >
              <Thumbnail
                getPixels={() => compositeFrame(project, i)}
                width={project.width}
                height={project.height}
                size={26}
                version={`${docVersion}:${frame.id}:${i}`}
                className="checker"
              />
              <span className="frame-num">{i + 1}</span>
              <span className="frame-ms">{frame.duration}</span>
            </div>
          );
        })}
        <button type="button" className="tl-frame-add" onClick={addFrameAction} data-tip={t('menu.newFrame')} aria-label={t('menu.newFrame')}>
          <Icon name="plus" size={16} />
        </button>

        {/* 레이어 줄들 */}
        {rows.map(({ layer, depth }) => {
          const active = layer.id === currentLayerId;
          const drop = dropLayer?.id === layer.id && dragLayer !== layer.id ? dropLayer.where : null;
          return [
            <div
              key={`${layer.id}-name`}
              className={`tl-layer ${active ? 'active' : ''} ${drop ? `drop-${drop}` : ''} ${layer.guide ? 'guide' : ''}`}
              style={{ paddingLeft: 4 + depth * 14 }}
              draggable={editing !== layer.id}
              onDragStart={(e) => {
                setDragLayer(layer.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', `layer:${layer.id}`);
              }}
              onDragOver={(e) => {
                if (!dragLayer) return;
                e.preventDefault();
                setDropLayer({ id: layer.id, where: dropWhere(e, layer.kind === 'group') });
              }}
              onDragLeave={() => setDropLayer(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragLayer && dragLayer !== layer.id) placeLayerAction(dragLayer, layer.id, dropWhere(e, layer.kind === 'group'));
                setDragLayer(null);
                setDropLayer(null);
              }}
              onDragEnd={() => {
                setDragLayer(null);
                setDropLayer(null);
              }}
              onClick={() => selectLayer(layer.id)}
              onContextMenu={(e) => layerMenu(layer, e)}
            >
              {layer.kind === 'group' ? (
                <button
                  type="button"
                  className="tl-expander"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerExpanded(layer.id);
                  }}
                  aria-label="expand"
                >
                  {layer.expanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tl-expander" />
              )}
              <button
                type="button"
                className={`icon-btn tiny ${layer.visible ? '' : 'off'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayerVisible(layer.id);
                }}
                data-tip={layer.visible ? t('layer.hide') : t('layer.show')}
                aria-label={layer.visible ? t('layer.hide') : t('layer.show')}
              >
                <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={13} />
              </button>
              <button
                type="button"
                className={`icon-btn tiny ${layer.locked ? 'locked' : 'off'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayerLocked(layer.id);
                }}
                data-tip={layer.locked ? t('layer.unlock') : t('layer.lock')}
                aria-label={layer.locked ? t('layer.unlock') : t('layer.lock')}
              >
                <Icon name={layer.locked ? 'lock' : 'unlock'} size={13} />
              </button>
              <Icon name={kindIcon(layer)} size={12} className="tl-kind" />
              {editing === layer.id ? (
                <input
                  className="layer-name-input"
                  defaultValue={layer.name}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    renameLayer(layer.id, e.target.value);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <span
                  className="layer-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditing(layer.id);
                  }}
                  data-tip={t('layer.renameTip')}
                >
                  {layer.name}
                </span>
              )}
              <span className="tl-badges">
                {layer.effects.some((fx) => fx.enabled) && (
                  <span className="badge fx" data-tip={t('badge.effects')}>
                    fx
                  </span>
                )}
                {layer.anim && layer.anim.keys.length > 0 && (
                  <span className="badge anim" data-tip={t('badge.anim')}>
                    ◆
                  </span>
                )}
                {layer.bind?.boneId && (
                  <span className="badge bone" data-tip={t('badge.bone')}>
                    B
                  </span>
                )}
                {layer.guide && (
                  <span className="badge guide" data-tip={t('badge.sketch')}>
                    S
                  </span>
                )}
              </span>
            </div>,
            ...frames.map((frame, i) => {
              const own = getCel(project, layer.id, frame.id);
              const linked = isLinkedToPrev(project, layer.id, i);
              const held = !own && layer.kind === 'pixel' && !!sourceFrameId(project, layer, i);
              const key = keyAt(layer.anim, frame.id);
              const inRange = i >= rangeA && i <= rangeB;
              const showDot = layer.kind === 'pixel' && !!own && !linked;
              return (
                <div
                  key={`${layer.id}-${frame.id}`}
                  className={`tl-cell ${i === currentFrame ? 'col-active' : ''} ${active && i === currentFrame ? 'active' : ''} ${inRange ? 'in-range' : ''} ${linked ? 'linked' : ''} ${held ? 'held' : ''}`}
                  onMouseDown={(e) => {
                    if (e.button === 0) selectCell(layer.id, i, e);
                  }}
                  onContextMenu={(e) => cellMenu(layer, i, e)}
                >
                  {showDot && <span className="dot" />}
                  {key && <span className="kf">◆</span>}
                </div>
              );
            }),
            <div key={`${layer.id}-end`} className="tl-row-end" />,
          ];
        })}

        {/* 뼈대 키프레임 줄 */}
        {project.bones.length > 0 && [
          <div key="bones-name" className="tl-layer bones-row" style={{ paddingLeft: 8 }}>
            <Icon name="bone" size={13} />
            <span className="layer-name">{t('timeline.bonesRow')}</span>
          </div>,
          ...frames.map((frame, i) => {
            const has = project.bones.some((b) => b.keys.some((k) => k.frameId === frame.id));
            return (
              <div key={`bones-${frame.id}`} className={`tl-cell ${i === currentFrame ? 'col-active' : ''}`} onMouseDown={() => gotoFrame(i)}>
                {has && <span className="kf bone">◆</span>}
              </div>
            );
          }),
          <div key="bones-end" className="tl-row-end" />,
        ]}
      </div>
    </section>
  );
}
