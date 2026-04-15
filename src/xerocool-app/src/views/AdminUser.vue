<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { HelpCircle, Eye, EyeOff } from "lucide-vue-next";
import { api, useAsync, type Permissions } from "../composables/useApi";

const props = defineProps<{ id: string }>();
const router = useRouter();
const tg = window.Telegram.WebApp;

const { data: users, loading } = useAsync(() => api.adminGetUsers());
const user = computed(() => users.value?.find((u: any) => String(u.telegram_id) === String(props.id)));
const permissions = ref<Permissions | null>(null);
const saving = ref(false);

watch(user, (u) => {
  if (u && !permissions.value) {
    permissions.value = { ...u.permissions };
  }
}, { immediate: true });

const permGroups: { title: string; items: { key: keyof Permissions; label: string; description: string }[] }[] = [
  {
    title: "Lines",
    items: [
      { key: "canCreateLine", label: "Create lines", description: "Allow this user to create new subscriptions" },
      { key: "canDeleteLine", label: "Delete lines", description: "Allow this user to permanently delete lines" },
    ],
  },
  {
    title: "Credits",
    items: [
      { key: "canBuyCredits", label: "Buy credits", description: "Allow this user to purchase credits via BTCPay" },
    ],
  },
  {
    title: "Content",
    items: [
      { key: "canToggleAdult", label: "Toggle adult content", description: "Allow this user to enable/disable adult bouquets" },
    ],
  },
];

async function savePermissions() {
  if (!user.value || !permissions.value || saving.value) return;
  saving.value = true;
  try {
    await api.adminSetPermissions(user.value.telegram_id, permissions.value);
    tg.HapticFeedback.notificationOccurred("success");
    router.back();
  } catch (e: any) {
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Failed to save");
  } finally {
    saving.value = false;
  }
}

// API key editing
const showApiKey = ref(false);
const editingApiKey = ref(false);
const apiKeyDraft = ref("");
const savingApiKey = ref(false);

function startEditApiKey() {
  apiKeyDraft.value = user.value?.xui_api_key || "";
  editingApiKey.value = true;
}
async function saveApiKey() {
  if (!user.value || savingApiKey.value) return;
  savingApiKey.value = true;
  try {
    await api.adminSetApiKey(user.value.telegram_id, apiKeyDraft.value.trim());
    if (users.value) {
      const row = users.value.find((u: any) => u.telegram_id === user.value!.telegram_id);
      if (row) row.xui_api_key = apiKeyDraft.value.trim();
    }
    editingApiKey.value = false;
    tg.HapticFeedback.notificationOccurred("success");
  } catch (e: any) {
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Failed to save api_key");
  } finally {
    savingApiKey.value = false;
  }
}

async function unlinkUser() {
  if (!user.value) return;
  tg.showConfirm(`Unlink user ${user.value.username || user.value.telegram_id}?`, async (ok) => {
    if (!ok) return;
    try {
      await api.adminUnlink(user.value.telegram_id);
      tg.HapticFeedback.notificationOccurred("success");
      router.back();
    } catch {
      tg.HapticFeedback.notificationOccurred("error");
    }
  });
}
</script>

