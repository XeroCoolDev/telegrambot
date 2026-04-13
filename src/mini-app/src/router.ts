import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "dashboard",
      component: () => import("./views/Dashboard.vue"),
    },
    {
      path: "/buy",
      name: "buy-credits",
      component: () => import("./views/BuyCredits.vue"),
    },
    {
      path: "/line/:id",
      name: "line-details",
      component: () => import("./views/LineDetails.vue"),
      props: true,
    },
    {
      path: "/extend/:lineId",
      name: "extend-line",
      component: () => import("./views/ExtendLine.vue"),
      props: true,
    },
    {
      path: "/connections/:lineId",
      name: "add-connections",
      component: () => import("./views/AddConnections.vue"),
      props: true,
    },
    {
      path: "/create",
      name: "create-line",
      component: () => import("./views/CreateLine.vue"),
    },
  ],
});
