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

// Downgrade confirmation modal
const showDowngradeModal = ref(false);
const downgradePkg = ref<any>(null);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function isDowngrade(pkg: any): boolean {
  if (!line.value) return false;
  return parseInt(pkg.maxConnections, 10) < parseInt(line.value.maxConnections, 10);
}

function openDowngradeModal(pkg: any) {
  downgradePkg.value = pkg;
  countdown.value = 10;
  showDowngradeModal.value = true;
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0 && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 1000);
}

function closeDowngradeModal() {
  showDowngradeModal.value = false;
  downgradePkg.value = null;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

async function confirmExtend(pkg: any) {
  closeDowngradeModal();
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

async function extend(pkg: any) {
  if (isDowngrade(pkg)) {
    openDowngradeModal(pkg);
    return;
  }
  tg.showConfirm(
    `Extend with "${pkg.name}" for ${pkg.credits} credits?`,
    async (ok) => {
      if (!ok) return;
      confirmExtend(pkg);
    }
  );
}

function durationLabel(pkg: any) {
  const n = pkg.duration;
  const u = pkg.durationUnit;
  return `${n} ${u}`;
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
        @click="!extending && extend(pkg)"
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

    <!-- Downgrade confirmation modal -->
    <Teleport to="body">
      <div v-if="showDowngradeModal && downgradePkg" class="modal-overlay" @click.self="closeDowngradeModal">
        <div class="modal">
          <div class="modal-icon">⚠️</div>
          <div class="modal-title">Connection Downgrade</div>
          <div class="modal-body">
            This will reduce your connections from
            <strong>{{ line?.maxConnections }}</strong> to
            <strong>{{ downgradePkg.maxConnections }}</strong>.
          </div>
          <div class="modal-body" style="margin-top: 8px">
            Extend with "{{ downgradePkg.name }}" for <strong>{{ downgradePkg.credits }}</strong> credits?
          </div>
          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" @click="closeDowngradeModal">Cancel</button>
            <button
              class="modal-btn modal-btn-confirm"
              :disabled="countdown > 0"
              @click="confirmExtend(downgradePkg)"
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
  max-width: 320px;
  text-align: center;
}
.modal-icon {
  font-size: 36px;
  margin-bottom: 12px;
}
.modal-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--tg-text);
  margin-bottom: 8px;
}
.modal-body {
  font-size: 14px;
  color: var(--tg-hint);
  line-height: 1.5;
}
.modal-body strong {
  color: var(--tg-text);
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
.modal-btn-cancel {
  background: var(--tg-secondary-bg);
  color: var(--tg-text);
}
.modal-btn-confirm {
  background: var(--tg-destructive, #ff3b30);
  color: white;
}
.modal-btn-confirm:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
