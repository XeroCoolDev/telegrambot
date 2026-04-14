<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const tg = window.Telegram.WebApp;

onMounted(() => {
  router.afterEach((to) => {
    if (to.path === "/") {
      tg.BackButton.hide();
    } else {
      tg.BackButton.show();
    }
  });

  tg.BackButton.onClick(() => {
    router.back();
  });
});
</script>

<template>
  <div class="app">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>
</template>

<style>
:root {
  --tg-bg: var(--tg-theme-bg-color, #ffffff);
  --tg-text: var(--tg-theme-text-color, #000000);
  --tg-hint: var(--tg-theme-hint-color, #999999);
  --tg-link: var(--tg-theme-link-color, #2481cc);
  --tg-btn: var(--tg-theme-button-color, #2481cc);
  --tg-btn-text: var(--tg-theme-button-text-color, #ffffff);
  --tg-secondary-bg: var(--tg-theme-secondary-bg-color, #f0f0f0);
  --tg-section-bg: var(--tg-theme-section-bg-color, #ffffff);
  --tg-section-header: var(--tg-theme-section-header-text-color, #6d7885);
  --tg-destructive: var(--tg-theme-destructive-text-color, #e53935);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--tg-bg);
  color: var(--tg-text);
  -webkit-font-smoothing: antialiased;
}

.app {
  min-height: 100vh;
  padding: 0 0 env(safe-area-inset-bottom, 0);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.page { padding: 16px; min-height: 100vh; display: flex; flex-direction: column; }
.section { background: var(--tg-section-bg); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
.section-header { font-size: 13px; font-weight: 500; color: var(--tg-section-header); text-transform: uppercase; letter-spacing: 0.02em; padding: 0 4px 8px; }
.card { background: var(--tg-section-bg); border-radius: 12px; overflow: hidden; }
.card + .card { margin-top: 8px; }
.card-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; }
.card-row + .card-row { border-top: 0.5px solid var(--tg-secondary-bg); }
.card-label { font-size: 14px; color: var(--tg-hint); }
.card-value { font-size: 14px; font-weight: 500; }

.empty-state { text-align: center; padding: 48px 24px; color: var(--tg-hint); }
.empty-state .icon, .empty-state .icon-svg { font-size: 48px; margin-bottom: 12px; }
.empty-state .icon-svg { width: 48px; height: 48px; stroke-width: 1.5; color: var(--tg-hint); }
.empty-state p { font-size: 14px; line-height: 1.5; }

.skeleton { background: var(--tg-secondary-bg); border-radius: 8px; animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.skeleton-line { height: 16px; margin-bottom: 8px; }
.skeleton-line:last-child { width: 60%; }

.status-badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.status-active { background: #e8f5e9; color: #2e7d32; }
.status-expiring { background: #fff3e0; color: #e65100; }
.status-expired { background: #ffebee; color: #c62828; }
.status-disabled { background: var(--tg-secondary-bg); color: var(--tg-hint); }
</style>
