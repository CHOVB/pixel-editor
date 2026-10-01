/**
 * 상단 메뉴 막대 (파일 / 편집 / 이미지 / 레이어 / 애니메이션 / 효과 / AI / 보기 / 도움말)
 * ------------------------------------------------------------
 * 메뉴 항목은 아래의 useMenus() 에서 "데이터"로 정의하고,
 * 그 데이터를 보고 화면을 그립니다. 메뉴를 추가하려면 배열에 항목만 추가하면 됩니다.
 */
import { useEffect, useRef, useState } from 'react';
import { createParticleSettings, PARTICLE_PRESET_IDS } from '../core/particles';
import { copySelection, cutSelection, pasteFromMenu } from '../editor/clipboard';
import { confirmDiscard, importImageAsLayer, openFile, openRecent, saveProject } from '../editor/fileActions';
import { useRecent } from '../editor/recentFiles';
import { openSample, SAMPLE_IDS } from '../editor/samples';
import { importReferenceImage } from '../editor/importActions';
import { shortcutLabel as sk } from '../editor/shortcuts';
import { actualSize, fitToScreen, zoomStep } from '../editor/view';
import { useT, type TKey } from '../i18n';
import {
  addFrameAction,
  addGroupAction,
  addLayerAction,
  addSketchLayerAction,
  bakeLayerAction,
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
  toggleGuide,
  undo,
} from '../store/actions';
import { clearAnimationAction, clearCelsAction, gotoNeighborKey, linkCelsAction, openInbetweenDialog, toggleKeyframeAction, unlinkCelAction } from '../store/animActions';
import { autoBindLayersAction } from '../store/boneActions';
import { getState, setState, useEditor, type DialogId, type TileMode } from '../store/editorStore';
import { addParticleLayerAction, openPartSplit } from '../store/toolActions';
import { Icon } from './Icon';
import { openTutorial } from './TutorialPanel';
import { IconButton } from './ui';

