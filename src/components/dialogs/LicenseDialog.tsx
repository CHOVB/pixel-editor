/**
 * 라이선스(정품 등록) 대화상자
 * ------------------------------------------------------------
 * 구매 후 받은 키를 붙여 넣으면 인터넷 없이 바로 확인합니다.
 * (모든 기능은 등록과 상관없이 쓸 수 있고, 정품 표시만 바뀝니다)
 */
import { useEffect, useState } from 'react';
import { currentLicense, loadStoredKey, storeKey, verifyLicenseKey, type LicenseInfo } from '../../licensing/license';
import { useT } from '../../i18n';
import { notify } from '../../store/actions';
import { closeDialog, Modal } from './Modal';

export function LicenseDialog() {
  const t = useT();
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void currentLicense().then(setInfo);
  }, []);

  const activate = async () => {
    setBusy(true);
    setError('');
    const r = await verifyLicenseKey(key);
    setBusy(false);
    if (!r.valid) {
      setError(t(`license.error.${r.reason}`));
      return;
    }
    storeKey(key);
    setInfo(r.info);
    setKey('');
    notify(t('license.activated', { name: r.info.name }), 'success');
  };

  return (
    <Modal
      title={t('license.title')}
      width={560}
      onSubmit={() => void activate()}
      footer={
        <>
          {info && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                storeKey(null);
                setInfo(null);
              }}
            >
              {t('license.remove')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => void activate()} disabled={busy || !key.trim()}>
            {t('license.activate')}
          </button>
        </>
      }
    >
      {info ? (
        <div className="success-box">
          ✅ {t('license.licensedTo', { name: info.name, plan: t(`license.plan.${info.plan}`) })}
          <br />
          <small>
            {info.email} · {t('license.issued', { date: info.issued })}
            {info.expires ? ` · ${t('license.expires', { date: info.expires })}` : ''}
          </small>
        </div>
      ) : (
        <p className="note">💡 {t('license.trialNote')}</p>
      )}
      <div className="field">
        <span className="field-label">{t('license.key')}</span>
        <textarea className="mono license-input" rows={4} value={key} placeholder="PXE1.xxxxx.yyyyy" onChange={(e) => setKey(e.target.value)} />
        {loadStoredKey() && !info && <small className="note">{t('license.storedInvalid')}</small>}
      </div>
      {error && <p className="warn-box">⚠ {error}</p>}
    </Modal>
  );
}
