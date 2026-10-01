/**
 * 오른쪽 클릭 메뉴 표시
 * ------------------------------------------------------------
 * store 의 contextMenu 값이 있으면 그 위치에 메뉴를 띄웁니다.
 * 바깥을 클릭하거나 Esc 를 누르면 닫힙니다.
 */
import { useEffect, useRef } from 'react';
import { setState, useEditor } from '../store/editorStore';
import { Icon } from './Icon';

export function ContextMenuHost() {
  const menu = useEditor((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      setState({ contextMenu: null });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState({ contextMenu: null });
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  // 화면 밖으로 나가지 않게 위치 보정
  const left = Math.min(menu.x, window.innerWidth - 240);
  const top = Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 16);
  return (
    <div className="context-menu menu-dropdown" ref={ref} style={{ left, top }} role="menu">
      {menu.items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              setState({ contextMenu: null });
              item.run();
            }}
          >
            <span className="menu-check">{item.checked ? <Icon name="check" size={14} /> : null}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