interface MenuItem {
  label: TKey;
  /** 번역 글자 안의 {name} 같은 부분에 넣을 값 */
  params?: Record<string, string | number>;
  shortcut?: string;
  run?: () => void;
  checked?: boolean;
  disabled?: boolean;
}
type MenuEntry = MenuItem | 'sep' | { header: TKey };
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
  const tileMode = useEditor((s) => s.tileMode);
  const onion = useEditor((s) => s.onion);
  const language = useEditor((s) => s.language);
  const theme = useEditor((s) => s.theme);
  const hasSelection = useEditor((s) => !!s.selection);
  const playing = useEditor((s) => s.playing);
  const showBones = useEditor((s) => s.showBones);
  const isGuide = useEditor((s) => !!s.project.layers.find((l) => l.id === s.currentLayerId)?.guide);
  useEditor((s) => s.docVersion); // 실행 취소 가능 여부 갱신용
  useEditor((s) => s.shortcutsVersion); // 단축키를 바꾸면 메뉴 글자도 갱신
  const recent = useRecent((s) => s.list);
  // 최근 파일 (최대 5개) – 목록이 비어 있으면 메뉴에 나오지 않습니다.
  const recentItems: MenuEntry[] =
    recent.length === 0
      ? []
      : [
          { header: 'menu.recent' },
          ...recent.slice(0, 5).map(
            (r): MenuItem => ({
              label: 'menu.recentItem',
              params: { name: r.name },
              run: () => confirmDiscard(() => void openRecent(r)),
            }),
          ),
        ];

  const tile = (mode: TileMode): MenuItem => ({
    label: `menu.tileMode.${mode}` as TKey,
    checked: tileMode === mode,
    run: () => setState({ tileMode: mode }),
  });

  return [
    {
      id: 'file',
      label: 'menu.file',
      items: [
        { label: 'menu.new', shortcut: sk('menu.new', 'Alt+N'), run: () => confirmDiscard(() => openDialog('new')) },
        { label: 'menu.open', shortcut: sk('menu.open', 'Ctrl+O'), run: () => confirmDiscard(() => void openFile()) },
        ...recentItems,
        'sep',
        { label: 'menu.save', shortcut: sk('menu.save', 'Ctrl+S'), run: () => void saveProject(false) },
        { label: 'menu.saveAs', shortcut: sk('menu.saveAs', 'Ctrl+Shift+S'), run: () => void saveProject(true) },
        'sep',
        { label: 'menu.importLayer', run: () => void importImageAsLayer() },
        { label: 'menu.importReference', run: () => void importReferenceImage() },
        { label: 'menu.importSheet', run: () => openDialog('importSheet') },
        { label: 'menu.pixelFixer', run: () => openDialog('pixelFixer') },
        'sep',
        { label: 'menu.export', shortcut: sk('menu.export', 'Ctrl+E'), run: () => openDialog('export') },
        'sep',
        { label: 'menu.settings', shortcut: sk('menu.settings', 'Ctrl+,'), run: () => openDialog('settings') },
      ],
    },
    {
      id: 'edit',
      label: 'menu.edit',
      items: [
        { label: 'menu.undo', shortcut: sk('menu.undo', 'Ctrl+Z'), run: undo, disabled: !history.canUndo() },
        { label: 'menu.redo', shortcut: sk('menu.redo', 'Ctrl+Shift+Z'), run: redo, disabled: !history.canRedo() },
        'sep',
        { label: 'menu.cut', shortcut: sk('menu.cut', 'Ctrl+X'), run: cutSelection },
        { label: 'menu.copy', shortcut: sk('menu.copy', 'Ctrl+C'), run: () => void copySelection() },
        { label: 'menu.paste', shortcut: sk('menu.paste', 'Ctrl+V'), run: () => void pasteFromMenu() },
        { label: 'menu.clear', shortcut: sk('menu.clear', 'Delete'), run: () => clearSelectionPixels() },
        'sep',
        { label: 'menu.selectAll', shortcut: sk('menu.selectAll', 'Ctrl+A'), run: selectAll },
        { label: 'menu.deselect', shortcut: sk('menu.deselect', 'Ctrl+D'), run: deselect, disabled: !hasSelection },
        { label: 'menu.invertSelection', shortcut: sk('menu.invertSelection', 'Ctrl+Shift+I'), run: invertSelection },
        'sep',
        { label: 'menu.flipH', shortcut: sk('menu.flipH', 'Shift+H'), run: () => flipSelectionOrCel('horizontal') },
        { label: 'menu.flipV', shortcut: sk('menu.flipV', 'Shift+V'), run: () => flipSelectionOrCel('vertical') },
        { label: 'menu.replaceColor', shortcut: sk('menu.replaceColor', 'Shift+R'), run: () => openDialog('replaceColor') },
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
        'sep',
        { label: 'menu.cleanup', shortcut: sk('menu.cleanup', 'Shift+L'), run: () => openDialog('cleanup') },
        { label: 'menu.pixelFixer', run: () => openDialog('pixelFixer') },
      ],
    },
    {
      id: 'layer',
      label: 'menu.layer',
      items: [
        { label: 'menu.newLayer', shortcut: sk('menu.newLayer', 'Shift+N'), run: addLayerAction },
        { label: 'menu.newGroup', run: addGroupAction },
        { label: 'menu.newSketch', run: addSketchLayerAction },
        { label: 'menu.importReference', run: () => void importReferenceImage() },
        'sep',
        { label: 'menu.duplicateLayer', run: duplicateLayerAction },
        { label: 'menu.deleteLayer', run: () => deleteLayerAction() },
        { label: 'menu.layerUp', shortcut: sk('menu.layerUp', 'Ctrl+↑'), run: () => moveLayerBy(1) },
        { label: 'menu.layerDown', shortcut: sk('menu.layerDown', 'Ctrl+↓'), run: () => moveLayerBy(-1) },
        'sep',
        { label: 'menu.mergeDown', run: mergeDownAction },
        { label: 'menu.bakeLayer', run: () => bakeLayerAction() },
        { label: isGuide ? 'menu.unmarkSketch' : 'menu.markSketch', run: () => toggleGuide() },
        'sep',
        { label: 'menu.splitPart', run: openPartSplit },
        { label: 'menu.layerProps', run: () => openDialog('layerProps') },
      ],
    },
    {
      id: 'frame',
      label: 'menu.frame',
      items: [
        { label: playing ? 'menu.pause' : 'menu.play', shortcut: sk('shortcut.play', 'Enter'), run: () => setState((s) => ({ playing: !s.playing })) },
        'sep',
        { label: 'menu.newFrame', shortcut: sk('menu.newFrame', 'N'), run: addFrameAction },
        { label: 'menu.duplicateFrame', shortcut: sk('menu.duplicateFrame', 'Shift+D'), run: () => duplicateFramesAction() },
        { label: 'menu.deleteFrame', run: deleteFramesAction },
        { label: 'menu.frameLeft', run: () => moveCurrentFrameBy(-1) },
        { label: 'menu.frameRight', run: () => moveCurrentFrameBy(1) },
        { label: 'menu.reverseFrames', run: reverseFramesAction },
        { label: 'menu.frameTransform', shortcut: sk('menu.frameTransform', 'Alt+T'), run: () => openDialog('frameTransform') },
        'sep',
        { label: 'menu.inbetween', shortcut: sk('menu.inbetween', 'Shift+I'), run: openInbetweenDialog },
        { label: 'menu.linkCels', run: linkCelsAction },
        { label: 'menu.unlinkCels', run: unlinkCelAction },
        { label: 'menu.clearCels', run: clearCelsAction },
        'sep',
        { header: 'menu.keyframes' },
        { label: 'menu.addKey', shortcut: sk('menu.addKey', 'K'), run: toggleKeyframeAction },
        { label: 'timeline.prevKey', shortcut: sk('timeline.prevKey', 'Shift+,'), run: () => gotoNeighborKey(-1) },
        { label: 'timeline.nextKey', shortcut: sk('timeline.nextKey', 'Shift+.'), run: () => gotoNeighborKey(1) },
        { label: 'anim.clear', run: clearAnimationAction },
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
      id: 'effects',
      label: 'menu.effects',
      items: [
        { label: 'menu.vfx', shortcut: sk('menu.vfx', 'Shift+X'), run: () => openDialog('vfx') },
        { label: 'menu.cleanup', shortcut: sk('menu.cleanup', 'Shift+L'), run: () => openDialog('cleanup') },
        {
          label: 'menu.effectsPanel',
          run: () => setState((s) => ({ collapsed: { ...s.collapsed, effects: false } })),
        },
        'sep',
        { header: 'menu.addParticles' },
        ...PARTICLE_PRESET_IDS.map(
          (id): MenuItem => ({
            label: `particlePreset.${id}` as TKey,
            run: () => addParticleLayerAction(id, (preset) => createParticleSettings(preset, getState().project)),
          }),
        ),
        'sep',
        { header: 'menu.bones' },
        { label: 'tool.bone', shortcut: sk('tool.bone', 'J'), run: () => setState({ tool: 'bone' }) },
        { label: 'tool.pose', shortcut: sk('tool.pose', 'P'), run: () => setState({ tool: 'pose' }) },
        { label: 'bones.autoBind', run: autoBindLayersAction },
      ],
    },
    {
      id: 'ai',
      label: 'menu.ai',
      items: [
        { label: 'menu.codexConnect', run: () => openDialog('codex') },
        'sep',
        { label: 'menu.aiPartFill', run: openPartSplit },
        { label: 'menu.aiInbetween', run: openInbetweenDialog },
        { label: 'menu.aiFixer', run: () => openDialog('pixelFixer') },
      ],
    },
    {
      id: 'view',
      label: 'menu.view',
      items: [
        { label: 'menu.zoomIn', shortcut: sk('menu.zoomIn', '+'), run: () => zoomStep(1) },
        { label: 'menu.zoomOut', shortcut: sk('menu.zoomOut', '-'), run: () => zoomStep(-1) },
        { label: 'menu.fit', shortcut: sk('menu.fit', '0'), run: fitToScreen },
        { label: 'menu.actualSize', shortcut: sk('menu.actualSize', '1'), run: actualSize },
        'sep',
        { label: 'menu.grid', shortcut: sk('menu.grid', 'Ctrl+G'), checked: showGrid, run: () => setState({ showGrid: !showGrid }) },
        { label: 'menu.tileGrid', checked: showTileGrid, run: () => setState({ showTileGrid: !showTileGrid }) },
        { label: 'menu.tile8', checked: showTileGrid && tileSize === 8, run: () => setState({ tileSize: 8, showTileGrid: true }) },
        { label: 'menu.tile16', checked: showTileGrid && tileSize === 16, run: () => setState({ tileSize: 16, showTileGrid: true }) },
        { label: 'menu.tile32', checked: showTileGrid && tileSize === 32, run: () => setState({ tileSize: 32, showTileGrid: true }) },
        'sep',
        { header: 'menu.tileMode' },
        tile('none'),
        tile('x'),
        tile('y'),
        tile('both'),
        'sep',
        {
          label: 'menu.onion',
          shortcut: sk('menu.onion', 'Shift+O'),
          checked: onion.enabled,
          run: () => setState({ onion: { ...onion, enabled: !onion.enabled } }),
        },
        { label: 'bones.show', shortcut: sk('bones.show', 'Shift+B'), checked: showBones, run: () => setState({ showBones: !showBones }) },
        'sep',
        { label: 'menu.themeDark', checked: theme === 'dark', run: () => setState({ theme: 'dark' }) },
        { label: 'menu.themeLight', checked: theme === 'light', run: () => setState({ theme: 'light' }) },
        { label: 'menu.themeSystem', checked: theme === 'system', run: () => setState({ theme: 'system' }) },
      ],
    },
    {
      id: 'help',
      label: 'menu.help',
      items: [
        { label: 'menu.welcome', run: () => openDialog('welcome') },
        { label: 'menu.tutorial', run: () => openTutorial() },
        { header: 'menu.samples' },
        ...SAMPLE_IDS.map((id): MenuItem => ({ label: `sample.${id}` as TKey, run: () => openSample(id) })),
        'sep',
        { label: 'menu.shortcuts', shortcut: sk('menu.shortcuts', 'F1'), run: () => openDialog('shortcuts') },
        'sep',
        { label: 'menu.langKo', checked: language === 'ko', run: () => setState({ language: 'ko' }) },
        { label: 'menu.langEn', checked: language === 'en', run: () => setState({ language: 'en' }) },
        'sep',
        { label: 'menu.settings', run: () => openDialog('settings') },
        { label: 'license.title', run: () => openDialog('license') },
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
                {menu.items.map((item, i) => {
                  if (item === 'sep') return <div key={i} className="menu-sep" />;
                  if ('header' in item) {
                    return (
                      <div key={i} className="menu-header">
                        {t(item.header)}
                      </div>
                    );
                  }
                  return (
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
                      <span className="menu-label">{t(item.label, item.params)}</span>
                      {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                    </button>
                  );
                })}
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
        <button type="button" className="ai-btn" onClick={() => openDialog('codex')} data-tip={t('menu.codexConnect')}>
          <Icon name="robot" size={14} />
          Codex
        </button>
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
