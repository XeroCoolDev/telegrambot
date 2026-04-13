<script setup lang="ts">
import { ref } from "vue";
import { api, useAsync } from "../composables/useApi";

const tg = window.Telegram.WebApp;

const tab = ref<"users" | "payments" | "customers">("users");
const { data: users, refresh: refreshUsers } = useAsync(() => api.adminGetUsers());
const { data: payments } = useAsync(() => api.adminGetPayments());
const { data: customers } = useAsync(() => api.adminGetCustomers());
const { data: customerLines } = useAsync(() => api.adminGetCustomerLines());

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

async function unlinkUser(telegramId: number) {
  tg.showConfirm(`Unlink user ${telegramId}?`, async (ok) => {
    if (!ok) return;
    try {
      await api.adminUnlink(telegramId);
      refreshUsers();
      tg.HapticFeedback.notificationOccurred("success");
    } catch {
      tg.HapticFeedback.notificationOccurred("error");
    }
  });
}

// Expanded permission editor
const expandedUser = ref<number | null>(null);

async function togglePerm(user: any, key: string) {
  const newPerms = { ...user.permissions, [key]: !user.permissions[key] };
  user.permissions = newPerms;
  try {
    await api.adminSetPermissions(user.telegram_id, newPerms);
    tg.HapticFeedback.notificationOccurred("success");
  } catch {
    tg.HapticFeedback.notificationOccurred("error");
    refreshUsers();
  }
}

const permLabels: Record<string, string> = {
  canCreateLine: "Create lines",
  canDeleteLine: "Delete lines",
  canBuyCredits: "Buy credits",
  canToggleAdult: "Toggle adult",
  canShareWithCustomers: "Share with customers",
};
</script>

<template>
  <div class="page">
    <div class="section-header">Admin</div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'users' }" @click="tab = 'users'">Users</button>
      <button class="tab" :class="{ active: tab === 'payments' }" @click="tab = 'payments'">Payments</button>
      <button class="tab" :class="{ active: tab === 'customers' }" @click="tab = 'customers'">Customers</button>
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
        >
          <div class="card-row" style="cursor: pointer" @click="expandedUser = expandedUser === u.telegram_id ? null : u.telegram_id">
            <div style="min-width: 0; flex: 1">
              <div style="font-weight: 600; font-size: 14px">{{ u.username || u.first_name || 'Unknown' }}</div>
              <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
                TG: {{ u.telegram_id }} · XUI: {{ u.xui_user_id || 'unlinked' }}
              </div>
            </div>
            <button v-if="u.xui_user_id" class="unlink-btn" @click.stop="unlinkUser(u.telegram_id)">Unlink</button>
          </div>

          <!-- Permissions (expanded) -->
          <div v-if="expandedUser === u.telegram_id" class="perms-panel">
            <div v-for="(label, key) in permLabels" :key="key" class="perm-row" @click="togglePerm(u, key)">
              <span class="perm-label">{{ label }}</span>
              <label class="toggle-mini" @click.stop>
                <input type="checkbox" :checked="u.permissions[key]" @change="togglePerm(u, key)" />
                <span class="toggle-mini-slider"></span>
              </label>
            </div>
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

    <!-- Customers tab -->
    <template v-if="tab === 'customers'">
      <div v-if="!customers" class="empty-state"><p>Loading...</p></div>
      <div v-else-if="customers.length === 0" class="empty-state"><p>No customers yet.</p></div>
      <div v-else>
        <div v-for="c in customers" :key="c.telegram_id" class="card">
          <div class="card-row">
            <div>
              <div style="font-weight: 600; font-size: 14px">{{ c.username || c.first_name || 'Unknown' }}</div>
              <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">TG: {{ c.telegram_id }}</div>
            </div>
            <span style="font-size: 12px; color: var(--tg-hint)">{{ c.created_at }}</span>
          </div>
        </div>

        <div v-if="customerLines && customerLines.length > 0" style="margin-top: 16px">
          <div class="section-header">Customer Lines</div>
          <div v-for="cl in customerLines" :key="cl.xui_line_id" class="card">
            <div class="card-row">
              <div>
                <div style="font-weight: 600; font-size: 14px">Line {{ cl.xui_line_id }}</div>
                <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
                  Customer: {{ cl.customer_username || cl.customer_telegram_id || 'unlinked' }} · Reseller: {{ cl.reseller_xui_user_id }}
                </div>
              </div>
            </div>
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
.unlink-btn {
  background: none;
  border: none;
  color: var(--tg-destructive, #ff3b30);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
}
.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.status-pill.settled { background: #1b4332; color: #52c41a; }
.status-pill.pending { background: #3b2e00; color: #faad14; }
.status-pill.expired { background: #3b1111; color: #ff4d4f; }
.status-pill.failed { background: #3b1111; color: #ff4d4f; }

.perms-panel {
  padding: 4px 16px 12px;
  border-top: 1px solid var(--tg-secondary-bg);
}
.perm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  cursor: pointer;
}
.perm-label {
  font-size: 13px;
  color: var(--tg-text);
}
.toggle-mini {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}
.toggle-mini input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-mini-slider {
  position: absolute;
  inset: 0;
  background: var(--tg-hint);
  border-radius: 20px;
  transition: background 0.2s;
  cursor: pointer;
}
.toggle-mini-slider::before {
  content: "";
  position: absolute;
  width: 14px;
  height: 14px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle-mini input:checked + .toggle-mini-slider {
  background: var(--tg-btn);
}
.toggle-mini input:checked + .toggle-mini-slider::before {
  transform: translateX(16px);
}
</style>
