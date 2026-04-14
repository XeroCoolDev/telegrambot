<script setup lang="ts">
import { ref } from "vue";
import { AlertTriangle } from "lucide-vue-next";
import { api, useAsync } from "../composables/useApi";

const tg = window.Telegram.WebApp;

const { data: options, loading, error } = useAsync(() => api.getCreditOptions());
const { data: pending, loading: pendingLoading, refresh: refreshPending } = useAsync(() => api.getPendingPayments());
const purchasing = ref<string | null>(null);

async function buyItem(item: any) {
  if (purchasing.value) return;
  purchasing.value = item.id;
  tg.HapticFeedback.impactOccurred("medium");

  try {
    const creditsMatch = item.title.match(/(\d+)/);
    const credits = creditsMatch ? parseInt(creditsMatch[1], 10) : 0;

    const result = await api.buyCredits({ ...item, credits });
    refreshPending();
    tg.openLink(result.checkoutUrl);
  } catch (e: any) {
    tg.showAlert(e.message || "Failed to create invoice");
  } finally {
    purchasing.value = null;
  }
}

function openInvoice(url: string) {
  tg.HapticFeedback.impactOccurred("light");
  tg.openLink(url);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + "Z").getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
</script>

<template>
  <div class="page">
    <div class="section-header">Buy Credits</div>

    <template v-if="loading">
      <div class="section" v-for="i in 3" :key="i">
        <div class="skeleton skeleton-line" style="width: 60%"></div>
        <div class="skeleton skeleton-line" style="width: 40%"></div>
      </div>
    </template>

    <template v-else-if="error">
      <div class="empty-state">
        <AlertTriangle class="icon-svg" />
        <p>{{ error }}</p>
      </div>
    </template>

    <template v-else-if="options">
      <div
        v-for="item in options.items"
        :key="item.id"
        class="card"
        @click="buyItem(item)"
        style="cursor: pointer"
      >
        <div class="card-row">
          <div>
            <div style="font-weight: 600; font-size: 15px">{{ item.title }}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px">
            <span v-if="purchasing === item.id" style="font-size: 13px; color: var(--tg-hint)">
              Creating...
            </span>
            <span style="font-weight: 700; font-size: 16px; color: var(--tg-link)">
              {{ item.price }} {{ options.currency }}
            </span>
          </div>
        </div>
      </div>

      <p style="text-align: center; font-size: 12px; color: var(--tg-hint); margin-top: 16px; padding: 0 16px; line-height: 1.5">
        Payments are processed via BTCPay. Credits will be added automatically once payment is confirmed.
      </p>
    </template>

    <!-- Pending invoices -->
    <template v-if="pending && pending.length > 0">
      <div class="section-header" style="margin-top: 16px">Pending Payments</div>
      <div
        v-for="p in pending"
        :key="p.invoiceId"
        class="card pending-card"
        @click="openInvoice(p.checkoutUrl)"
        style="cursor: pointer"
      >
        <div class="card-row">
          <div>
            <div style="font-weight: 600; font-size: 15px">{{ p.title }}</div>
            <div style="font-size: 12px; color: var(--tg-hint); margin-top: 2px">
              {{ timeAgo(p.createdAt) }} · {{ p.amount }} {{ p.currency }}
            </div>
          </div>
          <span class="pending-badge">Continue</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pending-card {
  border-left: 3px solid var(--tg-link);
}
.pending-badge {
  font-size: 13px;
  font-weight: 600;
  color: var(--tg-link);
  white-space: nowrap;
}
</style>
