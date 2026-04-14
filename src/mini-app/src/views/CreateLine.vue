<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { Plus, ArrowRight } from "lucide-vue-next";
import { api } from "../composables/useApi";
import { useStore } from "../composables/useStore";
import { useLoading } from "../composables/useLoading";

const router = useRouter();
const tg = window.Telegram.WebApp;
const loading_ = useLoading();

const { user, packages, packagesLoading: loading, loadPackages, loadUser, invalidateSubs, invalidateUser } = useStore();
loadPackages();
loadUser();

const contact = ref("");
const notes = ref("");
const adultEnabled = ref(true);
const creating = ref(false);
const selectedId = ref<string | null>(null);

// Confirm modal
const showConfirmModal = ref(false);
const confirmPkg = ref<any>(null);

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const breakdown = computed(() => {
  if (!confirmPkg.value || !user.value) return null;
  const pkg = confirmPkg.value;
  const now = new Date();
  const expiry = new Date(now);
  const duration = parseInt(pkg.duration, 10);

  if (pkg.durationUnit === "months") expiry.setMonth(expiry.getMonth() + duration);
  else if (pkg.durationUnit === "days") expiry.setDate(expiry.getDate() + duration);
  else if (pkg.durationUnit === "hours") expiry.setHours(expiry.getHours() + duration);

  const currentCredits = user.value.credits ?? 0;

  return {
    credits: {
      from: currentCredits,
      to: currentCredits - pkg.credits,
    },
    expiry: formatDate(expiry),
    connections: pkg.maxConnections,
  };
});

function openConfirmModal(pkg: any) {
  confirmPkg.value = pkg;
  showConfirmModal.value = true;
}

function closeConfirmModal() {
  showConfirmModal.value = false;
  confirmPkg.value = null;
}

async function confirmCreate() {
  if (!confirmPkg.value) return;
  const pkg = confirmPkg.value;
  closeConfirmModal();

  selectedId.value = pkg.id;
  creating.value = true;
  loading_.show("Creating line...");
  tg.HapticFeedback.impactOccurred("medium");

  try {
    const result = await api.createLine(pkg.id, notes.value || undefined, contact.value || undefined);

    if (!adultEnabled.value) {
      loading_.show("Disabling adult content...");
      await api.toggleAdult(result.lineId, false);
    }

    invalidateSubs();
    invalidateUser();
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("success");
    tg.showAlert("Line created successfully!", () => {
      router.replace(`/line/${result.lineId}`);
    });
  } catch (e: any) {
    loading_.hide();
    tg.HapticFeedback.notificationOccurred("error");
    tg.showAlert(e.message || "Failed to create line");
  } finally {
    creating.value = false;
    selectedId.value = null;
  }
}

function durationLabel(pkg: any) {
  return `${pkg.duration} ${pkg.durationUnit}`;
}
</script>

<template>
  <div class="page">
    <div class="section-header">Create New Line</div>

    <p v-if="user?.credits !== undefined" style="font-size: 13px; color: var(--tg-hint); margin-bottom: 12px; padding: 0 4px">
      Your balance: <strong style="color: var(--tg-text)">{{ user.credits }}</strong> credits
    </p>

    <!-- Details -->
    <div class="form-card">
      <div class="form-field">
        <label class="form-label">Contact</label>
        <input v-model="contact" type="text" class="form-input" placeholder="Email or phone" @click.stop />
      </div>
      <div class="form-field">
        <label class="form-label">Notes</label>
        <input v-model="notes" type="text" class="form-input" placeholder="Customer name, reference, etc." @click.stop />
      </div>
      <div class="form-toggle">
        <label class="form-label" style="margin-bottom: 0">Adult Content</label>
        <label class="toggle" @click.stop>
          <input type="checkbox" v-model="adultEnabled" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Package selection -->
    <div class="section-header">Select Package</div>

    <template v-if="loading">
      <div class="section" v-for="i in 3" :key="i">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line" style="width: 50%"></div>
      </div>
    </template>

    <template v-else-if="packages">
      <div
        v-for="pkg in packages"
        :key="pkg.id"
        class="card"
        @click="!creating && openConfirmModal(pkg)"
        :style="{ cursor: creating ? 'not-allowed' : 'pointer', opacity: creating && selectedId !== pkg.id ? 0.5 : 1 }"
      >
        <div class="card-row">
          <div>
            <div style="font-weight: 600; font-size: 15px">{{ pkg.name }}</div>
            <div style="font-size: 13px; color: var(--tg-hint); margin-top: 2px">
              {{ durationLabel(pkg) }} · {{ pkg.maxConnections }} conn
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

      <p v-if="user && user.credits === 0" style="text-align: center; margin-top: 16px">
        <button class="btn btn-secondary" @click="router.push('/buy')">
          Buy Credits First
        </button>
      </p>
    </template>

    <!-- Confirm modal with breakdown -->
    <Teleport to="body">
      <div v-if="showConfirmModal && confirmPkg && breakdown" class="modal-overlay" @click.self="closeConfirmModal">
        <div class="modal">
          <Plus class="modal-icon-svg" />
          <div class="modal-title">Create New Line</div>
          <div class="modal-subtitle">{{ confirmPkg.name }}</div>

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
              <span class="breakdown-label">Expires</span>
              <span class="breakdown-single">{{ breakdown.expiry }}</span>
            </div>
            <div class="breakdown-row">
              <span class="breakdown-label">Connections</span>
              <span class="breakdown-single">{{ breakdown.connections }}</span>
            </div>
            <div class="breakdown-row">
              <span class="breakdown-label">Adult Content</span>
              <span class="breakdown-single">{{ adultEnabled ? 'Enabled' : 'Disabled' }}</span>
            </div>
          </div>

          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" @click="closeConfirmModal">Cancel</button>
            <button class="modal-btn modal-btn-confirm" @click="confirmCreate">Create</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.form-card {
  background: var(--tg-secondary-bg);
  border-radius: 12px;
  padding: 4px 16px;
  margin-bottom: 16px;
}
.form-field {
  padding: 12px 0;
  border-bottom: 1px solid var(--tg-hint);
  border-bottom-style: solid;
  opacity: 1;
}
.form-field:last-child {
  border-bottom: none;
}
.form-label {
  display: block;
  font-size: 12px;
  color: var(--tg-hint);
  margin-bottom: 6px;
}
.form-input {
  width: 100%;
  border: none;
  background: none;
  color: var(--tg-text);
  font-size: 15px;
  padding: 0;
  outline: none;
  box-sizing: border-box;
}
.form-input::placeholder {
  color: var(--tg-hint);
  opacity: 0.6;
}
.form-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
}
.toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 28px;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--tg-hint);
  border-radius: 28px;
  transition: background 0.2s;
  cursor: pointer;
}
.toggle-slider::before {
  content: "";
  position: absolute;
  width: 22px;
  height: 22px;
  left: 3px;
  bottom: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .toggle-slider {
  background: var(--tg-btn);
}
.toggle input:checked + .toggle-slider::before {
  transform: translateX(20px);
}
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
.modal-subtitle { font-size: 13px; color: var(--tg-hint); margin-top: 4px; }
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
.breakdown-single { font-size: 13px; font-weight: 600; color: var(--tg-text); }
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
