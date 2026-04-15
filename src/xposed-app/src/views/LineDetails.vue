<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { HelpCircle } from "lucide-vue-next";
import { api, useAsync } from "../composables/useApi";

const props = defineProps<{ id: string }>();
const tg = window.Telegram.WebApp;
const router = useRouter();

function goSetup() {
  tg.HapticFeedback.selectionChanged();
  router.push(`/line/${props.id}/setup`);
}

const renewing = ref(false);

async function requestRenewal() {
  if (renewing.value) return;

  const confirmed = await new Promise<boolean>((resolve) => {
    tg.showConfirm(
      "Request a renewal for this subscription? Your provider will be notified.",
      (ok: boolean) => resolve(ok)
    );
  });
  if (!confirmed) return;

  renewing.value = true;
  tg.MainButton.showProgress();
  try {
    await api.requestRenewal(props.id);
    tg.HapticFeedback.notificationOccurred("success");
    tg.showAlert("Renewal requested. We'll be in touch shortly.");
  } catch (e: any) {
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Couldn't send the request. Try again shortly.");
  } finally {
    renewing.value = false;
    tg.MainButton.hideProgress();
  }
}

onMounted(() => {
  tg.MainButton.setText("Request Renewal");
  tg.MainButton.onClick(requestRenewal);
});

onUnmounted(() => {
  tg.MainButton.offClick(requestRenewal);
  tg.MainButton.hide();
});

const { data: line, loading } = useAsync(() => api.getLine(props.id));

// Show the MainButton once the line loads, hide if it fails
watch(line, (l) => {
  if (l) tg.MainButton.show();
  else tg.MainButton.hide();
});

const toggling = ref(false);
const copied = ref(false);

const copyText = computed(() => {
  if (!line.value) return "";
  const l = line.value;
  return [
    `Username: ${l.username}`,
    `Password: ${l.password}`,
    `Expires: ${l.expiresDateTime || l.expiresFormatted}`,
    `Connections: ${l.maxConnections}`,
  ].join("\n");
});

async function copyDetails() {
  try {
    await navigator.clipboard.writeText(copyText.value);
    copied.value = true;
    tg.HapticFeedback.notificationOccurred("success");
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    tg.HapticFeedback.notificationOccurred("error");
  }
}

async function toggleAdult() {
  if (!line.value || toggling.value) return;
  const newState = !line.value.adultEnabled;
  toggling.value = true;
  try {
    await api.toggleAdult(line.value.id, newState);
    line.value.adultEnabled = newState;
    tg.HapticFeedback.notificationOccurred(newState ? "success" : "warning");
  } catch {
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    toggling.value = false;
  }
}

function statusClass(sub: any) {
  if (sub.status === "disabled") return "status-disabled";
  if (sub.daysLeft !== null && sub.daysLeft <= 0) return "status-expired";
  if (sub.daysLeft !== null && sub.daysLeft <= 3) return "status-expiring";
  return "status-active";
}

function statusLabel(sub: any) {
  if (sub.status === "disabled") return "Disabled";
  if (sub.daysLeft !== null && sub.daysLeft <= 0) return "Expired";
  return "Active";
}
</script>

<template>
  <div class="page">
    <template v-if="loading">
      <div class="section">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </template>

    <template v-else-if="!line">
      <div class="empty-state">
        <HelpCircle class="icon-svg" />
        <p>Line not found.</p>
      </div>
    </template>

    <template v-else>
      <!-- Connection details — copyable -->
      <div class="copy-block" @click="copyDetails">
        <div class="copy-header">
          <div class="copy-header-id">#{{ line.id }}</div>
          <div class="copy-badges">
            <span class="status-badge" :class="statusClass(line)">{{ statusLabel(line) }}</span>
          </div>
        </div>
        <div class="copy-divider"></div>
        <div class="copy-row">
          <span class="copy-label">Username</span>
          <span class="copy-value">{{ line.username }}</span>
        </div>
        <div class="copy-row">
          <span class="copy-label">Password</span>
          <span class="copy-value">{{ line.password }}</span>
        </div>
        <div class="copy-row">
          <span class="copy-label">Expires</span>
          <span class="copy-value">{{ line.expiresDateTime || line.expiresFormatted }}</span>
        </div>
        <div class="copy-row">
          <span class="copy-label">Connections</span>
          <span class="copy-value">{{ line.maxConnections }}</span>
        </div>
        <div class="copy-footer">
          <span class="copy-hint">{{ copied ? 'Copied!' : 'Tap to copy' }}</span>
        </div>
      </div>

      <!-- Adult content toggle -->
      <div class="card" style="margin-top: 12px">
        <div class="card-row" style="cursor: pointer" @click="toggleAdult">
          <div>
            <span class="card-label">Adult Content</span>
            <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
              {{ line.adultEnabled ? 'Enabled' : 'Disabled' }}
            </div>
          </div>
          <label class="toggle" @click.stop>
            <input
              type="checkbox"
              :checked="line.adultEnabled"
              :disabled="toggling"
              @change="toggleAdult"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- Setup on your device -->
      <div class="card" style="margin-top: 12px; cursor: pointer" @click="goSetup">
        <div class="card-row">
          <span class="card-label">Set up on your device</span>
          <span class="card-chevron">›</span>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.copy-block {
  background: var(--tg-secondary-bg);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.copy-block:active { opacity: 0.7; }
.copy-header { display: flex; justify-content: space-between; align-items: center; }
.copy-header-id { font-size: 13px; font-family: monospace; color: var(--tg-hint); }
.copy-badges { display: flex; align-items: center; }
.copy-divider { height: 1px; background: var(--tg-hint); opacity: 0.2; margin: 12px 0; }
.copy-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; }
.copy-label { font-size: 13px; color: var(--tg-hint); }
.copy-value { font-family: monospace; font-size: 14px; font-weight: 600; color: var(--tg-text); }
.copy-footer { text-align: center; margin-top: 10px; }
.copy-hint { font-size: 12px; color: var(--tg-link); font-weight: 500; }
.btn-edit {
  background: none; border: none; color: var(--tg-link);
  font-size: 13px; font-weight: 500; cursor: pointer; padding: 4px 12px;
}
.edit-inline {
  text-align: right; border: none; border-bottom: 1px solid var(--tg-link);
  background: none; color: var(--tg-text); font-size: 13px; line-height: 1;
  padding: 0 0 1px 0; margin: 0 0 0 12px; outline: none; min-width: 0; flex: 1; height: auto;
}
.edit-inline::placeholder { color: var(--tg-hint); }
.card-chevron {
  color: var(--tg-hint);
  font-size: 22px;
  line-height: 1;
  font-weight: 400;
}
.btn-inline {
  background: none; border: none; font-size: 13px; font-weight: 500; cursor: pointer; padding: 4px 0;
}
.btn-inline:disabled { opacity: 0.4; cursor: default; }
.btn-inline-cancel { color: var(--tg-hint); }
.toggle { position: relative; display: inline-block; width: 48px; height: 28px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; inset: 0; background: var(--tg-hint);
  border-radius: 28px; transition: background 0.2s; cursor: pointer;
}
.toggle-slider::before {
  content: ""; position: absolute; width: 22px; height: 22px;
  left: 3px; bottom: 3px; background: white; border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .toggle-slider { background: var(--tg-btn); }
.toggle input:checked + .toggle-slider::before { transform: translateX(20px); }
.toggle input:disabled + .toggle-slider { opacity: 0.5; cursor: default; }
</style>
