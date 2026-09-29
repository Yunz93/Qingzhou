export type Rejectable = {
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout> | null;
};

export function failPendingRequests(pending: Map<string, Rejectable>, error: Error): void {
  for (const item of pending.values()) {
    if (item.timer) clearTimeout(item.timer);
    item.reject(error);
  }
  pending.clear();
}
