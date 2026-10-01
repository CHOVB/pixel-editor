/**
 * 상단 메뉴 막대 (파일 / 편집 / 이미지 / 레이어 / 프레임 / 보기 / 도움말)
 * ------------------------------------------------------------
 * 메뉴 항목은 아래의 buildMenus() 에서 "데이터"로 정의하고,
 * 그 데이터를 보고 화면을 그립니다. 메뉴를 추가하려면 배열에 항목만 추가하면 됩니다.
 */
import { useEffect, useRef, useState } from 'react';
import { copySelection, cutSelection, pasteFromMenu } from '../editor/clipboard';
import { confirmDiscard, importImageAsLayer, openFile, saveProject } from '../editor/fileActions';
import { actualSize, fitToScreen, zoomStep } from '../editor/view';
import { useT, type TKey } from '../i18n';
import {
  addFrameAction,
  addLayerAction,
  clearSelectionPixels,
  deleteFramesAction,
  deleteLayerAction,
  deselect,
  duplicateFramesAction,
  duplicateLayerAction,
  flipCanvasAction,
  flipSelectionOrCel,
  history,
  invertSelection,
  mergeDownAction,
  moveCurrentFrameBy,
  moveLayerBy,
  redo,
  reverseFramesAction,
  rotateCanvasAction,
  selectAll,
  selectedFrames,
  undo,
} from '../store/actions';
import { setState, useEditor, type DialogId } from '../store/editorStore';
import { Icon } from './Icon';
import { IconButton } from './ui';

interface MenuItem {
  label: TKey;
  shortcut?: string;
  run?: () => void;
  checked?: boolean;
  disabled?: boolean;
}
type MenuEntry = MenuItem | 'sep';
interface Menu {
  id: string;
  label: TKey;
  items: MenuEntry[];
}

const openDialog = (id: DialogId, payload?: Record<string, unknown>) => setState({ dialog: { id, payload } });

function useMenus(): Menu[] {
  // 체크 표시가 필요한 상태들 (상태가 바뀌면 메뉴도 다시 그려짐)
  const showGrid = useEditor((s) => s.showGrid);
  const showTileGrid = useEditor((s) => s.showTileGrid);
  const tileSize = useEditor((s) => s.tileSize);
  const onion = useEditor((s) => s.onion);
  const language = useEditor((s) => s.language);
  const hasSelection = useEditor((s) => !!s.selection);
  const playing = useEditor((s) => s.playing);
  useEditor((s) => s.docVersion); // 실행 취소 가능 여부 갱신용

  return [
    {
      id: 'file',
      label: 'menu.file',
      items: [
        { label: 'menu.new', shortcut: 'Alt+N', run: () => confirmDiscard(() => openDialog('new')) },
        { label: 'menu.open', shortcut: 'Ctrl+O', run: () => confirmDiscard(() => void openFile()) },
        'sep',
        { label: 'menu.save', shortcut: 'Ctrl+S', run: () => void saveProject(false) },
        { label: 'menu.saveAs', shortcut: 'Ctrl+Shift+S', run: () => void saveProject(true) },
        'sep',
        { label: 'menu.importLayer', run: () => void importImageAsLayer() },
        { label: 'menu.export', shortcut: 'Ctrl+E', run: () => openDialog('export') },
      ],
    },
    {
      id: 'edit',
      label: 'menu.edit',
      items: [
        { label: 'menu.undo', shortcut: 'Ctrl+Z', run: undo, disabled: !history.canUndo() },
        { label: 'menu.redo', shortcut: 'Ctrl+Shift+Z', run: redo, disabled: !history.canRedo() },
        'sep',
        { label: 'menu.cut', shortcut: 'Ctrl+X', run: cutSelection },
        { label: 'menu.copy', shortcut: 'Ctrl+C', run: () => void copySelection() },
        { label: 'menu.paste', shortcut: 'Ctrl+V', run: () => void pasteFromMenu() },
        { label: 'menu.clear', shortcut: 'Delete', run: () => clearSelectionPixels() },
        'sep',
        { label: 'menu.selectAll', shortcut: 'Ctrl+A', run: selectAll },
        { label: 'menu.deselect', shortcut: 'Ctrl+D', run: deselect, disabled: !hasSelection },
        { label: 'menu.invertSelection', shortcut: 'Ctrl+Shift+I', run: invertSelection },
        'sep',
        { label: 'menu.flipH', shortcut: 'Shift+H', run: () => flipSelectionOrCel('horizontal') },
        { label: 'menu.flipV', shortcut: 'Shift+V', run: () => flipSelectionOrCel('vertical') },
      ],
    },
    {
      id: 'image',
      label: 'menu.image',
      items: [
        { label: 'menu.canvasSize', run: () => openDialog('canvasSize') },
        { label: 'menu.scaleSprite', run: () => openDialog('scale') },
        'sep',
        { label: 'menu.flipCanvasH', run: () => flipCanvasAction('horizontal') },
        { label: 'menu.flipCanvasV', run: () => flipCanvasAction('vertical') },
        { label: 'menu.rotateCW', run: () => rotateCanvasAction(true) },
        { label: 'menu.rotateCCW', run: () => rotateCanvasAction(false) },
      ],
    },
    {
      id: 'layer',
      label: 'menu.layer',
      items: [
        { label: 'menu.newLayer', shortcut: 'Shift+N', run: addLayerAction },
        { label: 'menu.duplicateLayer', run: duplicateLayerAction },
        { label: 'menu.deleteLayer', run: () => deleteLayerAction() },
        'sep',
        { label: 'menu.layerUp', shortcut: 'Ctrl+↑', run: () => moveLayerBy(1) },
        { label: 'menu.layerDown', shortcut: 'Ctrl+↓', run: () => moveLayerBy(-1) },
        { label: 'menu.mergeDown', run: mergeDownAction },
        'sep',
        { label: 'menu.layerProps', run: () => openDialog('layerProps') },
      ],
    },
    {
      id: 'frame',
      label: 'menu.frame',
      items: [
        { label: playing ? 'menu.pause' : 'menu.play', shortcut: 'Enter', run: () => setState((s) => ({ playing: !s.playing })) },
        'sep',
        { label: 'menu.newFrame', shortcut: 'N', run: addFrameAction },
        { label: 'menu.duplicateFrame', shortcut: 'Shift+D', run: duplicateFramesAction },
        { label: 'menu.deleteFrame', run: deleteFramesAction },
        { label: 'menu.frameLeft', run: () => moveCurrentFrameBy(-1) },
        { label: 'menu.frameRight', run: () => moveCurrentFrameBy(1) },
        { label: 'menu.reverseFrames', run: reverseFramesAction },
        'sep',
        { label: 'menu.frameDuration', run: () => openDialog('frameDuration') },
        {
          label: 'menu.newTag',
          run: () => {
            const [from, to] = selectedFrames();
            openDialog('tag', { from, to });
          },
        },
      ],
    },
    {
      id: 'view',
      label: 'menu.view',
      items: [
        { label: 'menu.zoomIn', shortcut: '+', run: () => zoomStep(1) },
        { label: 'menu.zoomOut', shortcut: '-', run: () => zoomStep(-1) },
        { label: 'menu.fit', shortcut: '0', run: fitToScreen },
        { label: 'menu.actualSize', shortcut: '1', run: actualSize },
        'sep',
        { label: 'menu.grid', shortcut: 'Ctrl+G', checked: showGrid, run: () => setState({ showGrid: !showGrid }) },
        { label: 'menu.tileGrid', checked: showTileGrid, run: () => setState({ showTileGrid: !showTileGrid }) },
        { label: 'menu.tile8', checked: showTileGrid && tileSize === 8, run: () => setState({ tileSize: 8, showTileGrid: true }) },
        { label: 'menu.tile16', checked: showTileGrid && tileSize === 16, run: () => setState({ tileSize: 16, showTileGrid: true }) },
        { label: 'menu.tile32', checked: showTileGrid && tileSize === 32, run: () => setState({ tileSize: 32, showTileGrid: true }) },
        'sep',
        {
          label: 'menu.onion',
          shortcut: 'Shift+O',
          checked: onion.enabled,
          run: () => setState({ onion: { ...onion, enabled: !onion.enabled } }),
        },
      ],
    },
    {
      id: 'help',
      label: 'menu.help',
      items: [
        { label: 'menu.welcome', run: () => openDialog('welcome') },
        { label: 'menu.shortcuts', shortcut: 'F1', run: () => openDialog('shortcuts') },
        'sep',
        { label: 'menu.langKo', checked: language === 'ko', run: () => setState({ language: 'ko' }) },
        { label: 'menu.langEn', checked: language === 'en', run: () => setState({ language: 'en' }) },
        'sep',
        { label: 'menu.about', run: () => openDialog('about') },
      ],
    },
  ];
}

