/**
 * 열려 있는 대화상자를 화면에 표시하는 곳
 * ------------------------------------------------------------
 * store 의 dialog 값만 바꾸면 해당 대화상자가 열립니다.
 *   setState({ dialog: { id: 'export' } })
 */
import { useEditor } from '../../store/editorStore';
import { CanvasSizeDialog, ScaleDialog } from './CanvasDialogs';
import { ExportDialog } from './ExportDialog';
import { AboutDialog, ConfirmDialog, FrameDurationDialog, LayerPropsDialog, ShortcutsDialog, TagDialog } from './MiscDialogs';
import { NewProjectDialog } from './NewProjectDialog';
import { WelcomeDialog } from './WelcomeDialog';

export function DialogHost() {
  const dialog = useEditor((s) => s.dialog);
  if (!dialog) return null;
  const payload = dialog.payload ?? {};
  switch (dialog.id) {
    case 'welcome':
      return <WelcomeDialog />;
    case 'new':
      return <NewProjectDialog />;
    case 'export':
      return <ExportDialog />;
    case 'canvasSize':
      return <CanvasSizeDialog />;
    case 'scale':
      return <ScaleDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'frameDuration':
      return <FrameDurationDialog index={payload.index as number | undefined} />;
    case 'layerProps':
      return <LayerPropsDialog />;
    case 'tag':
      return (
        <TagDialog
          tagId={payload.tagId as string | undefined}
          from={payload.from as number | undefined}
          to={payload.to as number | undefined}
        />
      );
    case 'confirm':
      return (
        <ConfirmDialog
          message={String(payload.message ?? '')}
          confirmLabel={payload.confirmLabel as string | undefined}
          onConfirm={payload.onConfirm as (() => void) | undefined}
        />
      );
    default:
      return null;
  }
}
