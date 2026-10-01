/**
 * 레이어 패널
 * ------------------------------------------------------------
 * 레이어는 "투명한 종이"를 겹쳐 놓은 것과 같습니다. 위에 있는 레이어가 앞에 보입니다.
 *  - 눈 아이콘: 보이기/숨기기
 *  - 자물쇠: 잠그면 실수로 그려지지 않습니다.
 *  - 이름 더블클릭: 이름 바꾸기
 *  - 끌어서 놓기: 순서 바꾸기
 */
import { useReducer, useState } from 'react';
import { getCel } from '../core/project';
import { celVersion } from '../editor/celVersions';
import { tr, useT } from '../i18n';
import {
  addLayerAction,
  beginStructureEdit,
  deleteLayerAction,
  duplicateLayerAction,
  endStructureEdit,
  mergeDownAction,
  moveLayerBy,
  moveLayerTo,
  previewLayerOpacity,
  renameLayer,
  selectLayer,
  toggleLayerLocked,
  toggleLayerVisible,
  type StructureEditToken,
} from '../store/actions';
import { getState, useEditor } from '../store/editorStore';
import { Icon } from './Icon';
import { Thumbnail } from './Thumbnail';
import { IconButton } from './ui';

let opacityToken: StructureEditToken | null = null;

export function LayersPanel() {
  const t = useT();
  const project = useEditor((s) => s.project);
  useEditor((s) => s.docVersion); // 문서가 바뀌면 다시 그리기
  const currentLayerId = useEditor((s) => s.currentLayerId);
  const currentFrame = useEditor((s) => s.currentFrame);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // 불투명도 슬라이더를 움직일 때 이 컴포넌트만 다시 그리기 위한 장치
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const frame = project.frames[Math.min(currentFrame, project.frames.length - 1)];
  const current = project.layers.find((l) => l.id === currentLayerId);
  // 화면에는 위 레이어가 먼저 보이도록 뒤집어서 표시합니다.
  const rows = project.layers.map((layer, index) => ({ layer, index })).reverse();

  return (
    <div className="layers-panel">
      <div className="layer-list" role="list">
        {rows.map(({ layer, index }) => (
          <div
            key={layer.id}
            role="listitem"
            className={`layer-row ${layer.id === currentLayerId ? 'active' : ''} ${dropIndex === index && dragId !== layer.id ? 'drop-target' : ''}`}
            draggable={editing !== layer.id}
            onDragStart={(e) => {
              setDragId(layer.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', layer.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setDropIndex(index);
            }}
            onDragLeave={() => setDropIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== layer.id) moveLayerTo(dragId, index);
              setDragId(null);
              setDropIndex(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropIndex(null);
            }}
            onClick={() => selectLayer(layer.id)}
          >
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
              <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={14} />
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
              <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
            </button>
            <Thumbnail
              getPixels={() => getCel(project, layer.id, frame.id)}
              width={project.width}
              height={project.height}
              size={28}
              version={celVersion(project, layer.id, frame.id)}
              className="checker"
            />
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
            {layer.opacity < 1 && <span className="layer-opacity">{Math.round(layer.opacity * 100)}%</span>}
          </div>
        ))}
      </div>

      {current && (
        <label className="opt opacity-row">
          <span>{t('layer.opacity')}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(current.opacity * 100)}
            onPointerDown={() => {
              opacityToken = beginStructureEdit();
            }}
            onChange={(e) => {
              if (!opacityToken) opacityToken = beginStructureEdit();
              previewLayerOpacity(current.id, Number(e.target.value) / 100);
              forceRender();
            }}
            onPointerUp={() => {
              if (opacityToken) endStructureEdit(tr('history.layerOpacity'), opacityToken);
              opacityToken = null;
            }}
            onKeyUp={() => {
              if (opacityToken) endStructureEdit(tr('history.layerOpacity'), opacityToken);
              opacityToken = null;
            }}
            aria-label={t('layer.opacity')}
          />
          <span className="value">{Math.round(current.opacity * 100)}%</span>
        </label>
      )}

      <div className="panel-actions">
        <IconButton icon="plus" label={t('menu.newLayer')} shortcut="Shift+N" onClick={addLayerAction} size={16} />
        <IconButton icon="copy" label={t('menu.duplicateLayer')} onClick={duplicateLayerAction} size={16} />
        <IconButton icon="trash" label={t('menu.deleteLayer')} onClick={() => deleteLayerAction(getState().currentLayerId)} size={16} />
        <span className="spacer" />
        <IconButton icon="up" label={t('menu.layerUp')} shortcut="Ctrl+↑" onClick={() => moveLayerBy(1)} size={16} />
        <IconButton icon="down" label={t('menu.layerDown')} shortcut="Ctrl+↓" onClick={() => moveLayerBy(-1)} size={16} />
        <IconButton icon="merge" label={t('menu.mergeDown')} onClick={mergeDownAction} size={16} />
      </div>
    </div>
  );
}