export function MenuBar() {
  const t = useT();
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileName = useEditor((s) => s.fileName);
  const projectName = useEditor((s) => s.project.name);
  const dirty = useEditor((s) => s.dirty);
  useEditor((s) => s.docVersion);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="menubar" ref={barRef}>
      <div className="brand" aria-hidden="true">
        <span className="brand-logo" />
        <span className="brand-name">Pixel Editor</span>
      </div>
      <nav className="menus" role="menubar">
        {menus.map((menu) => (
          <div key={menu.id} className={`menu ${open === menu.id ? 'open' : ''}`}>
            <button
              type="button"
              className="menu-title"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={open === menu.id}
              onClick={() => setOpen(open === menu.id ? null : menu.id)}
              onMouseEnter={() => open && setOpen(menu.id)}
            >
              {t(menu.label)}
            </button>
            {open === menu.id && (
              <div className="menu-dropdown" role="menu">
                {menu.items.map((item, i) =>
                  item === 'sep' ? (
                    <div key={i} className="menu-sep" />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      disabled={item.disabled}
                      onClick={() => {
                        setOpen(null);
                        item.run?.();
                      }}
                    >
                      <span className="menu-check">{item.checked ? <Icon name="check" size={14} /> : null}</span>
                      <span className="menu-label">{t(item.label)}</span>
                      {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="menubar-right">
        <IconButton icon="undo" label={t('menu.undo')} shortcut="Ctrl+Z" onClick={undo} disabled={!history.canUndo()} />
        <IconButton icon="redo" label={t('menu.redo')} shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!history.canRedo()} />
        <div className="doc-title" data-tip={dirty ? t('status.unsaved') : t('status.saved')}>
          {dirty && <span className="dirty-dot" />}
          {fileName ?? projectName}
        </div>
        <button
          type="button"
          className="lang-btn"
          onClick={() => setState((s) => ({ language: s.language === 'ko' ? 'en' : 'ko' }))}
          data-tip={t('menu.language')}
        >
          <Icon name="globe" size={14} />
          {t('lang.short')}
        </button>
        <IconButton icon="help" label={t('menu.shortcuts')} shortcut="F1" onClick={() => openDialog('shortcuts')} />
      </div>
    </header>
  );
}
