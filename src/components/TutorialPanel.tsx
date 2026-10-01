/**
 * 따라 하기 튜토리얼 (화면 구석에 떠 있는 안내 카드)
 * ------------------------------------------------------------
 * 대화상자처럼 화면을 가리지 않기 때문에, 안내를 읽으면서 바로 따라 해 볼 수 있습니다.
 * 단계마다 "해 보기" 버튼이 있어서 필요한 도구/예제/창을 대신 열어 줍니다.
 * 마지막으로 본 단계는 기억해 두었다가 다시 열면 이어서 보여줍니다.
 */
import { setTool } from '../editor/shortcuts';
import { openSample, type SampleId } from '../editor/samples';
import { useT, type TKey } from '../i18n';
import { openInbetweenDialog } from '../store/animActions';
import { setState, useEditor } from '../store/editorStore';
import { savePrefs } from '../store/prefs';
import { Icon } from './Icon';

interface Step {
  id: string;
  action?: () => void;
  sample?: SampleId;
}

const STEPS: Step[] = [
  { id: 'layout' },
  { id: 'draw', action: () => setTool('pencil') },
  { id: 'frames', action: () => setState((s) => ({ onion: { ...s.onion, enabled: true } })) },
  { id: 'inbetween', sample: 'walk', action: () => openInbetweenDialog() },
  { id: 'keyframes', sample: 'slime', action: () => setTool('transform') },
  { id: 'effects', sample: 'tree', action: () => setState((s) => ({ collapsed: { ...s.collapsed, effects: false } })) },
  { id: 'bones', sample: 'arm', action: () => setTool('pose') },
  { id: 'ai', action: () => setState({ dialog: { id: 'codex' } }) },
  { id: 'export', action: () => setState({ dialog: { id: 'export' } }) },
];

export function openTutorial(step?: number): void {
  setState((s) => ({ tutorialStep: step ?? s.lastTutorialStep ?? 0, dialog: null }));
}

function go(step: number | null): void {
  setState({ tutorialStep: step });
  if (step !== null) {
    setState({ lastTutorialStep: step });
    savePrefs({ tutorialStep: step });
  }
}

export function TutorialPanel() {
  const t = useT();
  const step = useEditor((s) => s.tutorialStep);
  // 타임라인 바로 위에 뜨도록 (타임라인 높이 + 상태 표시줄 + 여백)
  const bottom = useEditor((s) => s.bottomHeight) + 24 + 16;
  if (step === null) return null;
  const cur = STEPS[Math.min(step, STEPS.length - 1)];
  const last = step >= STEPS.length - 1;
  const k = (suffix: string) => `tutorial.${cur.id}.${suffix}` as TKey;
  return (
    <aside className="tutorial-panel" aria-label={t('tutorial.title')} style={{ bottom }}>
      <div className="tutorial-head">
        <Icon name="book" size={16} />
        <strong>{t('tutorial.title')}</strong>
        <span className="tutorial-count">
          {step + 1} / {STEPS.length}
        </span>
        <button type="button" className="icon-btn tiny" onClick={() => go(null)} aria-label={t('tutorial.close')} data-tip={t('tutorial.close')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="tutorial-progress">
        <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <h3>{t(k('title'))}</h3>
      <p>{t(k('body'))}</p>
      <div className="btn-row">
        {cur.sample && (
          <button type="button" className="btn small" onClick={() => openSample(cur.sample as SampleId)}>
            <Icon name="folder" size={14} /> {t('tutorial.openSample')}
          </button>
        )}
        {cur.action && (
          <button type="button" className="btn small accent" onClick={cur.action}>
            <Icon name="sparkle" size={14} /> {t(k('action'))}
          </button>
        )}
      </div>
      <div className="tutorial-nav">
        <button type="button" className="btn small ghost" disabled={step === 0} onClick={() => go(step - 1)}>
          ← {t('tutorial.prev')}
        </button>
        <span className="spacer" />
        {last ? (
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              savePrefs({ tutorialDone: true, tutorialStep: 0 });
              setState({ lastTutorialStep: 0 });
              go(null);
            }}
          >
            {t('tutorial.finish')} 🎉
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => go(step + 1)}>
            {t('tutorial.next')} →
          </button>
        )}
      </div>
    </aside>
  );
}
