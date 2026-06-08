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
import Settings from "./pages/Settings.vue";

export function createMomoRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: "/widget", component: Widget },
      {
        path: "/",
        component: AppShell,
        meta: { sidebar: "main", returnable: true },
        children: [
          { path: "", redirect: "/today" },
          { path: "today", component: Today, meta: { sidebar: "main", returnable: true } },
          { path: "inbox", component: Inbox, meta: { sidebar: "main", returnable: true } },
          { path: "calendar", component: Calendar, meta: { sidebar: "main", returnable: true } },
          {
            path: "settings",
            component: Settings,
            meta: { sidebar: "settings", lockSidebar: true, returnable: false },
          },
        ],
      },
      { path: "/:pathMatch(.*)*", redirect: "/today" },
    ],
  });
}

export const router = createMomoRouter();
