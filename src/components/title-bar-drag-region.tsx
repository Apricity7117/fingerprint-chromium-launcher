/** macOS Overlay 标题栏占位：为红绿灯与窗口标题预留高度，同时作为窗口拖动区域 */
export function TitleBarDragRegion() {
  return <div data-tauri-drag-region className="h-7 shrink-0" />;
}