<template>
  <div class="page">
    <template v-if="loading">
      <div class="section">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </template>

    <template v-else-if="!user">
      <div class="empty-state">
        <HelpCircle class="icon-svg" />
        <p>User not found.</p>
      </div>
    </template>

    <template v-else>
      <!-- User info -->
      <div class="card">
        <div class="card-row">
          <span class="card-label">Name</span>
          <span class="card-value">{{ user.username || user.first_name || "Unknown" }}</span>
        </div>
        <div class="card-row">
          <span class="card-label">Telegram ID</span>
          <span class="card-value" style="font-family: monospace; font-size: 13px">{{ user.telegram_id }}</span>
        </div>
        <div class="card-row">
          <span class="card-label">XUI User ID</span>
          <span class="card-value" style="font-family: monospace; font-size: 13px">{{ user.xui_user_id || "unlinked" }}</span>
        </div>
        <div class="card-row" v-if="user.xui_user_id && !editingApiKey">
          <span class="card-label">API Key</span>
          <span style="display: flex; align-items: center; gap: 6px; min-width: 0">
            <span class="card-value" style="font-family: monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; max-width: 160px">
              {{ user.xui_api_key ? (showApiKey ? user.xui_api_key : '•'.repeat(Math.min(user.xui_api_key.length, 12))) : 'not set' }}
            </span>
            <button
              v-if="user.xui_api_key"
              class="icon-btn"
              @click="showApiKey = !showApiKey"
              :title="showApiKey ? 'Hide' : 'Show'"
            >
              <component :is="showApiKey ? EyeOff : Eye" :size="16" />
            </button>
            <button class="btn-edit" @click="startEditApiKey">Edit</button>
          </span>
        </div>
        <div class="card-row" v-if="user.xui_user_id && editingApiKey">
          <span class="card-label">API Key</span>
          <input v-model="apiKeyDraft" type="text" class="edit-inline" placeholder="Paste XUI api_key" />
        </div>
        <div class="card-row" v-if="editingApiKey" style="margin-top: 4px">
          <button class="btn-inline btn-inline-cancel" @click="editingApiKey = false" :disabled="savingApiKey">Cancel</button>
          <button class="btn-edit" @click="saveApiKey" :disabled="savingApiKey || !apiKeyDraft.trim()">
            {{ savingApiKey ? 'Saving...' : 'Save' }}
          </button>
        </div>
        <div class="card-row">
          <span class="card-label">Joined</span>
          <span class="card-value" style="font-size: 13px">{{ user.created_at }}</span>
        </div>
      </div>

      <!-- Permissions -->
      <div v-if="permissions" v-for="group in permGroups" :key="group.title">
        <div class="section-header" style="margin-top: 16px">{{ group.title }}</div>
        <div class="card">
          <div v-for="item in group.items" :key="item.key" class="card-row perm-item">
            <div style="flex: 1; min-width: 0">
              <div style="font-size: 14px; font-weight: 500">{{ item.label }}</div>
              <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">{{ item.description }}</div>
            </div>
            <label class="toggle">
              <input type="checkbox" v-model="permissions[item.key]" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div style="margin-top: 16px; display: flex; gap: 8px">
        <button class="btn btn-primary" style="flex: 1" :disabled="saving" @click="savePermissions">
          {{ saving ? "Saving..." : "Save" }}
        </button>
      </div>

      <button v-if="user.xui_user_id" class="btn-danger-link" @click="unlinkUser">
        Unlink Account
      </button>
    </template>
  </div>
</template>

<style scoped>
.perm-item {
  align-items: flex-start;
  padding: 14px 16px;
}
.btn-edit {
  background: none;
  border: none;
  color: var(--tg-link);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
}
.btn-edit:disabled { opacity: 0.4; cursor: default; }
.btn-inline {
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
}
.btn-inline:disabled { opacity: 0.4; cursor: default; }
.btn-inline-cancel { color: var(--tg-hint); }
.icon-btn {
  background: none;
  border: none;
  color: var(--tg-hint);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  align-items: center;
}
.edit-inline {
  flex: 1;
  min-width: 0;
  text-align: right;
  border: none;
  border-bottom: 1px solid var(--tg-link);
  background: none;
  color: var(--tg-text);
  font-size: 13px;
  font-family: monospace;
  outline: none;
  padding: 0 0 1px 0;
  margin-left: 12px;
}
.edit-inline::placeholder { color: var(--tg-hint); }
.toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 28px;
  flex-shrink: 0;
  margin-left: 12px;
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
.btn-danger-link {
  display: block;
  margin: 20px auto 0;
  padding: 10px 16px;
  background: none;
  border: none;
  color: var(--tg-destructive, #ff3b30);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
</style>
