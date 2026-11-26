import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GeminiTarget } from "@qingzhou/protocol";
import { z } from "zod";

export const officialGeminiUrl = "https://generativelanguage.googleapis.com/v1beta";
const signingKey = randomBytes(32);
const endpointConfig = z.object({ baseUrl: z.string().optional() });
const googleConfig = endpointConfig.extend({ models: z.array(endpointConfig).optional(), apiKey: z.string().optional() });
const modelsConfig = z.object({ providers: z.object({ google: googleConfig.optional() }).optional() });

export type GeminiProfile = { target: GeminiTarget; hasConfiguredKey: boolean };

export class GeminiTargetChanged extends Error {
  constructor(readonly target: GeminiTarget) {
    super(target.kind === "unavailable" ? "无法确定 Gemini 的请求地址，请检查 models.json 后重试。"
      : target.kind === "custom" ? "Gemini 使用自定义服务。请核对当前接收方并确认后保存。"
        : "Gemini 已切换至 Google 官方服务。请核对后重新保存。");
  }
}

export async function readGeminiProfile(agentDir: string): Promise<GeminiProfile> {
  let google: z.infer<typeof googleConfig> | undefined;
  try {
    const raw = await readFile(path.join(agentDir, "models.json"), "utf8");
    google = modelsConfig.parse(JSON.parse(raw.replace(/^\uFEFF/, ""))).providers?.google;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { target: { kind: "unavailable" }, hasConfiguredKey: false };
  }
  const baseUrl = google?.baseUrl ?? officialGeminiUrl;
  const addresses = [...new Set([baseUrl, ...(google?.models ?? []).map((model) => model.baseUrl ?? baseUrl)])].sort();
  const hasConfiguredKey = Boolean(google?.apiKey);
  if (addresses.every((address) => address === officialGeminiUrl || address === officialGeminiUrl + "/")) {
    return { target: { kind: "official" }, hasConfiguredKey };
  }
  const origins = new Set<string>();
  for (const address of addresses) {
    const url = URL.canParse(address) ? new URL(address) : null;
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return { target: { kind: "unavailable" }, hasConfiguredKey };
    origins.add(url.origin);
  }
  // Paths, URL credentials and queries can contain secrets. Only origins leave
  // this process, with an opaque version that also changes for edits on one host.
  const revision = createHmac("sha256", signingKey).update(JSON.stringify(addresses)).digest("hex");
  return { target: { kind: "custom", origins: [...origins].sort(), revision }, hasConfiguredKey };
}

export async function verifyGeminiSaveTarget(agentDir: string, confirmedRevision?: string): Promise<void> {
  const { target } = await readGeminiProfile(agentDir);
  if (target.kind === "official" && confirmedRevision === undefined) return;
  if (target.kind === "custom" && confirmedRevision === target.revision) return;
  throw new GeminiTargetChanged(target);
}
