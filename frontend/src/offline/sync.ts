import { createSaleForBranch } from "../api";
import { getSalesOutbox, getSalesOutboxCount, removeOutboxItem } from "./storage";

export type OutboxSyncResult = {
  syncedCount: number;
  remainingCount: number;
  hadFailure: boolean;
};

export async function syncSalesOutboxOnce(): Promise<OutboxSyncResult> {
  if (!navigator.onLine) {
    return { syncedCount: 0, remainingCount: getSalesOutboxCount(), hadFailure: false };
  }

  const outbox = getSalesOutbox().sort((a, b) => a.createdAt - b.createdAt);
  if (!outbox.length) {
    return { syncedCount: 0, remainingCount: 0, hadFailure: false };
  }

  let syncedCount = 0;
  let hadFailure = false;

  for (const item of outbox) {
    try {
      await createSaleForBranch(item.sale, item.branchId);
      removeOutboxItem(item.id);
      syncedCount += 1;
    } catch {
      hadFailure = true;
      break;
    }
  }

  if (syncedCount > 0) {
    window.dispatchEvent(new CustomEvent("productsUpdated"));
  }

  return {
    syncedCount,
    remainingCount: getSalesOutboxCount(),
    hadFailure,
  };
}