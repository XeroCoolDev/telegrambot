<script setup lang="ts">
import { ref, computed } from "vue";
import { HelpCircle } from "lucide-vue-next";
import { api, useAsync } from "../composables/useApi";

const props = defineProps<{ id: string }>();
const tg = window.Telegram.WebApp;

const { data: line, loading } = useAsync(() => api.getLine(props.id));

const toggling = ref(false);
const copied = ref(false);
const editingNotes = ref(false);
const editNotes = ref("");
const savingNotes = ref(false);

function startEditNotes() {
  editNotes.value = line.value?.notes || "";
  editingNotes.value = true;
}

async function saveNotes() {
  if (!line.value || savingNotes.value) return;
  savingNotes.value = true;
  try {
    await api.updateNotes(line.value.id, editNotes.value);
    line.value.notes = editNotes.value || null;
    editingNotes.value = false;
    tg.HapticFeedback.notificationOccurred("success");
  } catch {
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    savingNotes.value = false;
  }
}

const copyText = computed(() => {
  if (!line.value) return "";
  const l = line.value;
  const parts = [
    `Username: ${l.username}`,
    `Password: ${l.password}`,
  ];
  if (l.serverDns) parts.push(`Server: ${l.serverDns}`);
  parts.push(`Expires: ${l.expiresDateTime || l.expiresFormatted}`);
  parts.push(`Connections: ${l.maxConnections}`);
  return parts.join("\n");
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
        <div v-if="line.serverDns" class="copy-row">
          <span class="copy-label">Server</span>
          <span class="copy-value">{{ line.serverDns }}</span>
        </div>
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

      <!-- Notes -->
      <div class="card" style="margin-top: 12px">
        <template v-if="!editingNotes">
          <div class="card-row">
            <span class="card-label">My Notes</span>
            <span class="card-value" style="font-size: 13px">{{ line.notes || '—' }}</span>
          </div>
          <div class="card-row" style="margin-top: 4px">
            <span></span>
            <button class="btn-edit" @click="startEditNotes">Edit</button>
          </div>
        </template>
        <template v-else>
          <div class="card-row">
            <span class="card-label">My Notes</span>
            <input v-model="editNotes" type="text" class="edit-inline" placeholder="e.g. Living room TV" @click.stop />
          </div>
          <div class="card-row" style="margin-top: 4px">
            <button class="btn-inline btn-inline-cancel" @click="editingNotes = false" :disabled="savingNotes">Cancel</button>
            <button class="btn-edit" @click="saveNotes" :disabled="savingNotes">
              {{ savingNotes ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </template>
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
