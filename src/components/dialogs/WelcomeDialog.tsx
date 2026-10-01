/**
 * 시작 화면 (환영 대화상자)
 * ------------------------------------------------------------
 * 프로그램을 처음 켰을 때 보이는 화면입니다.
 *  - 크기를 골라 바로 새 그림 시작
 *  - 파일 열기
 *  - 자동 저장된 작업 복구 (프로그램이 갑자기 꺼졌을 때)
 *  - 초보자를 위한 5단계 빠른 시작 안내
 */
import { useEffect, useState } from 'react';
import { confirmDiscard, loadAutosaveInfo, newProject, openFile, restoreAutosave, type AutosaveRecord } from '../../editor/fileActions';
import { useT } from '../../i18n';
import { setState } from '../../store/editorStore';
import { Icon } from '../Icon';
import { closeDialog, Modal } from './Modal';
import { SIZE_PRESETS } from './NewProjectDialog';

export function WelcomeDialog() {
  const t = useT();
  const [autosave, setAutosave] = useState<AutosaveRecord | undefined>();

  useEffect(() => {
    void loadAutosaveInfo().then(setAutosave);
  }, []);

  const start = (w: number, h: number) => {
    confirmDiscard(() => {
      newProject(w, h, null);
      closeDialog();
    });
  };

  return (
    <Modal title={t('welcome.title')} width={720} className="welcome">
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
          <button type="button" className="btn ghost continue" onClick={closeDialog}>
            {t('welcome.continue')}
          </button>
        </div>

        <div className="quickstart">
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
          <button type="button" className="link-btn" onClick={() => setState({ dialog: { id: 'shortcuts' } })}>
            ⌨ {t('welcome.allShortcuts')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
