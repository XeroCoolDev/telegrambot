<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
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

async function upgrade(option: any) {
  tg.showConfirm(
    `Upgrade to ${option.to} connections for ${option.cost} credits?`,
    async (ok) => {
      if (!ok) return;

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
  );
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
        @click="!upgrading && upgrade(opt)"
        :style="{ cursor: upgrading ? 'not-allowed' : 'pointer', opacity: upgrading && selectedTo !== opt.to ? 0.5 : 1 }"
      >
        <div class="card-row">
          <div>
            <div style="font-weight: 600; font-size: 15px">{{ opt.to }} Connection{{ opt.to !== 1 ? 's' : '' }}</div>
            <div style="font-size: 13px; color: var(--tg-hint); margin-top: 2px">
              Add {{ opt.to - opt.from }} extra{{ opt.to - opt.from !== 1 ? '' : '' }} device{{ opt.to - opt.from !== 1 ? 's' : '' }}
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
      <div class="icon">📡</div>
      <p>Already at maximum connections.</p>
    </div>
  </div>
</template>
