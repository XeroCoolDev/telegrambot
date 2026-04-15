<script setup lang="ts">
import { api, useAsync } from "../../composables/useApi";
import CopyChip from "./CopyChip.vue";

const props = defineProps<{ id: string }>();
const { data: line, loading } = useAsync(() => api.getLine(props.id));
</script>

<template>
  <div class="page">
    <div class="section-header">GSE Smart IPTV — Apple</div>

    <template v-if="loading">
      <div class="skeleton skeleton-line"></div>
    </template>

    <template v-else-if="line">
      <ol class="steps">
        <li>
          <b>Install GSE Smart IPTV</b> from the App Store (free).
          Works on iPhone, iPad and Apple TV.
        </li>
        <li>
          <b>Open the app</b> and tap the menu (≡) in the top-left corner.
          <div class="todo">TODO: screenshot of the GSE menu</div>
        </li>
        <li>
          Tap <b>Xtream Codes API</b> in the menu, then the <b>+</b> button to add a new subscription.
        </li>
        <li>
          Enter:
          <ul>
            <li><b>Any Name</b> — anything, e.g. "Subscription"</li>
            <li><b>Username</b> — <CopyChip :value="line.username" /></li>
            <li><b>Password</b> — <CopyChip :value="line.password" /></li>
            <li><b>URL</b> — <CopyChip :value="line.serverUrl" /></li>
          </ul>
          <div class="todo">TODO: screenshot of the Xtream Codes entry form</div>
        </li>
        <li>
          Tap <b>Add</b>. The app will load your channels. If GSE asks to upgrade
          to unlock Xtream Codes, you may need the paid version.
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.steps { padding-left: 20px; }
.steps > li {
  font-size: 14px;
  color: var(--tg-text);
  margin-bottom: 14px;
  line-height: 1.5;
}
.steps ul {
  padding-left: 18px;
  margin-top: 4px;
}
.steps ul li {
  font-size: 14px;
  margin-bottom: 6px;
}
.todo {
  margin-top: 6px;
  padding: 6px 10px;
  border: 1px dashed var(--tg-hint);
  border-radius: 6px;
  font-size: 12px;
  color: var(--tg-hint);
  font-style: italic;
}
</style>
