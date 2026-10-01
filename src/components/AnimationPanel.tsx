/**
 * 애니메이션(키프레임) 패널
 * ------------------------------------------------------------
 * 선택한 레이어의 "지금 프레임" 위치/회전/크기/불투명도를 숫자로 보여주고 바꿀 수 있습니다.
 * 값을 바꾸면 이 프레임에 키프레임이 자동으로 찍힙니다. (◆)
 * 두 키프레임 사이의 프레임들은 자동으로 계산됩니다. (트윈)
 */
import { keyAt } from '../core/keyframes';
import { LINEAR } from '../core/easing';
import { useT } from '../i18n';
import {
  centerPivotAction,
  clearAnimationAction,
  currentTransform,
  gotoNeighborKey,
  setKeyEaseAction,
  setPivotAction,
  setTrackMethodAction,
  setTransformKeyAction,
  toggleKeyframeAction,
} from '../store/animActions';
import { useEditor } from '../store/editorStore';
import { setTool } from '../editor/shortcuts';
import { EaseEditor } from './EaseEditor';
import { Icon } from './Icon';
import { IconButton, NumberField } from './ui';

export function AnimationPanel() {
  const t = useT();
  useEditor((s) => s.docVersion);
  const currentFrame = useEditor((s) => s.currentFrame);
  const project = useEditor((s) => s.project);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId));
  if (!layer || layer.kind === 'reference') return <p className="note">{t('anim.noLayer')}</p>;

  const frame = project.frames[Math.min(currentFrame, project.frames.length - 1)];
  const v = currentTransform(layer);
  const key = keyAt(layer.anim, frame.id);
  const keyCount = layer.anim?.keys.length ?? 0;

  if (!layer.anim || keyCount === 0) {
    return (
      <div className="anim-panel">
        <p className="note">💡 {t('anim.intro')}</p>
        <button type="button" className="btn small accent" onClick={() => setTool('transform')}>
          <Icon name="transform" size={14} /> {t('anim.useTransformTool')}
        </button>
        <button type="button" className="btn small" onClick={toggleKeyframeAction}>
          ◆ {t('menu.addKey')}
        </button>
      </div>
    );
  }

  return (
    <div className="anim-panel">
      <div className="anim-key-row">
        <IconButton icon="prevKey" label={t('timeline.prevKey')} onClick={() => gotoNeighborKey(-1)} size={14} />
        <button type="button" className={`key-toggle ${key ? 'on' : ''}`} onClick={toggleKeyframeAction} data-tip={key ? t('menu.removeKey') : t('menu.addKey')}>
          ◆ {key ? t('anim.keyHere') : t('anim.noKeyHere')}
        </button>
        <IconButton icon="nextKey" label={t('timeline.nextKey')} onClick={() => gotoNeighborKey(1)} size={14} />
        <span className="spacer" />
        <span className="note">{t('anim.keyCount', { count: keyCount })}</span>
      </div>

      <div className="prop-grid">
        <label>
          X <NumberField value={v.x} min={-4096} max={4096} width={54} onChange={(x) => setTransformKeyAction({ x })} />
        </label>
        <label>
          Y <NumberField value={v.y} min={-4096} max={4096} width={54} onChange={(y) => setTransformKeyAction({ y })} />
        </label>
        <label>
          {t('anim.rotation')} <NumberField value={v.rotation} min={-3600} max={3600} width={54} suffix="°" onChange={(rotation) => setTransformKeyAction({ rotation })} />
        </label>
        <label>
          {t('anim.scaleX')} <NumberField value={Math.round(v.scaleX * 100)} min={-1000} max={1000} width={54} suffix="%" onChange={(s) => setTransformKeyAction({ scaleX: s / 100 })} />
        </label>
        <label>
          {t('anim.scaleY')} <NumberField value={Math.round(v.scaleY * 100)} min={-1000} max={1000} width={54} suffix="%" onChange={(s) => setTransformKeyAction({ scaleY: s / 100 })} />
        </label>
        <label>
          {t('anim.opacity')} <NumberField value={Math.round(v.opacity * 100)} min={0} max={100} width={54} suffix="%" onChange={(o) => setTransformKeyAction({ opacity: o / 100 })} />
        </label>
      </div>

      {key ? (
        <>
          <div className="field-label">{t('anim.easeTitle')}</div>
          <EaseEditor value={key.ease ?? LINEAR} onChange={(ease) => setKeyEaseAction(frame.id, ease)} />
        </>
      ) : (
        <p className="note">{t('anim.easeNeedsKey')}</p>
      )}

      <div className="prop-row">
        <span className="prop-label">{t('anim.method')}</span>
        <div className="segmented">
          <button type="button" className={layer.anim.method === 'nearest' ? 'active' : ''} onClick={() => setTrackMethodAction('nearest')} data-tip={t('anim.nearestTip')}>
            {t('anim.nearest')}
          </button>
          <button type="button" className={layer.anim.method === 'rotsprite' ? 'active' : ''} onClick={() => setTrackMethodAction('rotsprite')} data-tip={t('anim.rotspriteTip')}>
            RotSprite
          </button>
        </div>
      </div>

      <div className="prop-row">
        <span className="prop-label">{t('anim.pivot')}</span>
        <NumberField value={layer.anim.pivotX} min={-4096} max={4096} width={48} onChange={(x) => setPivotAction(x, layer.anim?.pivotY ?? 0)} />
        <NumberField value={layer.anim.pivotY} min={-4096} max={4096} width={48} onChange={(y) => setPivotAction(layer.anim?.pivotX ?? 0, y)} />
        <IconButton icon="target" label={t('anim.centerPivot')} onClick={centerPivotAction} size={14} />
      </div>

      <button type="button" className="btn small danger" onClick={clearAnimationAction}>
        {t('anim.clear')}
      </button>
    </div>
  );
}
