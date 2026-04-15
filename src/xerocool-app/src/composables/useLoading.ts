import { ref } from "vue";

const visible = ref(false);
const message = ref("");

export function useLoading() {
  function show(msg = "Please wait...") {
    message.value = msg;
    visible.value = true;
  }

  function hide() {
    visible.value = false;
  }

  return { visible, message, show, hide };
}
