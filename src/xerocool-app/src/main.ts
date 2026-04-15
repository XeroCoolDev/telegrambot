import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";

const app = createApp(App);
app.use(router);
app.mount("#app");

// Tell Telegram the mini app is ready
window.Telegram.WebApp.ready();
window.Telegram.WebApp.expand();
