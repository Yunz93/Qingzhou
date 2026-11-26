import { z } from "zod";
import { isLiteralApiKey } from "./auth-status.js";
import { GeminiTargetChanged, officialGeminiUrl, readGeminiProfile } from "./gemini-target.js";
import { proxiedFetch } from "./http-proxy.js";
import { piAuthFile } from "./pi-agent-dir.js";
import { readPiAuthFile } from "./pi-auth-file.js";

const catalog = z.object({ models: z.array(z.object({ name: z.string().startsWith("models/") })).min(1) });
export class GeminiConnectionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function savedGeminiKey(agentDir: string, hasConfiguredKey: boolean): Promise<string> {
  const stored = (await readPiAuthFile(piAuthFile(agentDir))).google;
  const key = stored?.type === "api_key" ? stored.key : !stored && !hasConfiguredKey ? process.env.GEMINI_API_KEY : undefined;
  if (typeof key !== "string" || !isLiteralApiKey(key)) {
    throw new GeminiConnectionError(400, "请粘贴 Google AI Studio 的 API Key 再测试连接。");
  }
  return key;
}

/** Tests only access to the official catalog, without generating content or persisting the key. */
export async function testGeminiConnection(agentDir: string, draftKey?: string): Promise<void> {
  const { target, hasConfiguredKey } = await readGeminiProfile(agentDir);
  if (target.kind !== "official") throw new GeminiTargetChanged(target);
  const key = draftKey ?? await savedGeminiKey(agentDir, hasConfiguredKey);
  if (!isLiteralApiKey(key)) throw new GeminiConnectionError(400, "请粘贴完整的 Gemini API Key。");
  try {
    const response = await proxiedFetch(`${officialGeminiUrl}/models?pageSize=1`, {
      headers: { "x-goog-api-key": key },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      if (catalog.safeParse(await response.json()).success) return;
      throw new GeminiConnectionError(502, "Gemini 没有返回可读取的模型目录，请稍后重试。");
    }
    await response.body?.cancel();
    if ([400, 401, 403].includes(response.status)) {
      throw new GeminiConnectionError(400, "Google 拒绝了连接。请检查 API Key、项目权限和所在地区，再重试。");
    }
    if (response.status === 429) throw new GeminiConnectionError(429, "Gemini 请求受限，请检查项目配额或稍后重试。");
    throw new GeminiConnectionError(502, "Gemini 服务暂时无法读取模型目录，请稍后重试。");
  } catch (error) {
    if (error instanceof GeminiConnectionError) throw error;
    throw new GeminiConnectionError(502, "无法连接 Gemini。请检查网络和代理后重试。");
  }
}
