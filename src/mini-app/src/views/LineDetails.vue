<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { HelpCircle, AlertTriangle, Trash2 } from "lucide-vue-next";
import { api, useAsync } from "../composables/useApi";
import { useStore } from "../composables/useStore";
import { useLoading } from "../composables/useLoading";

const props = defineProps<{ id: string }>();
const router = useRouter();
const tg = window.Telegram.WebApp;
const loading_ = useLoading();

const { user, loadUser, invalidateSubs } = useStore();
loadUser();

const { data: line, loading } = useAsync(() => api.getLine(props.id));
const maxConns = computed(() => user.value?.config?.maxConnections ?? 3);

const toggling = ref(false);
const togglingEnabled = ref(false);
const claimCopied = ref(false);

async function copyClaimCommand() {
  if (!line.value) return;
  try {
    await navigator.clipboard.writeText(`/link ${line.value.id}`);
    claimCopied.value = true;
    tg.HapticFeedback.notificationOccurred("success");
    setTimeout(() => { claimCopied.value = false; }, 2000);
  } catch {
    tg.HapticFeedback.notificationOccurred("error");
  }
}

// Linked customers
type Claim = { telegram_id: number; username: string | null; first_name: string | null; created_at: string };
const claims = ref<Claim[]>([]);
const claimsLoading = ref(false);
const unclaiming = ref<number | null>(null);

async function loadClaims() {
  if (!user.value?.canShareWithCustomers || !line.value) return;
  claimsLoading.value = true;
  try {
    claims.value = await api.getLineClaims(line.value.id);
  } catch {
    claims.value = [];
  } finally {
    claimsLoading.value = false;
  }
}

function claimLabel(c: Claim): string {
  // @username matches the support-topic title, easiest to identify at a glance
  if (c.username) return `@${c.username}`;
  if (c.first_name) return c.first_name;
  return `ID ${c.telegram_id}`;
}

watch([line, () => user.value?.canShareWithCustomers], () => loadClaims());

async function unclaim(c: Claim) {
  if (!line.value) return;
  const confirmed = await new Promise<boolean>((resolve) => {
    tg.showConfirm(
      `Unlink ${claimLabel(c)} from this line? They'll lose access in their dashboard.`,
      (ok: boolean) => resolve(ok)
    );
  });
  if (!confirmed) return;

  unclaiming.value = c.telegram_id;
  try {
    await api.unclaimCustomer(line.value.id, c.telegram_id);
    claims.value = claims.value.filter((x) => x.telegram_id !== c.telegram_id);
    tg.HapticFeedback.notificationOccurred("success");
  } catch (e: any) {
    tg.showAlert(e.message || "Failed to unlink.");
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    unclaiming.value = null;
  }
}

// Delete modal
const showDeleteModal = ref(false);
const deleteCountdown = ref(0);
let deleteTimer: ReturnType<typeof setInterval> | null = null;

const isExpired = computed(() => {
  if (!line.value) return false;
  return line.value.daysLeft !== null && line.value.daysLeft <= 0;
});

function openDeleteModal() {
  showDeleteModal.value = true;
  if (isExpired.value) {
    deleteCountdown.value = 0;
  } else {
    deleteCountdown.value = 10;
    deleteTimer = setInterval(() => {
      deleteCountdown.value--;
      if (deleteCountdown.value <= 0 && deleteTimer) {
        clearInterval(deleteTimer);
        deleteTimer = null;
      }
    }, 1000);
  }
}

function closeDeleteModal() {
  showDeleteModal.value = false;
  if (deleteTimer) {
    clearInterval(deleteTimer);
    deleteTimer = null;
  }
}

async function confirmDelete() {
  if (!line.value) return;
  closeDeleteModal();
  loading_.show("Deleting line...");
  try {
    await api.deleteLine(line.value.id);
    invalidateSubs();
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("success");
    tg.showAlert("Line deleted.", () => {
      router.replace("/");
    });
  } catch (e: any) {
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Failed to delete line");
  }
}

async function toggleEnabled() {
  if (!line.value || togglingEnabled.value) return;
  const newState = line.value.status !== "active";
  togglingEnabled.value = true;
  try {
    await api.toggleEnabled(line.value.id, newState);
    line.value.status = newState ? "active" : "disabled";
    invalidateSubs();
    tg.HapticFeedback.notificationOccurred(newState ? "success" : "warning");
  } catch (e: any) {
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    togglingEnabled.value = false;
  }
}
const copied = ref(false);
const editing = ref(false);
const saving = ref(false);
const editContact = ref("");
const editNotes = ref("");

