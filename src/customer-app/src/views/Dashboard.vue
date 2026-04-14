<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Satellite, SearchX } from "lucide-vue-next";
import { api, useAsync } from "../composables/useApi";

const router = useRouter();
const tg = window.Telegram.WebApp;

const { data: lines, loading } = useAsync(() => api.getLines());

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

const stats = computed(() => {
  if (!lines.value) return { active: 0, expiring: 0, expired: 0 };
  let active = 0, expiring = 0, expired = 0;
  for (const s of lines.value) {
    const st = getLineStatus(s);
    if (st === "active") active++;
    else if (st === "expiring") expiring++;
    else expired++;
  }
  return { active, expiring, expired };
});

const filtered = computed(() => {
  if (!lines.value) return [];
  let result = lines.value as any[];

  if (statusFilter.value) {
    result = result.filter((s) => getLineStatus(s) === statusFilter.value);
  }

  const q = search.value.toLowerCase().trim();
  if (q) {
    result = result.filter(
      (s: any) => s.username?.toLowerCase().includes(q) || s.id?.toString().includes(q) || s.notes?.toLowerCase().includes(q)
    );
  }

  return result;
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
    <template v-if="loading">
      <div class="section" v-for="i in 3" :key="i">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </template>

    <template v-else-if="!lines || lines.length === 0">
      <div class="empty-state">
        <Satellite class="icon-svg" />
        <p>No subscriptions linked yet.<br />Ask your provider for a link to connect.</p>
      </div>
    </template>

    <template v-else>
      <!-- Stats -->
      <div class="stats-grid">
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

      <div class="section-header" style="display: flex; justify-content: space-between; align-items: center">
        <span>My Subscriptions</span>
        <span style="font-size: 13px; font-weight: 400; color: var(--tg-hint)">{{ filtered.length }} of {{ lines.length }}</span>
      </div>

      <input
        v-model="search"
        type="search"
        placeholder="Search..."
        class="search-input"
        @input="page = 1"
        @click.stop
      />

      <div v-if="filtered.length === 0" class="empty-state">
        <SearchX class="icon-svg" />
        <p>No lines match "{{ search }}"</p>
      </div>

      <div
        v-for="line in paginated"
        :key="line.id"
        class="card"
        @click="tapLine(line.id)"
        style="cursor: pointer"
      >
        <div class="card-row">
          <div style="min-width: 0; flex: 1">
            <div style="font-weight: 600; font-size: 15px">{{ line.notes || line.username }}</div>
            <div style="font-size: 13px; color: var(--tg-hint); margin-top: 2px">
              {{ line.notes ? line.username + ' · ' : '' }}{{ line.expiresFormatted }} · {{ line.maxConnections }} conn
            </div>
          </div>
          <div class="line-indicators">
            <span v-if="!line.adultEnabled" class="badge-adult-off">18+</span>
            <span class="status-dot" :class="statusDotClass(line)"></span>
          </div>
        </div>
      </div>

      <div v-if="totalPages > 1" class="pagination">
        <button class="page-btn" :disabled="page <= 1" @click="setPage(page - 1)">&laquo;</button>
        <span class="page-info">{{ page }} / {{ totalPages }}</span>
        <button class="page-btn" :disabled="page >= totalPages" @click="setPage(page + 1)">&raquo;</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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
.stat-card-filter {
  cursor: pointer;
  transition: opacity 0.15s;
}
.stat-card-filter:active { opacity: 0.7; }
.stat-card-selected {
  outline: 2px solid var(--tg-link);
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
.search-input::placeholder { color: var(--tg-hint); }
.search-input:focus { border-color: var(--tg-link); }
.line-indicators { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; }
.dot-green { background: #34c759; }
.dot-orange { background: #ff9500; }
.dot-red { background: #ff3b30; }
.badge-adult-off {
  font-size: 10px; font-weight: 700; color: #ff3b30;
  background: var(--tg-secondary-bg); border: 1px solid #ff3b30;
  border-radius: 4px; padding: 1px 4px; line-height: 1.2; text-decoration: line-through;
}
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 12px; padding: 8px 0; }
.page-btn {
  width: 40px; height: 40px; border-radius: 10px; border: none;
  background: var(--tg-btn); color: var(--tg-btn-text); font-size: 16px; font-weight: 700; cursor: pointer;
}
.page-btn:disabled { opacity: 0.3; cursor: default; }
.page-info { font-size: 14px; color: var(--tg-hint); }
</style>
