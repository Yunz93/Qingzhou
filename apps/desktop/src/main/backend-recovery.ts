/** Coalesce recovery clicks and leave a healthy backend alone. */
export function createBackendRecovery(check: () => Promise<boolean>, start: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      if (!(await check())) await start();
    })().finally(() => { pending = null; });
    return pending;
  };
}

export async function isBackendListening(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok || (await response.json() as { ok?: boolean }).ok !== true) {
      throw new Error("本地服务健康检查失败，请检查服务日志。");
    }
    return true;
  } catch (error) {
    // A slow or invalid response is not proof the server is dead. Do not kill
    // ongoing work merely because a health check timed out.
    if ((error as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") return false;
    throw error;
  }
}
