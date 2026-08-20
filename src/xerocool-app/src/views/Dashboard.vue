<script lang="ts">
export default { name: "Dashboard" };
</script>

<script setup lang="ts">
import { computed, ref, onActivated, watch } from "vue";
import { useRouter } from "vue-router";
import { Link2Off, Satellite, SearchX } from "lucide-vue-next";
import { useStore } from "../composables/useStore";

const router = useRouter();
const tg = window.Telegram.WebApp;

const {
  user,
  subs,
  allSubs,
  userLoading,
  subsLoading,
  allSubsLoading,
  allSubsError,
  loadUser,
  loadSubs,
  loadAllSubs,
} = useStore();
loadUser();
loadSubs();

const loading = computed(() => userLoading.value || subsLoading.value);

const search = ref("");
const page = ref(1);
const perPage = 20;
const statusFilter = ref<"active" | "expiring" | "expired" | "disabled" | null>(null);

// ── Admin scope: own lines vs every linked reseller's lines ──
const scope = ref<"mine" | "all">("mine");
const ownerFilter = ref<string | null>(null);

function setScope(next: "mine" | "all") {
  if (scope.value === next) return;
  scope.value = next;
  ownerFilter.value = null;
  page.value = 1;
  tg.HapticFeedback.selectionChanged();
  if (next === "all") loadAllSubs();
}

// Reset paging whenever the owner filter moves
watch(ownerFilter, () => { page.value = 1; });

// An admin with no reseller account of their own has no "my lines" to show,
// so drop them straight into the all-lines view — that's their whole dashboard.
watch(
  user,
  (u) => {
    if (u?.isAdmin && !u.linked && scope.value !== "all") {
      scope.value = "all";
      loadAllSubs();
    }
  },
  { immediate: true }
);

// Re-fetch when returning to this page (keep-alive reactivation)
onActivated(() => {
  loadUser();
  loadSubs();
  if (scope.value === "all") loadAllSubs();
});

/** The list the page is currently working from, before any filtering. */
const scopedSubs = computed<any[] | null>(() =>
  scope.value === "all" ? (allSubs.value as any[] | null) : (subs.value as any[] | null)
);

