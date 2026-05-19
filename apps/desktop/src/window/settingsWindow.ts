import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Window } from "@tauri-apps/api/window";

const SETTINGS_LABEL = "settings";

const SETTINGS_WINDOW_OPTIONS = {
  url: "/settings-shell",
  title: "Momo 设置",
  decorations: false,
  width: 680,
  height: 500,
  minWidth: 560,
  minHeight: 400,
  resizable: true,
  center: true,
  visible: true,
} as const;

export async function openSettingsWindow(): Promise<void> {
  const existing = await Window.getByLabel(SETTINGS_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  new WebviewWindow(SETTINGS_LABEL, SETTINGS_WINDOW_OPTIONS);
}
