<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
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

async function create(pkg: any) {
  tg.showConfirm(
    `Create a new line with "${pkg.name}" for ${pkg.credits} credits?`,
    async (ok) => {
      if (!ok) return;

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
  );
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
        @click="!creating && create(pkg)"
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
</style>
