<script setup lang="ts">
import { api, useAsync } from "../../composables/useApi";
import CopyChip from "./CopyChip.vue";

const props = defineProps<{ id: string }>();
const { data: line, loading } = useAsync(() => api.getLine(props.id));
</script>

<template>
  <div class="page">
    <div class="section-header">Formuler Box</div>

    <template v-if="loading">
      <div class="skeleton skeleton-line"></div>
    </template>

    <template v-else-if="line">
      <ol class="steps">
        <li>
          <b>Open MyTVOnline</b> from the Formuler home screen.
          <div class="todo">TODO: confirm which Formuler model / MyTVOnline version these steps are for</div>
        </li>
        <li>
          Go to <b>Settings</b> → <b>Playlists</b> → <b>Add Playlist</b>.
          <div class="todo">TODO: screenshot of the playlists screen</div>
        </li>
        <li>
          Select <b>Xtream Codes API</b> as the playlist type.
        </li>
        <li>
          Enter:
          <ul>
            <li><b>Name</b> — anything, e.g. "Subscription"</li>
            <li><b>URL</b> — <CopyChip :value="line.serverUrl" /></li>
            <li><b>Username</b> — <CopyChip :value="line.username" /></li>
            <li><b>Password</b> — <CopyChip :value="line.password" /></li>
          </ul>
          <div class="todo">TODO: screenshot of the Xtream Codes entry form</div>
        </li>
        <li>
          <b>Save</b>. The box will load your channels and you're set.
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
