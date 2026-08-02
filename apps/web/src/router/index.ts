import { createRouter, createWebHistory } from "vue-router";
import Overview from "../views/Overview.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", name: "overview", component: Overview }],
});

export default router;
