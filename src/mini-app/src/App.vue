<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useLoading } from "./composables/useLoading";

const router = useRouter();
const tg = window.Telegram.WebApp;
const { visible: loadingVisible, message: loadingMessage } = useLoading();

// Wire up Telegram back button to router
onMounted(() => {
  router.afterEach((to, from) => {
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
    <router-view v-slot="{ Component, route }">
      <keep-alive include="Dashboard">
        <component :is="Component" :key="route.path" />
      </keep-alive>
    </router-view>

    <!-- Loading overlay -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="loadingVisible" class="loading-overlay">
          <div class="loading-spinner"></div>
          <div class="loading-text">{{ loadingMessage }}</div>
        </div>
      </transition>
    </Teleport>
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
  --tg-header-bg: var(--tg-theme-header-bg-color, #2481cc);
  --tg-section-bg: var(--tg-theme-section-bg-color, #ffffff);
  --tg-section-header: var(--tg-theme-section-header-text-color, #6d7885);
  --tg-subtitle: var(--tg-theme-subtitle-text-color, #6d7885);
  --tg-destructive: var(--tg-theme-destructive-text-color, #e53935);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--tg-bg);
  color: var(--tg-text);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.app {
  min-height: 100vh;
  padding: 0 0 env(safe-area-inset-bottom, 0);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Shared utilities */
.page {
  padding: 16px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.section {
  background: var(--tg-section-bg);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.section-header {
  font-size: 13px;
  font-weight: 500;
  color: var(--tg-section-header);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 0 4px 8px;
}

.card {
  background: var(--tg-section-bg);
  border-radius: 12px;
  overflow: hidden;
}

.card + .card {
  margin-top: 8px;
}

.card-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}

.card-row + .card-row {
  border-top: 0.5px solid var(--tg-secondary-bg);
}

.card-label {
  font-size: 14px;
  color: var(--tg-hint);
}

.card-value {
  font-size: 14px;
  font-weight: 500;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.btn:active {
  opacity: 0.7;
}

.btn-primary {
  background: var(--tg-btn);
  color: var(--tg-btn-text);
}

.btn-secondary {
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
}

.btn-destructive {
  background: var(--tg-destructive);
  color: #fff;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.status-active {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-expiring {
  background: #fff3e0;
  color: #e65100;
}

.status-expired {
  background: #ffebee;
  color: #c62828;
}

.status-disabled {
  background: var(--tg-secondary-bg);
  color: var(--tg-hint);
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--tg-hint);
}

.empty-state .icon,
.empty-state .icon-svg {
  font-size: 48px;
  margin-bottom: 12px;
}
.empty-state .icon-svg {
  width: 48px;
  height: 48px;
  stroke-width: 1.5;
  color: var(--tg-hint);
}

.empty-state p {
  font-size: 14px;
  line-height: 1.5;
}

.skeleton {
  background: var(--tg-secondary-bg);
  border-radius: 8px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.skeleton-line {
  height: 16px;
  margin-bottom: 8px;
}

.skeleton-line:last-child {
  width: 60%;
}

.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  gap: 16px;
}

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  color: white;
  font-size: 14px;
  font-weight: 500;
}
</style>
