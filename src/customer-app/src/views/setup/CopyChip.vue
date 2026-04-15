<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ value: string | null | undefined; label?: string }>();
const tg = window.Telegram.WebApp;
const copied = ref(false);

async function copy() {
  if (!props.value) return;
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    tg.HapticFeedback.notificationOccurred("success");
    setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    tg.HapticFeedback.notificationOccurred("error");
  }
}
</script>

<template>
  <span class="chip" :class="{ copied }" :title="copied ? 'Copied!' : 'Tap to copy'" @click.stop="copy">{{ value || "—" }}</span>
</template>

<style scoped>
.chip {
  display: inline;
  padding: 0 6px;
  background: var(--tg-secondary-bg);
  border-radius: 4px;
  font-family: monospace;
  font-size: inherit;
  color: var(--tg-link);
  cursor: pointer;
  word-break: break-all;
  transition: background 0.15s;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.chip:active { opacity: 0.6; }
.chip.copied { background: rgba(52, 199, 89, 0.2); color: #34c759; }
</style>
