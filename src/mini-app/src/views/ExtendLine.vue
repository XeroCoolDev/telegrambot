<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api, useAsync } from "../composables/useApi";
import { useStore } from "../composables/useStore";
import { useLoading } from "../composables/useLoading";

const props = defineProps<{ lineId: string }>();
const router = useRouter();
const tg = window.Telegram.WebApp;

const { user, packages, packagesLoading, loadPackages, loadUser, invalidateSubs, invalidateUser } = useStore();
loadPackages();
loadUser();

const { data: line, loading: lineLoading } = useAsync(() => api.getLine(props.lineId));
const loading = computed(() => packagesLoading.value || lineLoading.value);

// Connection lock: hide packages with more connections if too many days remaining
const filteredPackages = computed(() => {
  if (!packages.value || !line.value) return packages.value;
  const lineConns = parseInt(line.value.maxConnections, 10);
  const daysLeft = line.value.daysLeft;
  const lockDays = user.value?.config?.extendConnLockDays ?? 30;
  if (daysLeft !== null && daysLeft > lockDays) {
    return packages.value.filter((p: any) => parseInt(p.maxConnections, 10) <= lineConns);
  }
  return packages.value;
});

const loading_ = useLoading();
const extending = ref(false);
const selectedId = ref<string | null>(null);

// Confirm modal
const showConfirmModal = ref(false);
const confirmPkg = ref<any>(null);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function isDowngrade(pkg: any): boolean {
  if (!line.value) return false;
  return parseInt(pkg.maxConnections, 10) < parseInt(line.value.maxConnections, 10);
}

// Calculate new expiry date based on package duration
function calculateNewExpiry(pkg: any): Date {
  const now = new Date();
  const current = line.value?.expDate ? new Date(line.value.expDate * 1000) : now;
  const base = current > now ? current : now;
  const newDate = new Date(base);
  const duration = parseInt(pkg.duration, 10);

  if (pkg.durationUnit === "months") newDate.setMonth(newDate.getMonth() + duration);
  else if (pkg.durationUnit === "days") newDate.setDate(newDate.getDate() + duration);
  else if (pkg.durationUnit === "hours") newDate.setHours(newDate.getHours() + duration);

  return newDate;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Breakdown for the modal
const breakdown = computed(() => {
  if (!confirmPkg.value || !line.value || !user.value) return null;
  const pkg = confirmPkg.value;
  const newExpiry = calculateNewExpiry(pkg);
  const currentCredits = user.value.credits ?? 0;
  const currentConns = parseInt(line.value.maxConnections, 10);
  const newConns = parseInt(pkg.maxConnections, 10);

  return {
    credits: {
      from: currentCredits,
      to: currentCredits - pkg.credits,
    },
    expiry: {
      from: line.value.expiresFormatted,
      to: formatDate(newExpiry),
    },
    connections: {
      from: currentConns,
      to: newConns,
      changed: currentConns !== newConns,
      downgrade: newConns < currentConns,
    },
  };
});

function openConfirmModal(pkg: any) {
  confirmPkg.value = pkg;
  countdown.value = isDowngrade(pkg) ? 5 : 0;
  showConfirmModal.value = true;

  if (countdown.value > 0) {
    countdownTimer = setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0 && countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }, 1000);
  }
}

