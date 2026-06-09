import {
  CalendarDays,
  Info,
  Inbox,
  Palette,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
} from "lucide-vue-next";
import { defineAsyncComponent, type Component } from "vue";
import type { RouteLocationRaw } from "vue-router";

export const APP_TITLE = "LiliaTodo";

export const SIDEBAR_CONFIG = {
  widthStorageKey: "liliatodo.sidebarWidth",
  collapsedStorageKey: "liliatodo.sidebarCollapsed",
  minWidth: 164,
  maxWidth: 420,
  defaultWidth: 184,
} as const;

export interface SidebarNavItem {
  to?: string;
  label: string;
  icon: Component;
  disabled?: boolean;
}

export interface SidebarFooterLink {
  to: RouteLocationRaw;
  label: string;
  title?: string;
  icon: Component;
}

export interface SidebarFooterStatus {
  to: RouteLocationRaw;
  label: string;
  title: string;
  tone: "ok" | "warn" | "error";
  icon: Component;
}

export const SIDEBAR_NAV: SidebarNavItem[] = [
  { to: "/today", label: "今日", icon: Sun },
  { to: "/inbox", label: "收件箱", icon: Inbox },
  { to: "/calendar", label: "日历", icon: CalendarDays },
];

export const SIDEBAR_FOOTER_LINKS: SidebarFooterLink[] = [
  { to: { path: "/settings", query: { tab: "sync" } }, label: "设置", icon: Settings },
];

export const SIDEBAR_FOOTER_STATUS: SidebarFooterStatus = {
  to: { path: "/settings", query: { tab: "sync" } },
  label: "WebDAV",
  title: "进入同步设置。",
  tone: "ok",
  icon: Sparkles,
};

export type SettingsTabKey = "sync" | "appearance" | "about";

export interface SettingsTab {
  key: SettingsTabKey;
  label: string;
  icon: Component;
  to: RouteLocationRaw;
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    key: "sync",
    label: "同步",
    icon: RefreshCw,
    to: { path: "/settings", query: { tab: "sync" } },
  },
  {
    key: "appearance",
    label: "外观",
    icon: Palette,
    to: { path: "/settings", query: { tab: "appearance" } },
  },
  {
    key: "about",
    label: "关于",
    icon: Info,
    to: { path: "/settings", query: { tab: "about" } },
  },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = "sync";

export const SETTINGS_SECTIONS: Record<SettingsTabKey, Component> = {
  sync: defineAsyncComponent(() => import("../pages/settings/SyncSettings.vue")),
  appearance: defineAsyncComponent(() => import("../pages/settings/AppearanceSettings.vue")),
  about: defineAsyncComponent(() => import("../pages/settings/AboutSettings.vue")),
};

export function normalizeSettingsTab(value: unknown): SettingsTabKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.some((tab) => tab.key === candidate)
    ? (candidate as SettingsTabKey)
    : DEFAULT_SETTINGS_TAB;
}
