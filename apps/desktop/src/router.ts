import {
  createRouter,
  createWebHistory,
  type RouterHistory,
} from "vue-router";
import AppShell from "./layouts/AppShell.vue";
import Today from "./pages/Today.vue";
import Inbox from "./pages/Inbox.vue";
import Calendar from "./pages/Calendar.vue";
import Widget from "./pages/Widget.vue";
import SettingsShell from "./pages/SettingsShell.vue";
import SyncSettings from "./pages/settings/SyncSettings.vue";
import AboutSettings from "./pages/settings/AboutSettings.vue";

export function createMomoRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: "/widget", component: Widget },
      {
        path: "/",
        component: AppShell,
        children: [
          { path: "", redirect: "/today" },
          { path: "today", component: Today },
          { path: "inbox", component: Inbox },
          { path: "calendar", component: Calendar },
        ],
      },
      {
        path: "/settings-shell",
        component: SettingsShell,
        children: [
          { path: "", redirect: "/settings-shell/sync" },
          { path: "sync", component: SyncSettings },
          { path: "about", component: AboutSettings },
        ],
      },
      { path: "/:pathMatch(.*)*", redirect: "/today" },
    ],
  });
}

export const router = createMomoRouter();
