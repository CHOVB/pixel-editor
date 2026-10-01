/**
 * 도구 옵션 막대 (메뉴 바로 아래)
 * ------------------------------------------------------------
 * 선택한 도구에 맞는 옵션만 보여줍니다. (초보자가 헷갈리지 않도록)
 * 오른쪽에는 "이 도구는 이렇게 쓰세요" 라는 짧은 도움말이 나옵니다.
 */
import { useT } from '../i18n';
import { centerPivotAction, setTrackMethodAction, toggleKeyframeAction } from '../store/animActions';
import { autoBindLayersAction, clearPoseKeyAction } from '../store/boneActions';
import { setState, useEditor } from '../store/editorStore';
import { toolInfo, usesBrush } from '../tools';
import { Icon } from './Icon';
import { NumberField, Toggle } from './ui';

export function ToolOptionsBar() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const brushSize = useEditor((s) => s.brushSize);
  const brushShape = useEditor((s) => s.brushShape);
  const pixelPerfect = useEditor((s) => s.pixelPerfect);
  const fillContiguous = useEditor((s) => s.fillContiguous);
  const fillTolerance = useEditor((s) => s.fillTolerance);
  const shapeFilled = useEditor((s) => s.shapeFilled);
  const symmetryX = useEditor((s) => s.symmetryX);
  const symmetryY = useEditor((s) => s.symmetryY);
  const showBones = useEditor((s) => s.showBones);
  const ikEnabled = useEditor((s) => s.ikEnabled);
  const ikChain = useEditor((s) => s.ikChain);
  const method = useEditor((s) => s.project.layers.find((l) => l.id === s.currentLayerId)?.anim?.method ?? 'nearest');
  const info = toolInfo(tool);

  const drawingTool = tool === 'pencil' || tool === 'eraser' || tool === 'dither';
  const shapeTool = tool === 'line' || tool === 'rect' || tool === 'ellipse';

  return (
    <div className="tool-options">
      <div className="tool-name">
        <Icon name={tool} size={16} />
        <strong>{t(info.name)}</strong>
      </div>

      {usesBrush(tool) && (
        <>
          <label className="opt">
            <span>{t('opt.size')}</span>
            <input
              type="range"
              min={1}
              max={32}
              value={brushSize}
              onChange={(e) => setState({ brushSize: Number(e.target.value) })}
              aria-label={t('opt.size')}
            />
            <NumberField value={brushSize} min={1} max={64} width={44} onChange={(v) => setState({ brushSize: v })} suffix="px" />
          </label>
          <div className="segmented" role="group" aria-label={t('opt.shape')}>
            <button
              type="button"
              className={brushShape === 'square' ? 'active' : ''}
              onClick={() => setState({ brushShape: 'square' })}
              data-tip={t('opt.square')}
            >
              ■
            </button>
            <button
              type="button"
              className={brushShape === 'circle' ? 'active' : ''}
              onClick={() => setState({ brushShape: 'circle' })}
              data-tip={t('opt.circle')}
            >
              ●
            </button>
          </div>
        </>
      )}

      {(tool === 'pencil' || tool === 'eraser') && (
        <Toggle checked={pixelPerfect} onChange={(v) => setState({ pixelPerfect: v })} tip={t('opt.pixelPerfectTip')}>
          {t('opt.pixelPerfect')}
        </Toggle>
      )}

      {(tool === 'rect' || tool === 'ellipse') && (
        <Toggle checked={shapeFilled} onChange={(v) => setState({ shapeFilled: v })}>
          {t('opt.filled')}
        </Toggle>
      )}

      {(tool === 'bucket' || tool === 'wand') && (
        <>
          <Toggle checked={fillContiguous} onChange={(v) => setState({ fillContiguous: v })} tip={t('opt.contiguousTip')}>
            {t('opt.contiguous')}
          </Toggle>
          <label className="opt" data-tip={t('opt.toleranceTip')}>
            <span>{t('opt.tolerance')}</span>
            <NumberField value={fillTolerance} min={0} max={255} width={48} onChange={(v) => setState({ fillTolerance: v })} />
          </label>
        </>
      )}

      {(drawingTool || shapeTool) && (
        <div className="opt-group">
          <span className="opt-label">{t('opt.symmetry')}</span>
          <button
            type="button"
            className={`icon-btn small ${symmetryX ? 'active' : ''}`}
            onClick={() => setState({ symmetryX: !symmetryX })}
            data-tip={t('opt.symmetryX')}
            aria-pressed={symmetryX}
          >
            <Icon name="mirrorX" size={16} />
          </button>
          <button
            type="button"
            className={`icon-btn small ${symmetryY ? 'active' : ''}`}
            onClick={() => setState({ symmetryY: !symmetryY })}
            data-tip={t('opt.symmetryY')}
            aria-pressed={symmetryY}
          >
            <Icon name="mirrorY" size={16} />
          </button>
        </div>
      )}

      {tool === 'transform' && (
        <>
          <div className="segmented" role="group" aria-label={t('anim.method')}>
            <button type="button" className={method === 'nearest' ? 'active' : ''} onClick={() => setTrackMethodAction('nearest')} data-tip={t('anim.nearestTip')}>
              {t('anim.nearest')}
            </button>
            <button type="button" className={method === 'rotsprite' ? 'active' : ''} onClick={() => setTrackMethodAction('rotsprite')} data-tip={t('anim.rotspriteTip')}>
              RotSprite
            </button>
          </div>
          <button type="button" className="btn small" onClick={toggleKeyframeAction} data-tip="K">
            <Icon name="diamond" size={14} /> {t('menu.addKey')}
          </button>
          <button type="button" className="btn small" onClick={centerPivotAction}>
            <Icon name="target" size={14} /> {t('anim.centerPivot')}
          </button>
        </>
      )}

      {(tool === 'bone' || tool === 'pose') && (
        <Toggle checked={showBones} onChange={(v) => setState({ showBones: v })}>
          {t('bones.show')}
        </Toggle>
      )}

      {tool === 'bone' && (
        <button type="button" className="btn small" onClick={autoBindLayersAction} data-tip={t('bones.autoBindTip')}>
          <Icon name="link" size={14} /> {t('bones.autoBind')}
        </button>
      )}

      {tool === 'pose' && (
        <>
          <Toggle checked={ikEnabled} onChange={(v) => setState({ ikEnabled: v })} tip={t('bones.ikTip')}>
            IK
          </Toggle>
          {ikEnabled && (
            <label className="opt" data-tip={t('bones.chainTip')}>
              <span>{t('bones.chain')}</span>
              <NumberField value={ikChain} min={2} max={6} width={40} onChange={(v) => setState({ ikChain: v })} />
            </label>
          )}
          <button type="button" className="btn small" onClick={() => clearPoseKeyAction(false)}>
            {t('bones.clearKey')}
          </button>
        </>
      )}

      <div className="tool-hint" title={t(info.hint)}>
        💡 {t(info.hint)}
      </div>
    </div>
  );
}
