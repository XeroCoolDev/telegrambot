<script lang="ts">
export default { name: "Dashboard" };
</script>

<script setup lang="ts">
import { computed, ref, onActivated } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "../composables/useStore";

const router = useRouter();
const tg = window.Telegram.WebApp;

const { user, subs, userLoading, subsLoading, loadUser, loadSubs } = useStore();
loadUser();
loadSubs();

// Re-fetch when returning to this page (keep-alive reactivation)
onActivated(() => {
  loadUser();
  loadSubs();
});

const loading = computed(() => userLoading.value || subsLoading.value);

const search = ref("");
const page = ref(1);
const perPage = 20;
const statusFilter = ref<"active" | "expiring" | "expired" | null>(null);

function getLineStatus(s: any): "active" | "expiring" | "expired" {
  if (s.status === "disabled") return "expired";
  if (s.daysLeft !== null && s.daysLeft <= 0) return "expired";
  if (s.daysLeft !== null && s.daysLeft <= 3) return "expiring";
  return "active";
}

function toggleFilter(filter: "active" | "expiring" | "expired") {
  statusFilter.value = statusFilter.value === filter ? null : filter;
  page.value = 1;
  tg.HapticFeedback.selectionChanged();
}

const filtered = computed(() => {
  if (!subs.value) return [];
  let result = subs.value as any[];

  if (statusFilter.value) {
    result = result.filter((s) => getLineStatus(s) === statusFilter.value);
  }

  const q = search.value.toLowerCase().trim();
  if (q) {
    result = result.filter(
      (s: any) => s.username?.toLowerCase().includes(q) || s.id?.toString().includes(q) || s.resellerNotes?.toLowerCase().includes(q)
    );
  }

  return result;
});

const stats = computed(() => {
  if (!subs.value) return { active: 0, expiring: 0, expired: 0, disabled: 0, total: 0 };
  let active = 0, expiring = 0, expired = 0, disabled = 0;
  for (const s of subs.value as any[]) {
    if (s.status === "disabled") disabled++;
    else if (s.daysLeft !== null && s.daysLeft <= 0) expired++;
    else if (s.daysLeft !== null && s.daysLeft <= 3) expiring++;
    else active++;
  }
  return { active, expiring, expired, disabled, total: subs.value.length };
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage)));
const paginated = computed(() => {
  const start = (page.value - 1) * perPage;
  return filtered.value.slice(start, start + perPage);
});

function setPage(p: number) {
  page.value = Math.max(1, Math.min(p, totalPages.value));
  tg.HapticFeedback.selectionChanged();
}

function statusDotClass(sub: any) {
  if (sub.status === "disabled") return "dot-red";
  if (sub.daysLeft !== null && sub.daysLeft <= 0) return "dot-red";
  if (sub.daysLeft !== null && sub.daysLeft <= 3) return "dot-orange";
  return "dot-green";
}

function tapLine(id: string) {
  tg.HapticFeedback.selectionChanged();
  router.push(`/line/${id}`);
}
</script>

