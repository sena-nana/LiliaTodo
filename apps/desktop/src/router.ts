import {
  createRouter,
  createWebHistory,
  type RouterHistory,
} from "vue-router";
import AppShell from "./layouts/AppShell.vue";

export function createMomoRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: "/widget", component: () => import("./pages/Widget.vue") },
      {
        path: "/",
        component: AppShell,
        meta: { sidebar: "main", returnable: true },
        children: [
          { path: "", redirect: "/today" },
          { path: "today", component: () => import("./pages/Today.vue"), meta: { sidebar: "main", returnable: true } },
          { path: "inbox", component: () => import("./pages/Inbox.vue"), meta: { sidebar: "main", returnable: true } },
          { path: "lists/:listId", component: () => import("./pages/TaskListPage.vue"), meta: { sidebar: "main", returnable: true } },
          { path: "calendar", component: () => import("./pages/Calendar.vue"), meta: { sidebar: "main", returnable: true } },
          {
            path: "settings",
            component: () => import("./pages/Settings.vue"),
            meta: { sidebar: "settings", lockSidebar: true, returnable: false },
          },
        ],
      },
      { path: "/:pathMatch(.*)*", redirect: "/today" },
    ],
  });
}

export const router = createMomoRouter();
