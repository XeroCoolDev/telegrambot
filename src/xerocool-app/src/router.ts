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
    {
      path: "/admin",
      name: "admin",
      component: () => import("./views/Admin.vue"),
    },
    {
      path: "/admin/user/:id",
      name: "admin-user",
      component: () => import("./views/AdminUser.vue"),
      props: true,
    },
    // The Dashboard in admin mode: one reseller's lines with the same
    // filters, search, sort and paging as the reseller sees for their own.
    {
      path: "/admin/user/:ownerId/lines",
      name: "admin-user-lines",
      component: () => import("./views/Dashboard.vue"),
      props: true,
    },
    {
      path: "/admin/user/:id/payments",
      name: "admin-user-payments",
      component: () => import("./views/AdminUserPayments.vue"),
      props: true,
    },
  ],
});