<template>
  <div class="page">
    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="section">
        <div class="skeleton skeleton-line" style="width: 40%"></div>
        <div class="skeleton skeleton-line" style="width: 70%"></div>
      </div>
      <div class="section" v-for="i in 3" :key="i">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </template>

    <template v-else-if="!user || !user.linked">
      <div v-if="user?.isAdmin" style="margin-bottom: 16px">
        <button class="btn btn-secondary" @click="router.push('/admin')">Admin</button>
      </div>
      <div class="empty-state">
        <div class="icon">🔗</div>
        <p>Your account isn't linked yet.<br />Please contact an administrator to get started.</p>
      </div>
    </template>

    <template v-else-if="user">
      <!-- Stats -->
      <div class="stats-grid">
        <div class="stat-card stat-card-credits" @click="router.push('/buy')">
          <div class="stat-value">{{ user.credits }}</div>
          <div class="stat-label">Credits</div>
        </div>
        <div class="stat-card stat-card-filter" :class="{ 'stat-card-selected': statusFilter === 'active' }" @click="toggleFilter('active')">
          <div class="stat-value stat-active">{{ stats.active }}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card stat-card-filter" :class="{ 'stat-card-selected': statusFilter === 'expiring' }" @click="toggleFilter('expiring')">
          <div class="stat-value stat-expiring">{{ stats.expiring }}</div>
          <div class="stat-label">Expiring</div>
        </div>
        <div class="stat-card stat-card-filter" :class="{ 'stat-card-selected': statusFilter === 'expired' }" @click="toggleFilter('expired')">
          <div class="stat-value stat-expired">{{ stats.expired }}</div>
          <div class="stat-label">Expired</div>
        </div>
      </div>

      <!-- Actions -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px">
        <button v-if="user.permissions?.canBuyCredits !== false" class="btn btn-secondary" style="flex: 1" @click="router.push('/buy')">
          + Buy Credits
        </button>
        <button v-if="user.permissions?.canCreateLine !== false" class="btn btn-secondary" style="flex: 1" @click="router.push('/create')">
          + New Line
        </button>
        <button v-if="user.isAdmin" class="btn btn-secondary" style="flex: 1" @click="router.push('/admin')">
          Admin
        </button>
      </div>

      <!-- Subscriptions -->
      <div class="section-header" style="display: flex; justify-content: space-between; align-items: center">
        <span>Lines</span>
        <span style="font-size: 13px; font-weight: 400; color: var(--tg-hint)">{{ filtered.length }} of {{ subs?.length || 0 }}</span>
      </div>

      <!-- Search -->
      <input
        v-if="subs && subs.length > 0"
        v-model="search"
        type="search"
        placeholder="Search by username, ID or notes..."
        class="search-input"
        @input="page = 1"
        @click.stop
      />

      <div v-if="!subs || subs.length === 0" class="empty-state">
        <div class="icon">📡</div>
        <p>No active lines found.</p>
      </div>

      <div v-else-if="filtered.length === 0" class="empty-state">
        <div class="icon">🔍</div>
        <p>No lines match "{{ search }}"</p>
      </div>

      <div
        v-for="sub in paginated"
        :key="sub.id"
        class="card"
        @click="tapLine(sub.id)"
        style="cursor: pointer"
      >
        <div class="card-row">
          <div style="min-width: 0; flex: 1">
            <div style="font-weight: 600; font-size: 15px">{{ sub.username }}</div>
            <div style="font-size: 13px; color: var(--tg-hint); margin-top: 2px">
              {{ sub.expiresFormatted }} · {{ sub.maxConnections }} conn
            </div>
          </div>
          <div class="line-indicators">
            <span v-if="!sub.adultEnabled" class="badge-adult-off">18+</span>
            <span class="status-dot" :class="statusDotClass(sub)"></span>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination">
        <button class="page-btn" :disabled="page <= 1" @click="setPage(page - 1)">&laquo;</button>
        <span class="page-info">{{ page }} / {{ totalPages }}</span>
        <button class="page-btn" :disabled="page >= totalPages" @click="setPage(page + 1)">&raquo;</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.search-input {
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--tg-hint);
  border-radius: 10px;
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
.search-input::placeholder {
  color: var(--tg-hint);
}
.search-input:focus {
  border-color: var(--tg-link);
}
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
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
.stat-card {
  background: var(--tg-secondary-bg);
  border-radius: 10px;
  padding: 10px 8px;
  text-align: center;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
}
.stat-label {
  font-size: 11px;
  color: var(--tg-hint);
  margin-top: 2px;
}
.stat-active { color: #34c759; }
.stat-expiring { color: #ff9500; }
.stat-expired { color: #ff3b30; }
.line-indicators {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot-green { background: #34c759; }
.dot-orange { background: #ff9500; }
.dot-red { background: #ff3b30; }
.badge-adult-off {
  font-size: 10px;
  font-weight: 700;
  color: #ff3b30;
  background: var(--tg-secondary-bg);
  border: 1px solid #ff3b30;
  border-radius: 4px;
  padding: 1px 4px;
  line-height: 1.2;
  text-decoration: line-through;
}
.stat-card-filter {
  cursor: pointer;
  transition: opacity 0.15s;
}
.stat-card-filter:active {
  opacity: 0.7;
}
.stat-card-selected {
  outline: 2px solid var(--tg-link);
}
.stat-card-credits {
  cursor: pointer;
  position: relative;
}
.stat-card-credits .stat-value {
  color: var(--tg-link);
}
</style>
