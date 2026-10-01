/**
 * 왼쪽 도구 막대
 * ------------------------------------------------------------
 * 도구 버튼 + 아래쪽에 주 색/보조 색 견본을 보여줍니다.
 * 버튼에 마우스를 올리면 "도구 이름 + 단축키" 말풍선이 나옵니다.
 */
import { colorToCss } from '../core/color';
import { setTool, shortcutLabel } from '../editor/shortcuts';
import { useT } from '../i18n';
import { swapColors } from '../store/actions';
import { getState, saveCollapsed, setState, useEditor } from '../store/editorStore';
import { TOOL_LIST } from '../tools';
import { Icon, type IconName } from './Icon';
import { IconButton } from './ui';

/** 색 견본을 누르면 그 색을 편집하도록 색 선택기를 펼칩니다. */
function editColor(slot: 'primary' | 'secondary'): void {
  const collapsed = { ...getState().collapsed, color: false };
  setState({ activeSlot: slot, collapsed });
  saveCollapsed(collapsed);
}

export function Toolbar() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);
  const activeSlot = useEditor((s) => s.activeSlot);
  useEditor((s) => s.shortcutsVersion); // 단축키를 바꾸면 말풍선 글자도 갱신

  return (
    <aside className="toolbar" aria-label={t('panel.tools')}>
      {TOOL_LIST.map((info, i) =>
        info ? (
          <IconButton
            key={info.id}
            icon={info.id as IconName}
            label={t(info.name)}
            shortcut={shortcutLabel(info.name, info.key)}
            active={tool === info.id}
            onClick={() => setTool(info.id)}
            size={20}
          />
        ) : (
          <div key={`sep-${i}`} className="toolbar-sep" />
        ),
      )}

      <div className="toolbar-colors">
        <button
          type="button"
          className={`swatch-big secondary ${activeSlot === 'secondary' ? 'editing' : ''}`}
          style={{ ['--swatch' as string]: colorToCss(secondary) }}
          data-tip={t('color.secondary')}
          aria-label={t('color.secondary')}
          onClick={() => editColor('secondary')}
        />
        <button
          type="button"
          className={`swatch-big primary ${activeSlot === 'primary' ? 'editing' : ''}`}
          style={{ ['--swatch' as string]: colorToCss(primary) }}
          data-tip={t('color.primary')}
          aria-label={t('color.primary')}
          onClick={() => editColor('primary')}
        />
        <button
          type="button"
          className="swap-btn"
          onClick={swapColors}
          data-tip={t('shortcut.swapColors')}
          data-tip-key="X"
          aria-label={t('shortcut.swapColors')}
        >
          <Icon name="swap" size={12} />
        </button>
      </div>
    </aside>
  );
}
