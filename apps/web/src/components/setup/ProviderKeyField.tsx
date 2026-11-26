import { useEffect, useId, useRef, useState } from "react";
import { geminiTargetSchema, type GeminiTarget } from "@qingzhou/protocol";
import { ArrowUpRight } from "lucide-react";
import "./connection.css";
import { getDesktop } from "../../desktop-bridge";
import type { AuthCatalogItem, AuthEntryLike } from "../../lib/settings-auth";

const GEMINI_KEYS_URL = "https://aistudio.google.com/apikey";

type Props = {
  provider: AuthCatalogItem;
  entry?: AuthEntryLike;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  target?: GeminiTarget;
  confirmedTarget?: string;
  onConfirm: (revision?: string) => void;
  onTargetChange: (target: GeminiTarget) => void;
};

export function ProviderKeyField({ provider, entry, value, onChange, disabled, target, confirmedTarget, onConfirm, onTargetChange }: Props) {
  const id = useId();
  const request = useRef<AbortController | null>(null);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [linkError, setLinkError] = useState(false);
  const gemini = provider.id === "google";
  const official = gemini && target?.kind === "official";
  const key = value.trim();
  const incomplete = Boolean(key) && key.length < 8;
  const canUseStored = entry && (entry.source === undefined || entry.source === "auth_file" || entry.source === "env");

  useEffect(() => {
    setNotice(null);
    setTesting(false);
    return () => request.current?.abort();
  }, [value, entry?.source, provider.id, target?.kind]);

  async function checkGemini() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/setup/test-gemini", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(key ? { apiKey: key } : {}),
        signal: controller.signal,
      });
      const result = await response.json() as { ok?: boolean; error?: string; geminiTarget?: unknown };
      if (controller.signal.aborted) return;
      if (!response.ok || result.ok !== true) {
        const current = geminiTargetSchema.safeParse(result.geminiTarget);
        if (current.success) onTargetChange(current.data);
        setNotice({ ok: false, message: result.error || "连接测试失败，请重试。" });
      } else {
        setNotice({ ok: true, message: "已连接，可读取 Gemini 模型目录。" });
      }
    } catch {
      if (!controller.signal.aborted) setNotice({ ok: false, message: "无法完成测试，请检查网络后重试。" });
    } finally {
      if (!controller.signal.aborted) setTesting(false);
    }
  }

  return (
    <div className="provider-key-field">
      <div className="provider-key-label">
        <label htmlFor={id}><span className="sr-only">{provider.label} </span>API Key</label>
        {official ? <a className="provider-key-link" href={GEMINI_KEYS_URL} target="_blank" rel="noopener noreferrer" onClick={(event) => {
          const desktop = getDesktop();
          if (!desktop?.openExternal) return;
          event.preventDefault();
          setLinkError(false);
          void desktop.openExternal(GEMINI_KEYS_URL).catch(() => setLinkError(true));
        }}>从 AI Studio 获取密钥 <ArrowUpRight size={13} aria-hidden="true" /></a> : null}
      </div>
      {linkError ? <p role="alert" className="text-xs text-danger">系统浏览器未能打开，你可以直接访问 aistudio.google.com/apikey。</p> : null}
      <input id={id} aria-describedby={incomplete ? id + "-hint" : undefined} className="field w-full font-mono text-sm" type="password" autoComplete="off"
        autoCapitalize="none" spellCheck={false} disabled={disabled} value={value}
        placeholder={entry?.kind === "api_key" && entry.source === "auth_file" ? "粘贴新的密钥以替换" : "粘贴 API Key"}
        onChange={(event) => onChange(event.target.value)} />
      {incomplete ? <p className="text-xs text-mute" id={id + "-hint"}>请粘贴完整的 API Key，至少需要 8 个字符。</p> : null}
      {gemini && target?.kind === "custom" ? <div className="provider-key-destination">
        <p>对话会向下列服务发送密钥和消息</p>
        <ul aria-label="Gemini 请求接收方">{target.origins.map((origin) => <li key={origin}><bdi>{origin}</bdi></li>)}</ul>
        <label><input type="checkbox" disabled={disabled} checked={confirmedTarget === target.revision}
          onChange={(event) => onConfirm(event.target.checked ? target.revision : undefined)} />我确认将密钥用于上述服务</label>
      </div> : null}
      {gemini && (!target || target.kind === "unavailable") ? <p className="text-xs text-danger" role="alert">暂时无法确定请求接收方。请检查 models.json，然后重新打开设置。</p> : null}
      {official ? <div className="provider-key-help">
        <span>密钥保存在本机。测试会向 Google 请求模型目录。</span>
        <button className="pressable provider-key-test" type="button" disabled={disabled || testing || (key ? key.length < 8 : !canUseStored)}
          onClick={() => void checkGemini()}>{testing ? "正在测试…" : "测试连接"}</button>
      </div> : null}
      {notice ? <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "text-xs text-success" : "text-xs text-danger"}>{notice.message}</p> : null}
    </div>
  );
}
