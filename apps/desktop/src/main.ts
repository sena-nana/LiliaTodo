import "./composables/useTheme";
import { createApp } from "vue";
import App from "./App.vue";
import {
  createAgentAutoTriggerController,
  createAgentObservedTaskRepository,
  installAgentAutoTriggerController,
} from "./agent/autoTriggers";
import { installContextMenu } from "./composables/useContextMenu";
import { installTaskRepository } from "./data/TaskRepositoryContext";
import { createLazyTaskRepository } from "./data/lazyTaskRepository";
import { vContextMenu } from "./directives/contextMenu";
import { router } from "./router";
import "./styles.css";
import "./styles/page.css";

installContextMenu();

const rawRepository = createLazyTaskRepository();
const agentAutoTriggerController = createAgentAutoTriggerController(rawRepository);
const repository = createAgentObservedTaskRepository(rawRepository, agentAutoTriggerController);

const app = createApp(App);
installTaskRepository(app, repository);
installAgentAutoTriggerController(app, agentAutoTriggerController);
app.use(router);
app.directive("context-menu", vContextMenu);
app.mount("#root");
