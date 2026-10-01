/**
 * 환경설정 대화상자
 * ------------------------------------------------------------
 *  - 일반: 언어 / 테마 / 화면 크기 / 시작 화면
 *  - 편집: 자동 저장 간격 / 복제할 때 링크 / 픽셀 퍼펙트 / 격자
 *  - 단축키: 원하는 키로 바꾸기 (충돌 검사, 기본값 되돌리기)
 *  - AI: Codex 브리지 주소, 연결 확인
 *  - 데이터: 최근 파일 지우기, 모든 설정 초기화
 */
import { useEffect, useMemo, useState } from 'react';
import { bridgeUrl, setBridgeUrl } from '../../ai/codex';
import { DEFAULT_AUTOSAVE_SECONDS, startAutosave } from '../../editor/fileActions';
import { clearRecentFiles } from '../../editor/recentFiles';
import {
  bindingFromEvent,
  bindingLabel,
  customizableShortcuts,
  findConflict,
  isCustomized,
  resetAllShortcuts,
  setShortcutBinding,
  type ShortcutGroup,
} from '../../editor/shortcuts';
import { useT, type TKey } from '../../i18n';
import { notify } from '../../store/actions';
import { setState, useEditor, type Theme } from '../../store/editorStore';
import { loadPrefs, resetPrefs, savePrefs } from '../../store/prefs';
import { Toggle } from '../ui';
import { closeDialog, Modal } from './Modal';

type Tab = 'general' | 'editing' | 'shortcuts' | 'ai' | 'data';
const TABS: Tab[] = ['general', 'editing', 'shortcuts', 'ai', 'data'];
const AUTOSAVE_CHOICES = [0, 15, 30, 60, 300];
const UI_SCALES = [0.9, 1, 1.1, 1.25];
const GROUP_ORDER: ShortcutGroup[] = ['tools', 'edit', 'animation', 'helpers', 'view', 'file'];

