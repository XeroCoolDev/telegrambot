import { ref } from "vue";
import { api, type UserInfo, type XuiPackage } from "./useApi";

const user = ref<UserInfo | null>(null);
const packages = ref<XuiPackage[] | null>(null);

const userLoading = ref(false);
const packagesLoading = ref(false);

const userLoaded = ref(false);
const packagesLoaded = ref(false);

/**
 * Bumped whenever a line changed (extend, create, toggle, delete). The
 * Dashboard fetches its lines one page at a time from the panel and watches
 * this to refetch; nothing caches the list any more.
 */
const linesVersion = ref(0);

async function loadUser() {
  if (userLoaded.value) return;
  userLoading.value = true;
  try {
    user.value = await api.getMe();
    userLoaded.value = true;
  } finally {
    userLoading.value = false;
  }
}

async function loadPackages() {
  if (packagesLoaded.value) return;
  packagesLoading.value = true;
  try {
    packages.value = await api.getPackages();
    packagesLoaded.value = true;
  } finally {
    packagesLoading.value = false;
  }
}

/** A line changed: any open line list should refetch its current page. */
function invalidateSubs() {
  linesVersion.value++;
}

/** Invalidate user so next access re-fetches (after credit change) */
function invalidateUser() {
  userLoaded.value = false;
  user.value = null;
}

export function useStore() {
  return {
    user,
    packages,
    userLoading,
    packagesLoading,
    linesVersion,
    loadUser,
    loadPackages,
    invalidateSubs,
    invalidateUser,
  };
}
