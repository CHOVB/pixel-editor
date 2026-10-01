/**
 * 오른쪽 패널
 * ------------------------------------------------------------
 *  팔레트 / 색 / 레이어 속성 / 애니메이션(키프레임) / 효과 / 뼈대
 * 각 구역은 제목을 클릭해서 접고 펼 수 있습니다. 접힘 상태는 브라우저에 기억됩니다.
 * (레이어 목록 자체는 아래 타임라인 왼쪽에 있습니다)
 */
import type { ReactNode } from 'react';
import { useT, type TKey } from '../i18n';
import { saveCollapsed, setState, useEditor } from '../store/editorStore';
import { AnimationPanel } from './AnimationPanel';
import { ColorPicker } from './ColorPicker';
import { EffectsPanel } from './EffectsPanel';
import { Icon, type IconName } from './Icon';
import { PalettePanel } from './PalettePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SkeletonPanel } from './SkeletonPanel';

function Section({
  id,
  title,
  icon,
  children,
  collapsed,
  onToggle,
  badge,
}: {
  id: string;
  title: TKey;
  icon: IconName;
  children: ReactNode;
  collapsed: boolean;
  onToggle: (id: string) => void;
  badge?: string | number | null;
}) {
  const t = useT();
  return (
    <section className={`panel-section ${collapsed ? 'collapsed' : ''}`} data-section={id}>
      <button type="button" className="section-head" onClick={() => onToggle(id)} aria-expanded={!collapsed}>
        <Icon name={icon} size={14} />
        <span>{t(title)}</span>
        {badge ? <span className="section-badge">{badge}</span> : null}
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && <div className="section-body">{children}</div>}
    </section>
  );
}

export function RightPanel() {
  const collapsed = useEditor((s) => s.collapsed);
  const effectCount = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId)?.effects.length ?? 0);
  const boneCount = useEditor((s) => s.project.bones.length);
  useEditor((s) => s.docVersion);
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
      <Section id="layer" title="panel.layerProps" icon="layers" collapsed={!!collapsed.layer} onToggle={toggle}>
        <PropertiesPanel />
      </Section>
      <Section id="animation" title="panel.animation" icon="diamond" collapsed={!!collapsed.animation} onToggle={toggle}>
        <AnimationPanel />
      </Section>
      <Section id="effects" title="panel.effects" icon="fx" collapsed={!!collapsed.effects} onToggle={toggle} badge={effectCount || null}>
        <EffectsPanel />
      </Section>
      <Section id="bones" title="panel.bones" icon="bone" collapsed={!!collapsed.bones} onToggle={toggle} badge={boneCount || null}>
        <SkeletonPanel />
      </Section>
    </aside>
  );
}