function closeConfirmModal() {
  showConfirmModal.value = false;
  confirmPkg.value = null;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

async function confirmExtend() {
  if (!confirmPkg.value) return;
  const pkg = confirmPkg.value;
  closeConfirmModal();
  selectedId.value = pkg.id;
  extending.value = true;
  loading_.show("Extending line...");
  tg.HapticFeedback.impactOccurred("medium");

  try {
    await api.extendLine(props.lineId, pkg.id);
    invalidateSubs();
    invalidateUser();
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("success");
    tg.showAlert("Line extended successfully!", () => {
      router.replace(`/line/${props.lineId}`);
    });
  } catch (e: any) {
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Failed to extend line");
  } finally {
    extending.value = false;
    selectedId.value = null;
  }
}

function durationLabel(pkg: any) {
  return `${pkg.duration} ${pkg.durationUnit}`;
}
</script>

<template>
  <div class="page">
    <div class="section-header">Select Package</div>

    <p v-if="user?.credits !== undefined" style="font-size: 13px; color: var(--tg-hint); margin-bottom: 12px; padding: 0 4px">
      Your balance: <strong style="color: var(--tg-text)">{{ user.credits }}</strong> credits
    </p>

    <template v-if="loading">
      <div class="section" v-for="i in 3" :key="i">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line" style="width: 50%"></div>
      </div>
    </template>

    <template v-else-if="filteredPackages">
      <div
        v-for="pkg in filteredPackages"
        :key="pkg.id"
        class="card"
        @click="!extending && openConfirmModal(pkg)"
        :style="{ cursor: extending ? 'not-allowed' : 'pointer', opacity: extending && selectedId !== pkg.id ? 0.5 : 1 }"
      >
        <div class="card-row">
          <div>
            <div style="font-weight: 600; font-size: 15px">{{ pkg.name }}</div>
            <div style="font-size: 13px; color: var(--tg-hint); margin-top: 2px">
              {{ durationLabel(pkg) }} · {{ pkg.maxConnections }} conn
            </div>
            <div v-if="isDowngrade(pkg)" style="font-size: 12px; color: var(--tg-destructive); margin-top: 4px; font-weight: 500">
              Downgrades from {{ line?.maxConnections }} connections
            </div>
          </div>
          <div style="text-align: right">
            <div style="font-weight: 700; font-size: 16px; color: var(--tg-link)">
              {{ pkg.credits }}
            </div>
            <div style="font-size: 11px; color: var(--tg-hint)">credits</div>
          </div>
        </div>
      </div>
    </template>

    <!-- Confirm modal with breakdown -->
    <Teleport to="body">
      <div v-if="showConfirmModal && confirmPkg && breakdown" class="modal-overlay" @click.self="closeConfirmModal">
        <div class="modal">
          <div class="modal-icon">{{ breakdown.connections.downgrade ? '⚠️' : '🔄' }}</div>
          <div class="modal-title">
            {{ breakdown.connections.downgrade ? 'Confirm Downgrade' : 'Confirm Extension' }}
          </div>
          <div class="modal-subtitle">{{ confirmPkg.name }}</div>

          <div class="breakdown">
            <div class="breakdown-row">
              <span class="breakdown-label">Credits</span>
              <div class="breakdown-values">
                <span>{{ breakdown.credits.from }}</span>
                <span class="arrow">→</span>
                <span class="new">{{ breakdown.credits.to }}</span>
              </div>
            </div>
            <div class="breakdown-row">
              <span class="breakdown-label">Expires</span>
              <div class="breakdown-values">
                <span>{{ breakdown.expiry.from }}</span>
                <span class="arrow">→</span>
                <span class="new">{{ breakdown.expiry.to }}</span>
              </div>
            </div>
            <div v-if="breakdown.connections.changed" class="breakdown-row">
              <span class="breakdown-label">Connections</span>
              <div class="breakdown-values">
                <span>{{ breakdown.connections.from }}</span>
                <span class="arrow">→</span>
                <span :class="breakdown.connections.downgrade ? 'new-warning' : 'new'">{{ breakdown.connections.to }}</span>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" @click="closeConfirmModal">Cancel</button>
            <button
              class="modal-btn"
              :class="breakdown.connections.downgrade ? 'modal-btn-warn' : 'modal-btn-confirm'"
              :disabled="countdown > 0"
              @click="confirmExtend"
            >
              {{ countdown > 0 ? `Confirm (${countdown})` : 'Confirm' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
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
  max-width: 340px;
  text-align: center;
}
.modal-icon {
  font-size: 36px;
  margin-bottom: 8px;
}
.modal-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--tg-text);
}
.modal-subtitle {
  font-size: 13px;
  color: var(--tg-hint);
  margin-top: 4px;
}
.breakdown {
  margin: 20px 0 8px;
  background: var(--tg-secondary-bg);
  border-radius: 10px;
  padding: 4px 12px;
  text-align: left;
}
.breakdown-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--tg-bg);
}
.breakdown-row:last-child { border-bottom: none; }
.breakdown-label {
  font-size: 13px;
  color: var(--tg-hint);
}
.breakdown-values {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}
.breakdown-values .arrow {
  color: var(--tg-hint);
}
.breakdown-values .new {
  color: var(--tg-link);
  font-weight: 700;
}
.breakdown-values .new-warning {
  color: var(--tg-destructive, #ff3b30);
  font-weight: 700;
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
.modal-btn:disabled { opacity: 0.4; cursor: default; }
.modal-btn-cancel {
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
}
.modal-btn-confirm {
  background: var(--tg-btn);
  color: var(--tg-btn-text);
}
.modal-btn-warn {
  background: var(--tg-destructive, #ff3b30);
  color: white;
}
</style>