export function SettingsDialog({ tab: initialTab }: { tab?: Tab }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');
  return (
    <Modal
      title={t('settings.title')}
      width={720}
      className="settings-dialog"
      footer={
        <button type="button" className="btn primary" onClick={closeDialog}>
          {t('common.ok')}
        </button>
      }
    >
      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {t(`settings.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'editing' && <EditingTab />}
      {tab === 'shortcuts' && <ShortcutsTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'data' && <DataTab />}
    </Modal>
  );
}

function Row({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {tip && <small>{tip}</small>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function GeneralTab() {
  const t = useT();
  const language = useEditor((s) => s.language);
  const theme = useEditor((s) => s.theme);
  const uiScale = useEditor((s) => s.uiScale);
  const [showWelcome, setShowWelcome] = useState(loadPrefs().showWelcome !== false);
  return (
    <div className="settings-list">
      <Row label={t('menu.language')}>
        <div className="segmented">
          <button type="button" className={language === 'ko' ? 'active' : ''} onClick={() => setState({ language: 'ko' })}>
            한국어
          </button>
          <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setState({ language: 'en' })}>
            English
          </button>
        </div>
      </Row>
      <Row label={t('settings.theme')}>
        <div className="segmented">
          {(['dark', 'light', 'system'] as Theme[]).map((th) => (
            <button key={th} type="button" className={theme === th ? 'active' : ''} onClick={() => setState({ theme: th })}>
              {t(`settings.theme.${th}`)}
            </button>
          ))}
        </div>
      </Row>
      <Row label={t('settings.uiScale')} tip={t('settings.uiScaleTip')}>
        <div className="segmented">
          {UI_SCALES.map((sc) => (
            <button key={sc} type="button" className={uiScale === sc ? 'active' : ''} onClick={() => setState({ uiScale: sc })}>
              {Math.round(sc * 100)}%
            </button>
          ))}
        </div>
      </Row>
      <Row label={t('settings.showWelcome')}>
        <Toggle
          checked={showWelcome}
          onChange={(v) => {
            setShowWelcome(v);
            savePrefs({ showWelcome: v });
          }}
        >
          {showWelcome ? t('settings.on') : t('settings.off')}
        </Toggle>
      </Row>
    </div>
  );
}

function EditingTab() {
  const t = useT();
  const linkOnDuplicate = useEditor((s) => s.linkOnDuplicate);
  const pixelPerfect = useEditor((s) => s.pixelPerfect);
  const showGrid = useEditor((s) => s.showGrid);
  const [autosave, setAutosave] = useState(loadPrefs().autosaveSeconds ?? DEFAULT_AUTOSAVE_SECONDS);
  return (
    <div className="settings-list">
      <Row label={t('settings.autosave')} tip={t('settings.autosaveTip')}>
        <select
          value={autosave}
          onChange={(e) => {
            const v = Number(e.target.value);
            setAutosave(v);
            savePrefs({ autosaveSeconds: v });
            startAutosave(v);
          }}
        >
          {AUTOSAVE_CHOICES.map((sec) => (
            <option key={sec} value={sec}>
              {sec === 0 ? t('settings.off') : sec < 60 ? t('settings.seconds', { n: sec }) : t('settings.minutes', { n: sec / 60 })}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('timeline.linkOnDuplicate')}>
        <Toggle checked={linkOnDuplicate} onChange={(v) => setState({ linkOnDuplicate: v })}>
          {linkOnDuplicate ? t('settings.on') : t('settings.off')}
        </Toggle>
      </Row>
      <Row label={t('opt.pixelPerfect')} tip={t('opt.pixelPerfectTip')}>
        <Toggle checked={pixelPerfect} onChange={(v) => setState({ pixelPerfect: v })}>
          {pixelPerfect ? t('settings.on') : t('settings.off')}
        </Toggle>
      </Row>
      <Row label={t('menu.grid')}>
        <Toggle checked={showGrid} onChange={(v) => setState({ showGrid: v })}>
          {showGrid ? t('settings.on') : t('settings.off')}
        </Toggle>
      </Row>
    </div>
  );
}

function ShortcutsTab() {
  const t = useT();
  const version = useEditor((s) => s.shortcutsVersion);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [warning, setWarning] = useState('');
  const [filter, setFilter] = useState('');
  const list = useMemo(
    () =>
      customizableShortcuts()
        .filter((sc) => !filter || t(sc.desc).toLowerCase().includes(filter.toLowerCase()) || sc.label.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)),
    [filter, t, version],
  );

  // 키 입력 받기: 다른 곳(대화상자 Esc/Enter 처리, 단축키)보다 먼저 가로챕니다.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        setCapturing(null);
        return;
      }
      const b = bindingFromEvent(e);
      if (!b) return;
      const conflict = findConflict(capturing, b);
      if (conflict) {
        setWarning(t('settings.shortcutConflict', { key: bindingLabel(b), name: t(conflict.desc) }));
        return;
      }
      setShortcutBinding(capturing, b);
      setWarning('');
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, t]);

  return (
    <div className="settings-list">
      <div className="btn-row">
        <input className="grow" placeholder={t('settings.shortcutSearch')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          type="button"
          className="btn small"
          onClick={() => {
            resetAllShortcuts();
            notify(t('settings.shortcutsReset'), 'success');
          }}
        >
          {t('settings.resetAll')}
        </button>
      </div>
      <p className="note">💡 {t('settings.shortcutHelp')}</p>
      {warning && <p className="warn-box">⚠ {warning}</p>}
      <div className="shortcut-edit-list">
        {list.map((sc) => (
          <div key={sc.id} className={`shortcut-edit-row ${capturing === sc.id ? 'capturing' : ''}`}>
            <span className="shortcut-group-tag">{t(`shortcutGroup.${sc.group}` as TKey)}</span>
            <span className="grow">{t(sc.desc)}</span>
            <kbd className={isCustomized(sc) ? 'custom' : ''}>{capturing === sc.id ? t('settings.pressKey') : sc.label}</kbd>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setWarning('');
                setCapturing(capturing === sc.id ? null : (sc.id ?? null));
              }}
            >
              {capturing === sc.id ? t('common.cancel') : t('settings.change')}
            </button>
            <button type="button" className="btn small ghost" disabled={!isCustomized(sc)} onClick={() => sc.id && setShortcutBinding(sc.id, null)}>
              {t('settings.default')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiTab() {
  const t = useT();
  const [url, setUrl] = useState(bridgeUrl());
  return (
    <div className="settings-list">
      <p className="note">💡 {t('dialog.codex.intro')}</p>
      <Row label={t('dialog.codex.bridgeUrl')} tip={t('settings.bridgeTip')}>
        <div className="btn-row">
          <input className="mono grow" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setBridgeUrl(url);
              notify(t('settings.savedToast'), 'success');
            }}
          >
            {t('common.apply')}
          </button>
        </div>
      </Row>
      <div className="btn-row">
        <button type="button" className="btn accent" onClick={() => setState({ dialog: { id: 'codex' } })}>
          🤖 {t('menu.codexConnect')}
        </button>
      </div>
    </div>
  );
}

function DataTab() {
  const t = useT();
  return (
    <div className="settings-list">
      <Row label={t('settings.recentFiles')}>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            void clearRecentFiles();
            notify(t('settings.recentCleared'), 'success');
          }}
        >
          {t('settings.clearRecent')}
        </button>
      </Row>
      <Row label={t('settings.resetSettings')} tip={t('settings.resetSettingsTip')}>
        <button
          type="button"
          className="btn small danger"
          onClick={() => {
            resetPrefs();
            window.location.reload();
          }}
        >
          {t('settings.resetAndReload')}
        </button>
      </Row>
      <Row label={t('settings.version')}>
        <span className="mono">v{__APP_VERSION__}</span>
      </Row>
    </div>
  );
}
