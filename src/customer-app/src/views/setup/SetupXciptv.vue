<script setup lang="ts">
import { api, useAsync } from "../../composables/useApi";
import CopyChip from "./CopyChip.vue";

const props = defineProps<{ id: string }>();
const { data: line, loading } = useAsync(() => api.getLine(props.id));

// TODO: replace with your actual Downloader code once the branded APK is hosted
const DOWNLOADER_CODE = "000000";
</script>

<template>
  <div class="page">
    <div class="section-header">XCIPTV — Android / Fire TV</div>

    <template v-if="loading">
      <div class="skeleton skeleton-line"></div>
    </template>

    <template v-else-if="line">
      <ol class="steps">
        <li>
          <b>Install Downloader.</b>
          On your Fire TV or Android TV, open the app store, search for
          <b>Downloader</b> by AFTVnews, and install it.
        </li>
        <li>
          <b>Enable app installs.</b>
          On Fire TV: Settings → My Fire TV → Developer options → Install
          unknown apps → Downloader → On. (On Android TV the path is similar.)
        </li>
        <li>
          <b>Open Downloader</b> and enter the code
          <span class="code">{{ DOWNLOADER_CODE }}</span> on the home screen.
          The XCIPTV APK will download automatically.
          <div class="todo">TODO: screenshot of the Downloader home screen</div>
        </li>
        <li>
          <b>Install the APK</b> when prompted, then open the app.
        </li>
        <li>
          <b>Enter your details</b> on the first-run login screen:
          <ul>
            <li><b>Username</b> — <CopyChip :value="line.username" /></li>
            <li><b>Password</b> — <CopyChip :value="line.password" /></li>
          </ul>
          <div class="todo">TODO: screenshot of the XCIPTV login screen</div>
        </li>
        <li>
          <b>Tap Add</b>. The app will load your channels and you're done.
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
.code {
  display: inline-block;
  padding: 1px 8px;
  background: var(--tg-secondary-bg);
  border-radius: 6px;
  font-family: monospace;
  font-weight: 700;
  color: var(--tg-link);
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
