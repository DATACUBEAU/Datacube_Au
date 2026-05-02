/**
 * Optimistic UI utilities
 *
 * Helpers for applying write operations to local state immediately
 * before server confirmation, and rolling back on failure.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptimisticOperation<T> = {
  /** Unique identifier for the optimistic update */
  id: string;
  /** Type of mutation */
  type: 'create' | 'update' | 'delete';
  /** The data to apply optimistically */
  data: Partial<T>;
  /** Snapshot of the item before mutation (for rollback) */
  previousData: T | null;
  /** Timestamp of the optimistic update */
  appliedAt: number;
};

// ---------------------------------------------------------------------------
// List operations
// ---------------------------------------------------------------------------

/**
 * Optimistically add an item to a list.
 */
export function optimisticCreate<T extends { id: string }>(
  currentList: T[],
  newItem: T,
): { list: T[]; operation: OptimisticOperation<T> } {
  return {
    list: [newItem, ...currentList],
    operation: {
      id: newItem.id,
      type: 'create',
      data: newItem,
      previousData: null,
      appliedAt: Date.now(),
    },
  };
}

/**
 * Optimistically update an item in a list.
 */
export function optimisticUpdate<T extends { id: string }>(
  currentList: T[],
  itemId: string,
  updates: Partial<T>,
): { list: T[]; operation: OptimisticOperation<T> | null } {
  const index = currentList.findIndex((item) => item.id === itemId);
  if (index === -1) return { list: currentList, operation: null };

  const previousData = currentList[index];
  const updatedItem = { ...previousData, ...updates };
  const newList = [...currentList];
  newList[index] = updatedItem;

  return {
    list: newList,
    operation: {
      id: itemId,
      type: 'update',
      data: updates,
      previousData,
      appliedAt: Date.now(),
    },
  };
}

/**
 * Optimistically remove an item from a list.
 */
export function optimisticDelete<T extends { id: string }>(
  currentList: T[],
  itemId: string,
): { list: T[]; operation: OptimisticOperation<T> | null } {
  const item = currentList.find((i) => i.id === itemId);
  if (!item) return { list: currentList, operation: null };

  return {
    list: currentList.filter((i) => i.id !== itemId),
    operation: {
      id: itemId,
      type: 'delete',
      data: {},
      previousData: item,
      appliedAt: Date.now(),
    },
  };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Rollback an optimistic operation, restoring the previous state.
 */
export function rollbackOperation<T extends { id: string }>(
  currentList: T[],
  operation: OptimisticOperation<T>,
): T[] {
  switch (operation.type) {
    case 'create':
      // Remove the optimistically added item
      return currentList.filter((item) => item.id !== operation.id);

    case 'update':
      // Restore the previous version of the item
      if (!operation.previousData) return currentList;
      return currentList.map((item) =>
        item.id === operation.id ? operation.previousData! : item,
      );

    case 'delete':
      // Re-add the deleted item
      if (!operation.previousData) return currentList;
      return [...currentList, operation.previousData];

    default:
      return currentList;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile an optimistic create/update with the server-confirmed version.
 * Replaces the optimistic item with the server's authoritative version.
 */
export function reconcileWithServer<T extends { id: string }>(
  currentList: T[],
  optimisticId: string,
  serverItem: T,
): T[] {
  const exists = currentList.some((item) => item.id === optimisticId);
  if (exists) {
    return currentList.map((item) =>
      item.id === optimisticId ? serverItem : item,
    );
  }
  // If the optimistic item was removed (e.g., by a re-fetch), add the server item
  return [serverItem, ...currentList];
}
