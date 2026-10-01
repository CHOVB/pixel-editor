/**
 * 팔레트 패널
 * ------------------------------------------------------------
 *  - 색 칸 왼쪽 클릭: 주 색 / 오른쪽 클릭: 보조 색
 *  - 위쪽 목록에서 유명한 팔레트(PICO-8, Endesga 32 등)를 고를 수 있습니다.
 *  - 팔레트 파일(.hex .gpl .txt) 가져오기/내보내기 지원
 */
import { colorToCss, colorToHex } from '../core/color';
import { PALETTE_PRESETS } from '../core/palettes';
import { exportPaletteFile, importPaletteFile } from '../editor/fileActions';
import { useT } from '../i18n';
import {
  addColorToPalette,
  extractPaletteFromSprite,
  loadPalettePreset,
  removePaletteColor,
  setColor,
  sortPaletteByBrightness,
} from '../store/actions';
import { setState, useEditor } from '../store/editorStore';
import { IconButton } from './ui';

export function PalettePanel() {
  const t = useT();
  const palette = useEditor((s) => s.project.palette);
  useEditor((s) => s.docVersion);
  const paletteId = useEditor((s) => s.paletteId);
  const paletteIndex = useEditor((s) => s.paletteIndex);
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);

  return (
    <div className="palette-panel">
      <div className="palette-head">
        <select
          value={PALETTE_PRESETS.some((p) => p.id === paletteId) ? paletteId : ''}
          onChange={(e) => loadPalettePreset(e.target.value)}
          aria-label={t('palette.preset')}
        >
          <option value="" disabled>
            {t('palette.custom')}
          </option>
          {PALETTE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.colors.length})
            </option>
          ))}
        </select>
      </div>

      <div className="swatches" role="listbox" aria-label={t('panel.palette')}>
        {palette.map((c, i) => (
          <button
            key={`${i}-${c}`}
            type="button"
            role="option"
            aria-selected={paletteIndex === i}
            className={`swatch ${paletteIndex === i ? 'selected' : ''} ${c === primary ? 'is-primary' : ''} ${c === secondary ? 'is-secondary' : ''}`}
            style={{ ['--swatch' as string]: colorToCss(c) }}
            data-tip={colorToHex(c)}
            onClick={() => {
              setColor('primary', c);
              setState({ paletteIndex: i, activeSlot: 'primary' });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setColor('secondary', c);
              setState({ paletteIndex: i });
            }}
          />
        ))}
        {palette.length === 0 && <div className="empty-note">{t('palette.empty')}</div>}
      </div>

      <div className="panel-actions">
        <IconButton icon="plus" label={t('palette.addCurrent')} onClick={() => addColorToPalette(primary)} size={16} />
        <IconButton
          icon="minus"
          label={t('palette.removeSelected')}
          onClick={() => removePaletteColor(paletteIndex)}
          disabled={paletteIndex < 0}
          size={16}
        />
        <IconButton icon="sort" label={t('palette.sort')} onClick={sortPaletteByBrightness} size={16} />
        <IconButton icon="image" label={t('palette.extract')} onClick={extractPaletteFromSprite} size={16} />
        <span className="spacer" />
        <IconButton icon="upload" label={t('palette.import')} onClick={() => void importPaletteFile()} size={16} />
        <IconButton icon="download" label={t('palette.exportHex')} onClick={() => void exportPaletteFile('hex')} size={16} />
      </div>
    </div>
  );
}
