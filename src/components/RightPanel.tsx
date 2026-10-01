/**
 * 오른쪽 패널 (팔레트 / 색 선택기 / 레이어)
 * ------------------------------------------------------------
 * 각 구역은 제목을 클릭해서 접고 펼 수 있습니다. 접힘 상태는 브라우저에 기억됩니다.
 * 화면이 낮으면 색 선택기를 접어 두어 레이어 패널이 항상 보이도록 합니다.
 */
import type { ReactNode } from 'react';
import { useT, type TKey } from '../i18n';
import { saveCollapsed, setState, useEditor } from '../store/editorStore';
import { ColorPicker } from './ColorPicker';
import { Icon, type IconName } from './Icon';
import { LayersPanel } from './LayersPanel';
import { PalettePanel } from './PalettePanel';

function Section({
  id,
  title,
  icon,
  children,
  collapsed,
  onToggle,
  grow,
}: {
  id: string;
  title: TKey;
  icon: IconName;
  children: ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  grow?: boolean;
}) {
  const t = useT();
  return (
    <section className={`panel-section ${collapsed ? 'collapsed' : ''} ${grow ? 'grow' : ''}`}>
      <button type="button" className="section-head" onClick={() => onToggle(id)} aria-expanded={!collapsed}>
        <Icon name={icon} size={14} />
        <span>{t(title)}</span>
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && <div className="section-body">{children}</div>}
    </section>
  );
}

export function RightPanel() {
  const collapsed = useEditor((s) => s.collapsed);
  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setState({ collapsed: next });
    saveCollapsed(next);
  };

  return (
    <aside className="right-panel">
      <Section id="palette" title="panel.palette" icon="grid" collapsed={!!collapsed.palette} onToggle={toggle}>
        <PalettePanel />
      </Section>
      <Section id="color" title="panel.color" icon="palette" collapsed={!!collapsed.color} onToggle={toggle}>
        <ColorPicker />
      </Section>
      <Section id="layers" title="panel.layers" icon="layers" collapsed={!!collapsed.layers} onToggle={toggle} grow>
        <LayersPanel />
      </Section>
    </aside>
  );
}
