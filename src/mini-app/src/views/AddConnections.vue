<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { Satellite, Plus, ArrowRight } from "lucide-vue-next";
import { api, useAsync } from "../composables/useApi";
import { useStore } from "../composables/useStore";
import { useLoading } from "../composables/useLoading";

const props = defineProps<{ lineId: string }>();
const router = useRouter();
const tg = window.Telegram.WebApp;

const { user, loadUser, invalidateSubs, invalidateUser } = useStore();
loadUser();

const { data: options, loading } = useAsync(() => api.getConnectionOptions(props.lineId));
const { data: line } = useAsync(() => api.getLine(props.lineId));

const loading_ = useLoading();
const upgrading = ref(false);
const selectedTo = ref<number | null>(null);

// Confirm modal
const showConfirmModal = ref(false);
const confirmOption = ref<any>(null);

const breakdown = computed(() => {
  if (!confirmOption.value || !line.value || !user.value) return null;
  const opt = confirmOption.value;
  const currentCredits = user.value.credits ?? 0;
  return {
    credits: {
      from: currentCredits,
      to: currentCredits - opt.cost,
    },
    connections: {
      from: opt.from,
      to: opt.to,
    },
  };
});

function openConfirmModal(option: any) {
  confirmOption.value = option;
  showConfirmModal.value = true;
}

function closeConfirmModal() {
  showConfirmModal.value = false;
  confirmOption.value = null;
}

async function confirmUpgrade() {
  if (!confirmOption.value) return;
  const option = confirmOption.value;
  closeConfirmModal();

  selectedTo.value = option.to;
  upgrading.value = true;
  loading_.show("Upgrading connections...");
  tg.HapticFeedback.impactOccurred("medium");

  try {
    await api.addConnections(props.lineId, option.to);
    invalidateSubs();
    invalidateUser();
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("success");
    tg.showAlert(`Upgraded to ${option.to} connections!`, () => {
      router.replace(`/line/${props.lineId}`);
    });
  } catch (e: any) {
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Failed to upgrade connections");
  } finally {
    upgrading.value = false;
    selectedTo.value = null;
  }
}
</script>

<template>
  <div class="page">
    <div class="section-header">Add Connections</div>

    <p v-if="user?.credits !== undefined" style="font-size: 13px; color: var(--tg-hint); margin-bottom: 4px; padding: 0 4px">
      Your balance: <strong style="color: var(--tg-text)">{{ user.credits }}</strong> credits
    </p>

    <p v-if="line" style="font-size: 13px; color: var(--tg-hint); margin-bottom: 12px; padding: 0 4px">
      Current: <strong style="color: var(--tg-text)">{{ line.maxConnections }}</strong> connection{{ parseInt(line.maxConnections) !== 1 ? 's' : '' }}
    </p>

    <template v-if="loading">
      <div class="section" v-for="i in 2" :key="i">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line" style="width: 50%"></div>
      </div>
    </template>

    <template v-else-if="options && options.length > 0">
      <div
        v-for="opt in options"
        :key="opt.to"
        class="card"
        @click="!upgrading && openConfirmModal(opt)"
        :style="{ cursor: upgrading ? 'not-allowed' : 'pointer', opacity: upgrading && selectedTo !== opt.to ? 0.5 : 1 }"
      >
        <div class="card-row">
          <div>
            <div style="font-weight: 600; font-size: 15px">{{ opt.to }} Connection{{ opt.to !== 1 ? 's' : '' }}</div>
            <div style="font-size: 13px; color: var(--tg-hint); margin-top: 2px">
              Add {{ opt.to - opt.from }} extra device{{ opt.to - opt.from !== 1 ? 's' : '' }}
            </div>
          </div>
          <div style="text-align: right">
            <div style="font-weight: 700; font-size: 16px; color: var(--tg-link)">{{ opt.cost }}</div>
            <div style="font-size: 11px; color: var(--tg-hint)">credits</div>
          </div>
        </div>
      </div>

      <p style="text-align: center; font-size: 12px; color: var(--tg-hint); margin-top: 12px; padding: 0 16px; line-height: 1.5">
        Cost is based on your remaining subscription time.
      </p>
    </template>

    <div v-else class="empty-state">
      <Satellite class="icon-svg" />
      <p>Already at maximum connections.</p>
    </div>

    <!-- Confirm modal with breakdown -->
    <Teleport to="body">
      <div v-if="showConfirmModal && confirmOption && breakdown" class="modal-overlay" @click.self="closeConfirmModal">
        <div class="modal">
          <Plus class="modal-icon-svg" />
          <div class="modal-title">Add Connections</div>

          <div class="breakdown">
            <div class="breakdown-row">
              <span class="breakdown-label">Credits</span>
              <div class="breakdown-values">
                <span>{{ breakdown.credits.from }}</span>
                <ArrowRight class="arrow-icon" />
                <span class="new">{{ breakdown.credits.to }}</span>
              </div>
            </div>
            <div class="breakdown-row">
              <span class="breakdown-label">Connections</span>
              <div class="breakdown-values">
                <span>{{ breakdown.connections.from }}</span>
                <ArrowRight class="arrow-icon" />
                <span class="new">{{ breakdown.connections.to }}</span>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" @click="closeConfirmModal">Cancel</button>
            <button class="modal-btn modal-btn-confirm" @click="confirmUpgrade">Confirm</button>
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
.modal-icon { font-size: 36px; margin-bottom: 8px; }
.modal-icon-svg {
  width: 40px;
  height: 40px;
  margin: 0 auto 8px;
  display: block;
  stroke-width: 1.5;
  color: var(--tg-link);
}
.modal-title { font-size: 17px; font-weight: 700; color: var(--tg-text); }
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
.breakdown-label { font-size: 13px; color: var(--tg-hint); }
.breakdown-values {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}
.breakdown-values .arrow-icon { width: 14px; height: 14px; color: var(--tg-hint); }
.breakdown-values .new { color: var(--tg-link); font-weight: 700; }
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
  background: var(--tg-btn);
  color: var(--tg-btn-text);
}
</style>
