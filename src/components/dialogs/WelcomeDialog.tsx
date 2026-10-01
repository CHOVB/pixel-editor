/**
 * 시작 화면 (환영 대화상자)
 * ------------------------------------------------------------
 * 프로그램을 처음 켰을 때 보이는 화면입니다.
 *  - 크기를 골라 바로 새 그림 시작 / 파일 열기
 *  - 최근 파일 다시 열기
 *  - 자동 저장된 작업 복구 (프로그램이 갑자기 꺼졌을 때)
 *  - 예제 프로젝트로 시작하기 + 따라 하기 튜토리얼
 *  - 초보자를 위한 5단계 빠른 시작 안내
 */
import { useEffect, useState } from 'react';
import { confirmDiscard, loadAutosaveInfo, newProject, openFile, openRecent, restoreAutosave, type AutosaveRecord } from '../../editor/fileActions';
import { loadRecentFiles, useRecent } from '../../editor/recentFiles';
import { openSample, SAMPLE_IDS } from '../../editor/samples';
import { useT } from '../../i18n';
import { setState } from '../../store/editorStore';
import { savePrefs } from '../../store/prefs';
import { Icon } from '../Icon';
import { openTutorial } from '../TutorialPanel';
import { closeDialog, Modal } from './Modal';
import { SIZE_PRESETS } from './NewProjectDialog';

const SAMPLE_EMOJI: Record<string, string> = { hero: '⚔️', slime: '🟢', tree: '🌳', walk: '🚶', arm: '🦴' };

export function WelcomeDialog() {
  const t = useT();
  const [autosave, setAutosave] = useState<AutosaveRecord | undefined>();
  const recent = useRecent((s) => s.list);

  useEffect(() => {
    void loadAutosaveInfo().then(setAutosave);
    void loadRecentFiles();
  }, []);

  const start = (w: number, h: number) => {
    confirmDiscard(() => {
      newProject(w, h, null);
      closeDialog();
    });
  };

  return (
    <Modal title={t('welcome.title')} width={860} className="welcome">
      <p className="welcome-sub">{t('welcome.subtitle')}</p>
      <div className="welcome-grid">
        <div>
          <h3>{t('welcome.start')}</h3>
          <div className="preset-grid big">
            {SIZE_PRESETS.slice(0, 4).map((p) => (
              <button key={`${p.w}x${p.h}`} type="button" className="preset" onClick={() => start(p.w, p.h)}>
                <strong>
                  {p.w}×{p.h}
                </strong>
                <small>{t(p.key)}</small>
              </button>
            ))}
          </div>
          <div className="welcome-actions">
            <button type="button" className="btn" onClick={() => setState({ dialog: { id: 'new' } })}>
              <Icon name="fileNew" size={16} /> {t('welcome.custom')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                confirmDiscard(() => {
                  closeDialog();
                  void openFile();
                })
              }
            >
              <Icon name="folder" size={16} /> {t('menu.open')}
            </button>
          </div>
          {autosave && (
            <div className="autosave-box">
              <div>
                <strong>{t('welcome.restoreTitle')}</strong>
                <small>
                  {autosave.name} · {autosave.width}×{autosave.height} · {new Date(autosave.savedAt).toLocaleString()}
                </small>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  void restoreAutosave().then((ok) => ok && closeDialog());
                }}
              >
                {t('welcome.restore')}
              </button>
            </div>
          )}
          {recent.length > 0 && (
            <>
              <h3>{t('welcome.recent')}</h3>
              <div className="recent-list">
                {recent.slice(0, 5).map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className="recent-item"
                    onClick={() =>
                      confirmDiscard(() => {
                        closeDialog();
                        void openRecent(r);
                      })
                    }
                    data-tip={r.handle ? t('welcome.recentOpen') : t('welcome.recentPick')}
                  >
                    {r.thumb ? <img src={r.thumb} alt="" className="recent-thumb checker" /> : <span className="recent-thumb checker" />}
                    <span className="recent-text">
                      <strong>{r.name}</strong>
                      <small>
                        {r.width}×{r.height} · {t('welcome.frames', { n: r.frames })} · {new Date(r.openedAt).toLocaleDateString()}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="btn ghost continue" onClick={closeDialog}>
            {t('welcome.continue')}
          </button>
        </div>

        <div className="quickstart">
          <h3>{t('welcome.samples')}</h3>
          <div className="sample-grid">
            {SAMPLE_IDS.map((id) => (
              <button key={id} type="button" className="sample-card" onClick={() => openSample(id, closeDialog)}>
                <span className="sample-emoji">{SAMPLE_EMOJI[id]}</span>
                <strong>{t(`sample.${id}`)}</strong>
                <small>{t(`sample.${id}Desc`)}</small>
              </button>
            ))}
          </div>
          <button type="button" className="btn accent tutorial-btn" onClick={() => openTutorial(0)}>
            <Icon name="book" size={16} /> {t('welcome.tutorial')}
          </button>
          <h3>{t('welcome.quickstart')}</h3>
          <ol>
            <li>
              <b>{t('welcome.step1.title')}</b>
              <span>{t('welcome.step1.body')}</span>
            </li>
            <li>
              <b>{t('welcome.step2.title')}</b>
              <span>{t('welcome.step2.body')}</span>
            </li>
            <li>
              <b>{t('welcome.step3.title')}</b>
              <span>{t('welcome.step3.body')}</span>
            </li>
            <li>
              <b>{t('welcome.step4.title')}</b>
              <span>{t('welcome.step4.body')}</span>
            </li>
            <li>
              <b>{t('welcome.step5.title')}</b>
              <span>{t('welcome.step5.body')}</span>
            </li>
          </ol>
          <div className="btn-row">
            <button type="button" className="link-btn" onClick={() => setState({ dialog: { id: 'shortcuts' } })}>
              ⌨ {t('welcome.allShortcuts')}
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                savePrefs({ showWelcome: false });
                closeDialog();
              }}
            >
              {t('welcome.dontShow')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
