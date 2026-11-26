<script setup lang="ts">
import { ref, computed } from "vue";
import { HelpCircle } from "lucide-vue-next";
import { api, type AdminUserPayments } from "../composables/useApi";

/** One reseller's full payment ledger, paged server-side (10 per page). */
const props = defineProps<{ id: string }>();
const tg = window.Telegram.WebApp;

const PER_PAGE = 10;
const payments = ref<AdminUserPayments | null>(null);
const page = ref(1);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    payments.value = await api.adminGetUserPayments(Number(props.id), page.value, PER_PAGE);
    // The API clamps the page to the real range; follow it so the pager
    // doesn't sit on a number that no longer exists.
    page.value = payments.value.page;
  } catch (e: any) {
    error.value = e.message || "Failed to load payments";
  } finally {
    loading.value = false;
  }
}
load();

function setPage(p: number) {
  const last = payments.value?.totalPages ?? 1;
  const next = Math.max(1, Math.min(p, last));
  if (next === page.value) return;
  page.value = next;
  tg.HapticFeedback.selectionChanged();
  load();
}

const title = computed(() => payments.value?.owner?.label || `user ${props.id}`);

function formatStamp(str: string | null | undefined): string {
  if (!str) return "";
  // SQLite datetime('now') is UTC without a zone marker
  const d = new Date(str.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return String(str);
  return (
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}
</script>

<template>
  <div class="page">
    <div style="font-size: 13px; color: var(--tg-hint); margin-bottom: 12px">
      Payments of <b style="color: var(--tg-text)">{{ title }}</b>
    </div>

    <div class="section-header" style="display: flex; justify-content: space-between; align-items: baseline">
      <span>Payments<template v-if="payments"> ({{ payments.total }})</template></span>
      <span v-if="payments && payments.settledCredits > 0" class="settled-total">
        {{ payments.settledCredits }} credits settled
      </span>
    </div>

    <div v-if="error" class="empty-state">
      <HelpCircle class="icon-svg" />
      <p>{{ error }}</p>
    </div>

    <template v-else-if="!payments && loading">
      <div class="section">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </template>

    <div v-else-if="payments && payments.total === 0" class="card">
      <div class="card-row">
        <span class="card-value" style="font-size: 13px; color: var(--tg-hint)">No payments yet.</span>
      </div>
    </div>

    <template v-else-if="payments">
      <div :class="{ 'payments-busy': loading }">
        <div v-for="p in payments.payments" :key="p.btcpay_invoice_id" class="card">
          <div class="card-row">
            <div style="min-width: 0; flex: 1">
              <div style="font-weight: 600; font-size: 14px">{{ p.item_title }}</div>
              <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
                {{ p.amount }} {{ p.currency }} · {{ p.credits }} credits
              </div>
              <div style="font-size: 11px; color: var(--tg-hint); margin-top: 2px">
                {{ formatStamp(p.created_at) }} · <span style="font-family: monospace">{{ p.btcpay_invoice_id }}</span>
              </div>
            </div>
            <span class="status-pill" :class="p.status">{{ p.status }}</span>
          </div>
        </div>
      </div>

      <div v-if="payments.totalPages > 1" class="pagination">
        <button class="page-btn" :disabled="page <= 1" @click="setPage(page - 1)">&laquo;</button>
        <span class="page-info">{{ payments.page }} / {{ payments.totalPages }}</span>
        <button class="page-btn" :disabled="page >= payments.totalPages" @click="setPage(page + 1)">&raquo;</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.settled-total {
  font-size: 12px;
  font-weight: 400;
  color: var(--tg-hint);
}
/* Dim the current page while the next one is in flight, so the pager
   stays put instead of collapsing to a spinner and back */
.payments-busy {
  opacity: 0.5;
  transition: opacity 0.15s;
}
.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: 8px;
  text-transform: capitalize;
}
.status-pill.settled { background: #1b4332; color: #52c41a; }
.status-pill.pending,
.status-pill.processing,
.status-pill.settling { background: #3b2e00; color: #faad14; }
.status-pill.expired,
.status-pill.failed,
.status-pill.invalid { background: #3b1111; color: #ff4d4f; }
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 12px;
  padding: 8px 0;
}
.page-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: none;
  background: var(--tg-btn);
  color: var(--tg-btn-text);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}
.page-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.page-info {
  font-size: 14px;
  color: var(--tg-hint);
}
</style>