function startEditing() {
  editContact.value = line.value?.contact || "";
  editNotes.value = line.value?.resellerNotes || "";
  editing.value = true;
}

async function saveInfo() {
  if (!line.value || saving.value) return;
  saving.value = true;
  try {
    await api.updateLineInfo(line.value.id, {
      contact: editContact.value,
      resellerNotes: editNotes.value,
    });
    line.value.contact = editContact.value || null;
    line.value.resellerNotes = editNotes.value || null;
    editing.value = false;
    invalidateSubs();
    tg.HapticFeedback.notificationOccurred("success");
  } catch (e: any) {
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    saving.value = false;
  }
}

const copyText = computed(() => {
  if (!line.value) return "";
  const l = line.value;
  return [
    `Username: ${l.username}`,
    `Password: ${l.password || "N/A"}`,
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
    invalidateSubs();
    tg.HapticFeedback.notificationOccurred(newState ? "success" : "warning");
  } catch (e: any) {
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
      <!-- Hero copy block -->
      <div class="copy-block" @click="copyDetails">
        <div class="copy-header">
          <div class="copy-header-id">#{{ line.id }}</div>
          <div class="copy-badges">
            <span class="status-badge" :class="statusClass(line)">{{ statusLabel(line) }}</span>
            <span v-if="line.isTrial" class="status-badge" style="margin-left: 4px; background: var(--tg-hint); color: white">Trial</span>
          </div>
        </div>
        <div class="copy-divider"></div>
        <div class="copy-row">
          <span class="copy-label">Username</span>
          <span class="copy-value">{{ line.username }}</span>
        </div>
        <div v-if="line.password" class="copy-row">
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

      <!-- Info -->
      <div class="card" style="margin-top: 12px">
        <div v-if="line.lastIp" class="card-row">
          <span class="card-label">Last IP</span>
          <span class="card-value" style="font-family: monospace; font-size: 13px">{{ line.lastIp }}</span>
        </div>

        <template v-if="!editing">
          <div class="card-row">
            <span class="card-label">Contact</span>
            <span class="card-value" style="font-size: 13px">{{ line.contact || '—' }}</span>
          </div>
          <div class="card-row">
            <span class="card-label">Notes</span>
            <span class="card-value" style="font-size: 13px">{{ line.resellerNotes || '—' }}</span>
          </div>
          <div class="card-row" style="margin-top: 4px">
            <span></span>
            <button class="btn-edit" @click="startEditing">Edit</button>
          </div>
        </template>

        <template v-else>
          <div class="card-row">
            <span class="card-label">Contact</span>
            <input v-model="editContact" type="text" class="edit-inline" placeholder="—" />
          </div>
          <div class="card-row">
            <span class="card-label">Notes</span>
            <input v-model="editNotes" type="text" class="edit-inline" placeholder="—" />
          </div>
          <div class="card-row" style="margin-top: 4px">
            <button class="btn-inline btn-inline-cancel" @click="editing = false" :disabled="saving">Cancel</button>
            <button class="btn-edit" @click="saveInfo" :disabled="saving">
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </template>
      </div>

      <!-- Toggles -->
      <div class="card" style="margin-top: 12px">
        <div class="card-row" style="cursor: pointer" @click="toggleEnabled">
          <div>
            <span class="card-label">Line Enabled</span>
            <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
              {{ line.status === 'active' ? 'Active' : 'Disabled' }}
            </div>
          </div>
          <label class="toggle" @click.stop>
            <input
              type="checkbox"
              :checked="line.status === 'active'"
              :disabled="togglingEnabled"
              @change="toggleEnabled"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div v-if="user?.permissions?.canToggleAdult !== false" class="card-row" style="cursor: pointer" @click="toggleAdult">
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

      <!-- Send to customer + linked list -->
      <div v-if="user?.canShareWithCustomers" class="card" style="margin-top: 12px">
        <div class="card-row" style="cursor: pointer" @click="copyClaimCommand">
          <span class="card-label">Send to customer</span>
          <span class="btn-edit">{{ claimCopied ? 'Copied!' : 'Copy' }}</span>
        </div>
        <div class="card-row" v-for="c in claims" :key="c.telegram_id">
          <span class="card-label">{{ claimLabel(c) }}</span>
          <button
            class="btn-unlink"
            :disabled="unclaiming === c.telegram_id"
            @click="unclaim(c)"
          >
            {{ unclaiming === c.telegram_id ? 'Unlinking…' : 'Unlink' }}
          </button>
        </div>
      </div>

      <div style="margin-top: 16px; display: flex; gap: 8px">
        <button
          v-if="line.expDate !== null"
          class="btn btn-secondary"
          style="flex: 1"
          @click="router.push(`/extend/${line.id}`)"
        >
          Extend
        </button>
        <button
          v-if="parseInt(line.maxConnections) < maxConns"
          class="btn btn-secondary"
          style="flex: 1"
          @click="router.push(`/connections/${line.id}`)"
        >
          + Connections
        </button>
      </div>

      <button v-if="user?.permissions?.canDeleteLine !== false" class="btn-delete" @click="openDeleteModal">
        Delete Line
      </button>
    </template>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <div v-if="showDeleteModal" class="modal-overlay" @click.self="closeDeleteModal">
        <div class="modal">
          <component :is="isExpired ? Trash2 : AlertTriangle" class="modal-icon-svg" />
          <div class="modal-title">{{ isExpired ? 'Delete Line' : 'Delete Active Line' }}</div>
          <div class="modal-body">
            <template v-if="isExpired">
              Delete line <strong>{{ line?.username }}</strong>? This cannot be undone.
            </template>
            <template v-else>
              This line is still <strong>active</strong> with
              <strong>{{ line?.daysLeft }}</strong> days remaining.
              Deleting it cannot be undone.
            </template>
          </div>
          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" @click="closeDeleteModal">Cancel</button>
            <button
              class="modal-btn modal-btn-confirm"
              :disabled="deleteCountdown > 0"
              @click="confirmDelete"
            >
              {{ deleteCountdown > 0 ? `Delete (${deleteCountdown})` : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
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
.copy-block:active {
  opacity: 0.7;
}
.copy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.copy-header-id {
  font-size: 13px;
  font-family: monospace;
  color: var(--tg-hint);
}
.copy-badges {
  display: flex;
  align-items: center;
}
.copy-divider {
  height: 1px;
  background: var(--tg-hint);
  opacity: 0.2;
  margin: 12px 0;
}
.copy-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
}
.copy-label {
  font-size: 13px;
  color: var(--tg-hint);
}
.copy-value {
  font-family: monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--tg-text);
}
.copy-footer {
  text-align: center;
  margin-top: 10px;
}
.copy-hint {
  font-size: 12px;
  color: var(--tg-link);
  font-weight: 500;
}
.toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 28px;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--tg-hint);
  border-radius: 28px;
  transition: background 0.2s;
  cursor: pointer;
}
.toggle-slider::before {
  content: "";
  position: absolute;
  width: 22px;
  height: 22px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .toggle-slider {
  background: var(--tg-btn);
}
.toggle input:checked + .toggle-slider::before {
  transform: translateX(20px);
}
.toggle input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: default;
}
.btn-unlink {
  background: none;
  border: none;
  color: #ff3b30;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
}
.btn-unlink:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn-edit {
  background: none;
  border: none;
  color: var(--tg-link);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 12px;
}
.edit-inline {
  text-align: right;
  border: none;
  border-bottom: 1px solid var(--tg-link);
  background: none;
  color: var(--tg-text);
  font-size: 13px;
  line-height: 1;
  padding: 0 0 1px 0;
  margin: 0 0 0 12px;
  outline: none;
  min-width: 0;
  flex: 1;
  height: auto;
}
.edit-inline::placeholder {
  color: var(--tg-hint);
}
.btn-inline {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
}
.btn-inline:disabled {
  opacity: 0.4;
  cursor: default;
}
.share-link {
  font-size: 12px;
  color: var(--tg-link);
  margin-top: 2px;
  word-break: break-all;
  font-family: monospace;
}
.btn-inline-cancel {
  color: var(--tg-hint);
}
.btn-inline-save {
  color: var(--tg-link);
}
.btn-delete {
  display: inline;
  margin-top: auto;
  padding: 10px 12px 20px;
  align-self: center;
  background: none;
  border: none;
  color: var(--tg-destructive, #ff3b30);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.modal {
  background: var(--tg-bg);
  border-radius: 14px;
  padding: 24px 20px;
  width: 100%;
  max-width: 320px;
  text-align: center;
}
.modal-icon {
  font-size: 36px;
  margin-bottom: 12px;
}
.modal-icon-svg {
  width: 40px;
  height: 40px;
  margin: 0 auto 12px;
  display: block;
  stroke-width: 1.5;
  color: var(--tg-destructive, #ff3b30);
}
.modal-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--tg-text);
  margin-bottom: 8px;
}
.modal-body {
  font-size: 14px;
  color: var(--tg-hint);
  line-height: 1.5;
}
.modal-body strong {
  color: var(--tg-text);
}
.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
.modal-btn {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.modal-btn-cancel {
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
}
.modal-btn-confirm {
  background: var(--tg-destructive, #ff3b30);
  color: white;
}
.modal-btn-confirm:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
