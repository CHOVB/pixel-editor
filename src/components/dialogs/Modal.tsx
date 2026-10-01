/**
 * 대화상자(모달) 기본 틀
 * ------------------------------------------------------------
 * 모든 대화상자가 이 틀을 사용합니다.
 *  - Esc 키 또는 바깥 클릭: 닫기
 *  - Enter 키: 확인 버튼 (onSubmit) 실행
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { setState } from '../../store/editorStore';
import { Icon } from '../Icon';

interface ModalProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
  onClose?: () => void;
  width?: number;
  className?: string;
}

export function closeDialog(): void {
  setState({ dialog: null });
}

export function Modal({ title, children, footer, onSubmit, onClose = closeDialog, width = 420, className }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 첫 번째 입력칸(없으면 첫 버튼)에 자동으로 포커스
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>('input, select, button.primary, button');
    first?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && onSubmit && !(e.target instanceof HTMLTextAreaElement)) {
        if (e.target instanceof HTMLButtonElement && !e.target.classList.contains('primary')) return;
        e.preventDefault();
        // 입력칸의 값이 먼저 반영되도록 다음 틱에 실행
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(onSubmit, 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSubmit]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${className ?? ''}`} style={{ width }} ref={boxRef} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
