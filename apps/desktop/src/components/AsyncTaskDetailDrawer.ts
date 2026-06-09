import { defineAsyncComponent } from "vue";

export const AsyncTaskDetailDrawer = defineAsyncComponent(() =>
  import("./TaskDetailDrawer.vue"),
);
