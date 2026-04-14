<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { HelpCircle } from "lucide-vue-next";
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
