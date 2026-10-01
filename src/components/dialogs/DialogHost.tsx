/**
 * 열려 있는 대화상자를 화면에 표시하는 곳
 * ------------------------------------------------------------
 * store 의 dialog 값만 바꾸면 해당 대화상자가 열립니다.
 *   setState({ dialog: { id: 'export' } })
 */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useEditor } from '../../store/editorStore';
import { CanvasSizeDialog, ScaleDialog } from './CanvasDialogs';
import { AboutDialog, ConfirmDialog, FrameDurationDialog, LayerPropsDialog, ShortcutsDialog, TagDialog } from './MiscDialogs';
import { NewProjectDialog } from './NewProjectDialog';
import { WelcomeDialog } from './WelcomeDialog';

/**
 * 자주 쓰지 않는 큰 대화상자는 "처음 열 때" 내려받습니다. (프로그램 첫 실행이 빨라짐)
 * lazy(() => import(...)) 는 그 파일을 따로 묶어 두었다가 필요할 때 불러옵니다.
 */
// 어떤 props 를 받는 대화상자든 넣을 수 있도록 ComponentType<any> 를 씁니다.
function lazyNamed<M extends Record<K, ComponentType<any>>, K extends string>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K]> {
  return lazy(async () => ({ default: (await load())[name] }));
}
const ExportDialog = lazyNamed(() => import('./ExportDialog'), 'ExportDialog');
const InbetweenDialog = lazyNamed(() => import('./InbetweenDialog'), 'InbetweenDialog');
const PixelFixerDialog = lazyNamed(() => import('./PixelFixerDialog'), 'PixelFixerDialog');
const SettingsDialog = lazyNamed(() => import('./SettingsDialog'), 'SettingsDialog');
const LicenseDialog = lazyNamed(() => import('./LicenseDialog'), 'LicenseDialog');
const CodexDialog = lazyNamed(() => import('./AiDialogs'), 'CodexDialog');
const PartFillDialog = lazyNamed(() => import('./AiDialogs'), 'PartFillDialog');
const VfxDialog = lazyNamed(() => import('./ToolDialogs'), 'VfxDialog');
const CleanupDialog = lazyNamed(() => import('./ToolDialogs'), 'CleanupDialog');
const ReplaceColorDialog = lazyNamed(() => import('./ToolDialogs'), 'ReplaceColorDialog');
const ImportSheetDialog = lazyNamed(() => import('./ToolDialogs'), 'ImportSheetDialog');

export function DialogHost() {
  return (
    <Suspense fallback={null}>
      <DialogSwitch />
    </Suspense>
  );
}

function DialogSwitch() {
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
    case 'inbetween':
      return <InbetweenDialog from={payload.from as number | undefined} to={payload.to as number | undefined} />;
    case 'pixelFixer':
      return <PixelFixerDialog file={payload.file as File | undefined} />;
    case 'importSheet':
      return <ImportSheetDialog />;
    case 'replaceColor':
      return <ReplaceColorDialog />;
    case 'cleanup':
      return <CleanupDialog />;
    case 'vfx':
      return <VfxDialog />;
    case 'codex':
      return <CodexDialog />;
    case 'partFill':
      return <PartFillDialog />;
    case 'settings':
      return <SettingsDialog tab={payload.tab as 'general' | 'editing' | 'shortcuts' | 'ai' | 'data' | undefined} />;
    case 'license':
      return <LicenseDialog />;
    default:
      return null;
  }
}
