/**
 * 뼈대(본) 패널
 * ------------------------------------------------------------
 * 사용 순서 (초보자용)
 *  1) 그림을 파츠별 레이어로 나누기 (몸, 머리, 팔, 다리...) – "파츠 분리" 버튼
 *  2) 뼈 만들기 도구(J)로 몸통 → 팔 → 팔뚝 순서로 뼈를 그리기
 *  3) "자동 연결" 로 각 레이어를 가까운 뼈에 붙이기 (또는 아래에서 직접 선택)
 *  4) 자세 도구(P)로 뼈를 끌어서 프레임마다 자세 만들기 → 사이 프레임은 자동 계산
 */
import { boneKeyAt, findBone } from '../core/skeleton';
import { LINEAR } from '../core/easing';
import { useT } from '../i18n';
import {
  autoBindLayersAction,
  bindLayerAction,
  clearBoneAnimationAction,
  clearPoseKeyAction,
  deleteBoneAction,
  selectBone,
  setBoneKeyEaseAction,
  updateBindingAction,
  updateBoneAction,
} from '../store/boneActions';
import { setState, useEditor } from '../store/editorStore';
import { openPartSplit } from '../store/toolActions';
import { setTool } from '../editor/shortcuts';
import { EaseEditor } from './EaseEditor';
import { Icon } from './Icon';
import { NumberField, Toggle } from './ui';

export function SkeletonPanel() {
  const t = useT();
  useEditor((s) => s.docVersion);
  const project = useEditor((s) => s.project);
  const currentFrame = useEditor((s) => s.currentFrame);
  const selectedBoneId = useEditor((s) => s.selectedBoneId);
  const showBones = useEditor((s) => s.showBones);
  const ikEnabled = useEditor((s) => s.ikEnabled);
  const ikChain = useEditor((s) => s.ikChain);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId));
  const bone = findBone(project, selectedBoneId);
  const frame = project.frames[Math.min(currentFrame, project.frames.length - 1)];
  const boneKey = bone ? boneKeyAt(bone, frame.id) : undefined;

  return (
    <div className="skeleton-panel">
      <div className="btn-row">
        <button type="button" className="btn small" onClick={() => setTool('bone')}>
          <Icon name="bone" size={14} /> {t('tool.bone')}
        </button>
        <button type="button" className="btn small" onClick={() => setTool('pose')}>
          <Icon name="pose" size={14} /> {t('tool.pose')}
        </button>
        <button type="button" className="btn small" onClick={openPartSplit}>
          <Icon name="scissors" size={14} /> {t('menu.splitPart')}
        </button>
      </div>
      {project.bones.length === 0 ? (
        <p className="note">💡 {t('bones.intro')}</p>
      ) : (
        <>
          <div className="bone-list">
            {project.bones.map((b) => {
              let depth = 0;
              let cur = findBone(project, b.parentId);
              while (cur && depth < 20) {
                depth++;
                cur = findBone(project, cur.parentId);
              }
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`bone-row ${b.id === selectedBoneId ? 'active' : ''}`}
                  style={{ paddingLeft: 6 + depth * 12 }}
                  onClick={() => selectBone(b.id)}
                >
                  <span className="bone-dot" style={{ background: b.color }} />
                  {b.name}
                  {b.keys.some((k) => k.frameId === frame.id) && <span className="kf">◆</span>}
                </button>
              );
            })}
          </div>
          <div className="btn-row">
            <Toggle checked={showBones} onChange={(v) => setState({ showBones: v })}>
              {t('bones.show')}
            </Toggle>
            <Toggle checked={ikEnabled} onChange={(v) => setState({ ikEnabled: v })} tip={t('bones.ikTip')}>
              IK
            </Toggle>
            {ikEnabled && (
              <label className="opt" data-tip={t('bones.chainTip')}>
                {t('bones.chain')}
                <NumberField value={ikChain} min={2} max={6} width={36} onChange={(v) => setState({ ikChain: v })} />
              </label>
            )}
          </div>
        </>
      )}

      {bone && (
        <div className="bone-props">
          <div className="prop-row">
            <span className="prop-label">{t('props.name')}</span>
            <input key={bone.id + bone.name} className="grow" defaultValue={bone.name} onBlur={(e) => e.target.value.trim() && updateBoneAction(bone.id, { name: e.target.value.trim() })} />
          </div>
          <div className="prop-grid">
            <label>
              X <NumberField value={Math.round(bone.x * 10) / 10} min={-4096} max={4096} width={50} onChange={(x) => updateBoneAction(bone.id, { x })} />
            </label>
            <label>
              Y <NumberField value={Math.round(bone.y * 10) / 10} min={-4096} max={4096} width={50} onChange={(y) => updateBoneAction(bone.id, { y })} />
            </label>
            <label>
              {t('bones.angle')} <NumberField value={Math.round(bone.rotation)} min={-360} max={360} width={50} suffix="°" onChange={(rotation) => updateBoneAction(bone.id, { rotation })} />
            </label>
            <label>
              {t('bones.length')} <NumberField value={Math.round(bone.length)} min={1} max={4096} width={50} onChange={(length) => updateBoneAction(bone.id, { length })} />
            </label>
          </div>
          {boneKey && (
            <>
              <div className="field-label">{t('anim.easeTitle')}</div>
              <EaseEditor value={boneKey.ease ?? LINEAR} onChange={(e) => setBoneKeyEaseAction(bone.id, frame.id, e)} />
            </>
          )}
          <div className="btn-row">
            <button type="button" className="btn small" onClick={() => clearPoseKeyAction(false)} disabled={!boneKey}>
              {t('bones.clearKey')}
            </button>
            <button type="button" className="btn small danger" onClick={() => deleteBoneAction(bone.id)}>
              {t('bones.delete')}
            </button>
          </div>
        </div>
      )}

      {project.bones.length > 0 && (
        <div className="bind-box">
          <div className="field-label">{t('bones.bindTitle')}</div>
          {layer && layer.kind !== 'reference' && layer.kind !== 'group' ? (
            <>
              <div className="prop-row">
                <span className="prop-label">{layer.name}</span>
                <select className="grow" value={layer.bind?.boneId ?? ''} onChange={(e) => bindLayerAction(layer.id, e.target.value || null, layer.bind?.mode ?? 'rigid')}>
                  <option value="">{t('bones.none')}</option>
                  {project.bones.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              {layer.bind && (
                <div className="prop-row">
                  <div className="segmented">
                    <button type="button" className={layer.bind.mode === 'rigid' ? 'active' : ''} onClick={() => updateBindingAction(layer.id, { mode: 'rigid' })} data-tip={t('bones.rigidTip')}>
                      {t('bones.rigid')}
                    </button>
                    <button type="button" className={layer.bind.mode === 'mesh' ? 'active' : ''} onClick={() => updateBindingAction(layer.id, { mode: 'mesh' })} data-tip={t('bones.meshTip')}>
                      {t('bones.mesh')}
                    </button>
                  </div>
                  {layer.bind.mode === 'mesh' && (
                    <label className="opt" data-tip={t('bones.meshResTip')}>
                      <NumberField value={layer.bind.meshCols} min={1} max={16} width={36} onChange={(v) => updateBindingAction(layer.id, { meshCols: v, meshRows: v })} />
                    </label>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="note">{t('bones.selectPixelLayer')}</p>
          )}
          <div className="btn-row">
            <button type="button" className="btn small accent" onClick={autoBindLayersAction}>
              {t('bones.autoBind')}
            </button>
            <button type="button" className="btn small danger" onClick={clearBoneAnimationAction}>
              {t('bones.clearAnim')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
