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
  ],
});
