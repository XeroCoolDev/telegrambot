<script setup lang="ts">
import { ref, onActivated } from "vue";
import { useRouter } from "vue-router";
import { api, useAsync } from "../composables/useApi";

const router = useRouter();
const tg = window.Telegram.WebApp;

const tab = ref<"users" | "payments">("users");
const { data: users, refresh: refreshUsers } = useAsync(() => api.adminGetUsers());
onActivated(() => refreshUsers());
const { data: payments } = useAsync(() => api.adminGetPayments());

// Link form
const linkTgId = ref("");
const linkXuiId = ref("");
const linking = ref(false);
const linkResult = ref<string | null>(null);

async function linkUser() {
  if (!linkTgId.value || !linkXuiId.value || linking.value) return;
  linking.value = true;
  linkResult.value = null;
  try {
    const result = await api.adminLink(Number(linkTgId.value), linkXuiId.value);
    linkResult.value = `Linked to ${result.username}`;
    linkTgId.value = "";
    linkXuiId.value = "";
    refreshUsers();
    tg.HapticFeedback.notificationOccurred("success");
  } catch (e: any) {
    linkResult.value = e.message;
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    linking.value = false;
  }
}

function openUser(telegramId: number) {
  tg.HapticFeedback.selectionChanged();
  router.push(`/admin/user/${telegramId}`);
}

function shortDate(str: string | null | undefined): string {
  if (!str) return "";
  const d = new Date(str.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
</script>

<template>
  <div class="page">
    <div class="section-header">Admin</div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'users' }" @click="tab = 'users'">Users</button>
      <button class="tab" :class="{ active: tab === 'payments' }" @click="tab = 'payments'">Payments</button>
    </div>

    <!-- Users tab -->
    <template v-if="tab === 'users'">
      <!-- Link form -->
      <div class="card" style="margin-bottom: 12px">
        <div class="card-row">
          <span class="card-label">Link User</span>
        </div>
        <div style="padding: 0 16px 12px; display: flex; gap: 8px">
          <input v-model="linkTgId" type="text" class="admin-input" placeholder="Telegram ID" @click.stop />
          <input v-model="linkXuiId" type="text" class="admin-input" placeholder="XUI User ID" @click.stop />
          <button class="admin-btn" :disabled="linking" @click="linkUser">Link</button>
        </div>
        <div v-if="linkResult" style="padding: 0 16px 12px; font-size: 12px; color: var(--tg-hint)">{{ linkResult }}</div>
      </div>

      <div v-if="!users" class="empty-state"><p>Loading...</p></div>
      <div v-else>
        <div
          v-for="u in users"
          :key="u.telegram_id"
          class="card"
          style="cursor: pointer"
          @click="openUser(u.telegram_id)"
        >
          <div class="card-row">
            <div style="min-width: 0; flex: 1">
              <div style="font-weight: 600; font-size: 14px">{{ u.username || u.first_name || 'Unknown' }}</div>
              <div v-if="!u.xui_user_id" style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
                unlinked
              </div>
              <template v-else>
                <div class="panel-user">
                  {{ u.xui_username || `XUI #${u.xui_user_id}` }}
                </div>
                <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
                  {{ u.credits == null ? '— credits' : `${u.credits} credits` }}
                  <template v-if="u.lastTopUp"> · Last top: {{ u.lastTopUp.credits }} ({{ shortDate(u.lastTopUp.at) }})</template>
                  <template v-if="u.last_accessed"> · Active: {{ shortDate(u.last_accessed) }}</template>
                </div>
              </template>
            </div>
            <span style="font-size: 18px; color: var(--tg-hint)">›</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Payments tab -->
    <template v-if="tab === 'payments'">
      <div v-if="!payments" class="empty-state"><p>Loading...</p></div>
      <div v-else-if="payments.length === 0" class="empty-state"><p>No payments yet.</p></div>
      <div v-else>
        <div v-for="p in payments" :key="p.btcpay_invoice_id" class="card">
          <div class="card-row">
            <div style="min-width: 0; flex: 1">
              <div style="font-weight: 600; font-size: 14px">{{ p.item_title }}</div>
              <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
                {{ p.amount }} {{ p.currency }} · {{ p.credits }} credits · TG: {{ p.telegram_id }}
              </div>
              <div style="font-size: 11px; color: var(--tg-hint); margin-top: 2px">{{ p.created_at }}</div>
            </div>
            <span class="status-pill" :class="p.status">{{ p.status }}</span>
          </div>
        </div>
      </div>
    </template>

  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  background: var(--tg-secondary-bg);
  border-radius: 10px;
  padding: 3px;
}
.tab {
  flex: 1;
  padding: 8px;
  border: none;
  background: none;
  color: var(--tg-hint);
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
}
.tab.active {
  background: var(--tg-btn);
  color: var(--tg-btn-text);
}
.admin-input {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--tg-hint);
  border-radius: 8px;
  background: var(--tg-bg);
  color: var(--tg-text);
  font-size: 13px;
  outline: none;
  min-width: 0;
}
.admin-input:focus { border-color: var(--tg-link); }
.admin-input::placeholder { color: var(--tg-hint); }
.admin-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: var(--tg-btn);
  color: var(--tg-btn-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.admin-btn:disabled { opacity: 0.4; }
.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.panel-user {
  font-size: 12px;
  color: var(--tg-link);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-pill.settled { background: #1b4332; color: #52c41a; }
.status-pill.pending { background: #3b2e00; color: #faad14; }
.status-pill.expired { background: #3b1111; color: #ff4d4f; }
.status-pill.failed { background: #3b1111; color: #ff4d4f; }

</style>
