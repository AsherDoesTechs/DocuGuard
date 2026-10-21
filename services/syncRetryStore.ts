import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSyncRetryStore } from "@/shared/sync/syncRetryStore";

/**
 * The durable retry log for documents that are waiting to sync.
 *
 * It lives in AsyncStorage rather than in the `documents` table so the retry
 * bookkeeping never requires a schema migration, and it survives an app
 * restart, which is the whole point of a retry.
 */
export const syncRetryStore = createSyncRetryStore({
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
});
