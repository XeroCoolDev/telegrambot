<script setup lang="ts">
import { useRouter } from "vue-router";
import { Smartphone, Tv, Apple } from "lucide-vue-next";

const props = defineProps<{ id: string }>();
const router = useRouter();
const tg = window.Telegram.WebApp;

function go(app: string) {
  tg.HapticFeedback.selectionChanged();
  router.push(`/line/${props.id}/setup/${app}`);
}
</script>

<template>
  <div class="page">
    <div class="section-header">Set up on your device</div>
    <p style="font-size: 13px; color: var(--tg-hint); margin-bottom: 16px">
      Pick the device you want to watch on.
    </p>

    <div class="option-card" @click="go('xciptv')">
      <Smartphone class="option-icon" />
      <div>
        <div class="option-title">Android / Fire TV</div>
        <div class="option-sub">Our own XCIPTV app via Downloader</div>
      </div>
    </div>

    <div class="option-card" @click="go('gse')">
      <Apple class="option-icon" />
      <div>
        <div class="option-title">Apple (iPhone / iPad / Apple TV)</div>
        <div class="option-sub">GSE Smart IPTV — free from the App Store</div>
      </div>
    </div>

    <div class="option-card" @click="go('formuler')">
      <Tv class="option-icon" />
      <div>
        <div class="option-title">Formuler Box</div>
        <div class="option-sub">Built-in MyTVOnline player</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.option-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  margin-bottom: 10px;
  background: var(--tg-secondary-bg);
  border-radius: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.option-card:active { opacity: 0.7; }
.option-icon {
  width: 28px;
  height: 28px;
  color: var(--tg-link);
  flex-shrink: 0;
}
.option-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--tg-text);
}
.option-sub {
  font-size: 12px;
  color: var(--tg-hint);
  margin-top: 2px;
}
</style>
