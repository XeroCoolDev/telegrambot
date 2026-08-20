import { ref } from "vue";
import { api, type UserInfo, type Subscription, type AdminLine, type XuiPackage } from "./useApi";

const user = ref<UserInfo | null>(null);
const subs = ref<Subscription[] | null>(null);
const allSubs = ref<AdminLine[] | null>(null);
const packages = ref<XuiPackage[] | null>(null);

const userLoading = ref(false);
const subsLoading = ref(false);
const allSubsLoading = ref(false);
const packagesLoading = ref(false);

const userLoaded = ref(false);
const subsLoaded = ref(false);
const allSubsLoaded = ref(false);
const packagesLoaded = ref(false);

/** Non-fatal: surfaced in the Dashboard when the all-lines fetch fails. */
const allSubsError = ref<string | null>(null);

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

/** Admin-only: every line across all linked resellers. */
async function loadAllSubs() {
  if (allSubsLoaded.value) return;
  allSubsLoading.value = true;
  allSubsError.value = null;
  try {
    allSubs.value = await api.adminGetLines();
    allSubsLoaded.value = true;
  } catch (e: any) {
    allSubsError.value = e.message || "Failed to load lines";
  } finally {
    allSubsLoading.value = false;
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
  // The admin-wide list contains the same lines, so it goes stale too.
  allSubsLoaded.value = false;
  allSubs.value = null;
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
    allSubs,
    packages,
    userLoading,
    subsLoading,
    allSubsLoading,
    allSubsError,
    packagesLoading,
    loadUser,
    loadSubs,
    loadAllSubs,
    loadPackages,
    invalidateSubs,
    invalidateUser,
  };
}