/** Distinct owners in the all-lines set, for the filter dropdown. */
const owners = computed(() => {
  if (scope.value !== "all" || !allSubs.value) return [];
  const byId = new Map<string, { id: string; label: string; count: number }>();
  for (const s of allSubs.value as any[]) {
    const id = String(s.ownerXuiUserId);
    const existing = byId.get(id);
    if (existing) {
      existing.count++;
    } else {
      byId.set(id, {
        id,
        label: s.ownerName || s.ownerXuiUsername || `XUI member ${id}`,
        count: 1,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

/** Owner filter applied — stats and the list both work from here. */
const ownerScoped = computed<any[]>(() => {
  const list = scopedSubs.value;
  if (!list) return [];
  if (scope.value !== "all" || !ownerFilter.value) return list;
  return list.filter((s) => String(s.ownerXuiUserId) === ownerFilter.value);
});

function getLineStatus(s: any): "active" | "expiring" | "expired" | "disabled" {
  if (s.status === "disabled") return "disabled";
  // Line has expired only if its timestamp is actually in the past
  if (s.expDate !== null && s.expDate * 1000 < Date.now()) return "expired";
  if (s.daysLeft !== null && s.daysLeft <= 3) return "expiring";
  return "active";
}

function toggleFilter(filter: "active" | "expiring" | "expired" | "disabled") {
  statusFilter.value = statusFilter.value === filter ? null : filter;
  page.value = 1;
  tg.HapticFeedback.selectionChanged();
}

const filtered = computed(() => {
  let result = ownerScoped.value;

  if (statusFilter.value) {
    result = result.filter((s) => getLineStatus(s) === statusFilter.value);
  }

  const q = search.value.toLowerCase().trim();
  if (q) {
    const qBare = q.startsWith("@") ? q.slice(1) : q;
    result = result.filter(
      (s: any) =>
        s.username?.toLowerCase().includes(q) ||
        s.id?.toString().includes(q) ||
        s.resellerNotes?.toLowerCase().includes(q) ||
        s.customerUsername?.toLowerCase().includes(qBare) ||
        s.customerTelegramId?.toString().includes(qBare) ||
        s.ownerName?.toLowerCase().includes(qBare) ||
        s.ownerXuiUsername?.toLowerCase().includes(qBare)
    );
  }

  return result;
});

const stats = computed(() => {
  let active = 0, expiring = 0, expired = 0, disabled = 0;
  for (const s of ownerScoped.value) {
    const st = getLineStatus(s);
    if (st === "disabled") disabled++;
    else if (st === "expired") expired++;
    else if (st === "expiring") expiring++;
    else active++;
  }
  return { active, expiring, expired, disabled, total: ownerScoped.value.length };
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
  const st = getLineStatus(sub);
  if (st === "disabled") return "dot-gray";
  if (st === "expired") return "dot-red";
  if (st === "expiring") return "dot-orange";
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

    <!-- Unlinked, and not an admin — nothing to show them -->
    <template v-else-if="!user || (!user.linked && !user.isAdmin)">
      <div class="empty-state">
        <Link2Off class="icon-svg" />
        <p>Your account isn't linked yet.<br />Please contact an administrator to get started.</p>
      </div>
    </template>

    <template v-else-if="user">
      <div style="font-size: 13px; color: var(--tg-hint); margin-bottom: 12px">
        <template v-if="user.linked">
          Logged in as <b style="color: var(--tg-text)">{{ user.xuiUsername }}</b>
        </template>
        <template v-else>
          Signed in as <b style="color: var(--tg-text)">admin</b> — no reseller account linked
        </template>
      </div>

      <!-- Stats -->
      <div class="stats-grid" :class="{ 'stats-grid-4': !user.linked }">
        <div v-if="user.linked" class="stat-card stat-card-credits" @click="router.push('/buy')">
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
        <div class="stat-card stat-card-filter" :class="{ 'stat-card-selected': statusFilter === 'disabled' }" @click="toggleFilter('disabled')">
          <div class="stat-value stat-disabled">{{ stats.disabled }}</div>
          <div class="stat-label">Disabled</div>
        </div>
      </div>

      <!-- Actions — buying and creating both need the caller's own reseller key -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px">
        <button v-if="user.linked && user.permissions?.canBuyCredits !== false" class="btn btn-secondary" style="flex: 1" @click="router.push('/buy')">
          + Buy Credits
        </button>
        <button v-if="user.linked && user.permissions?.canCreateLine !== false" class="btn btn-secondary" style="flex: 1" @click="router.push('/create')">
          + New Line
        </button>
        <button v-if="user.isAdmin" class="btn btn-secondary" style="flex: 1" @click="router.push('/admin')">
          Admin
        </button>
      </div>

      <!-- Subscriptions -->
      <div class="section-header" style="display: flex; justify-content: space-between; align-items: center">
        <span>Lines</span>
        <span style="font-size: 13px; font-weight: 400; color: var(--tg-hint)">{{ filtered.length }} of {{ ownerScoped.length }}</span>
      </div>

      <!-- Admin scope toggle — nothing to switch to when there's no own account -->
      <div v-if="user.isAdmin && user.linked" class="scope-toggle">
        <button class="scope-btn" :class="{ active: scope === 'mine' }" @click="setScope('mine')">My lines</button>
        <button class="scope-btn" :class="{ active: scope === 'all' }" @click="setScope('all')">All lines</button>
      </div>

      <!-- Owner filter (all-lines mode) -->
      <select
        v-if="scope === 'all' && owners.length > 0"
        v-model="ownerFilter"
        class="owner-select"
        @click.stop
      >
        <option :value="null">All resellers ({{ scopedSubs?.length || 0 }})</option>
        <option v-for="o in owners" :key="o.id" :value="o.id">{{ o.label }} ({{ o.count }})</option>
      </select>

      <!-- Search -->
      <input
        v-if="scopedSubs && scopedSubs.length > 0"
        v-model="search"
        type="search"
        placeholder="Search lines..."
        class="search-input"
        @input="page = 1"
        @click.stop
      />

      <div v-if="scope === 'all' && allSubsError" class="empty-state">
        <SearchX class="icon-svg" />
        <p>{{ allSubsError }}</p>
      </div>

      <div v-else-if="scope === 'all' && allSubsLoading && !allSubs" class="empty-state">
        <p>Loading all lines...</p>
      </div>

      <div v-else-if="!scopedSubs || scopedSubs.length === 0" class="empty-state">
        <Satellite class="icon-svg" />
        <p>No active lines found.</p>
      </div>

      <div v-else-if="filtered.length === 0" class="empty-state">
        <SearchX class="icon-svg" />
        <p v-if="search">No lines match "{{ search }}"</p>
        <p v-else>No lines match the current filter.</p>
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
            <div v-if="scope === 'all'" class="owner-tag">
              {{ sub.ownerName || sub.ownerXuiUsername || `XUI member ${sub.ownerXuiUserId}` }}
            </div>
          </div>
          <div class="line-indicators">
            <span v-if="sub.customerTelegramId" class="badge-customer" title="Linked to a customer">@</span>
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
.scope-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  background: var(--tg-secondary-bg);
  border-radius: 10px;
  padding: 3px;
}
.scope-btn {
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
.scope-btn.active {
  background: var(--tg-btn);
  color: var(--tg-btn-text);
}
.owner-select {
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
.owner-select:focus {
  border-color: var(--tg-link);
}
.owner-tag {
  font-size: 12px;
  color: var(--tg-link);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
/* Admin with no reseller account of their own — no credits card to show */
.stats-grid-4 {
  grid-template-columns: repeat(4, 1fr);
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
.stat-disabled { color: var(--tg-hint); }
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
.dot-gray { background: var(--tg-hint); }
.badge-customer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 11px;
  font-weight: 700;
  color: var(--tg-link);
  background: var(--tg-secondary-bg);
  border: 1px solid var(--tg-link);
  border-radius: 50%;
  line-height: 1;
}
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
