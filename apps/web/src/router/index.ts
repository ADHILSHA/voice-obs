import { createRouter, createWebHistory } from "vue-router";
import ActionQueue from "../views/ActionQueue.vue";
import AgentDetail from "../views/AgentDetail.vue";
import CallInspector from "../views/CallInspector.vue";
import Overview from "../views/Overview.vue";
import Setup from "../views/Setup.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "overview", component: Overview },
    { path: "/setup", name: "setup", component: Setup },
    { path: "/agents/:id", name: "agent-detail", component: AgentDetail },
    { path: "/calls/:id", name: "call-inspector", component: CallInspector },
    { path: "/actions", name: "action-queue", component: ActionQueue },
  ],
});

export default router;
