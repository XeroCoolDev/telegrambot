import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory("/c/"),
  routes: [
    {
      path: "/",
      name: "dashboard",
      component: () => import("./views/Dashboard.vue"),
    },
    {
      path: "/line/:id",
      name: "line-details",
      component: () => import("./views/LineDetails.vue"),
      props: true,
    },
    {
      path: "/line/:id/setup",
      name: "setup-picker",
      component: () => import("./views/setup/SetupPicker.vue"),
      props: true,
    },
    {
      path: "/line/:id/setup/xciptv",
      name: "setup-xciptv",
      component: () => import("./views/setup/SetupXciptv.vue"),
      props: true,
    },
    {
      path: "/line/:id/setup/gse",
      name: "setup-gse",
      component: () => import("./views/setup/SetupGse.vue"),
      props: true,
    },
    {
      path: "/line/:id/setup/formuler",
      name: "setup-formuler",
      component: () => import("./views/setup/SetupFormuler.vue"),
      props: true,
    },
  ],
});
