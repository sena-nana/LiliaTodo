import "./composables/useTheme";
import { createApp } from "vue";
import App from "./App.vue";
import { installContextMenu } from "./composables/useContextMenu";
import { installTaskRepository } from "./data/TaskRepositoryContext";
import { vContextMenu } from "./directives/contextMenu";
import { router } from "./router";
import "./styles.css";
import "./styles/page.css";

installContextMenu();

const app = createApp(App);
installTaskRepository(app);
app.use(router);
app.directive("context-menu", vContextMenu);
app.mount("#root");
