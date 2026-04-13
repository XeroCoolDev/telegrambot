import { ref } from "vue";
import { api, type UserInfo, type Subscription, type XuiPackage } from "./useApi";

const user = ref<UserInfo | null>(null);
const subs = ref<Subscription[] | null>(null);
const packages = ref<XuiPackage[] | null>(null);

const userLoading = ref(false);
const subsLoading = ref(false);
const packagesLoading = ref(false);

const userLoaded = ref(false);
const subsLoaded = ref(false);
const packagesLoaded = ref(false);

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

async function loadSubs() {
  if (subsLoaded.value) return;
  subsLoading.value = true;
  try {
    subs.value = await api.getSubscriptions();
    subsLoaded.value = true;
  } finally {
    subsLoading.value = false;
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

/** Invalidate subs so next access re-fetches (after extend/create/toggle) */
function invalidateSubs() {
  subsLoaded.value = false;
  subs.value = null;
}

/** Invalidate user so next access re-fetches (after credit change) */
function invalidateUser() {
  userLoaded.value = false;
  user.value = null;
}

export function useStore() {
  return {
    user,
    subs,
    packages,
    userLoading,
    subsLoading,
    packagesLoading,
    loadUser,
    loadSubs,
    loadPackages,
    invalidateSubs,
    invalidateUser,
  };
}
