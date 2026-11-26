import { createHash } from "node:crypto";
import {
  sanitizeToolResultText,
  type TimelineImage,
  type TimelineMessage,
  type ToolExecution,
} from "@qingzhou/protocol";

const MAX_IMAGE_DATA_URL = 1_500_000;
import { redactSecrets } from "../security/redact.js";
import { extractErrorText, humanizeUserFacingError } from "../setup/pi-agent-dir.js";
import type { RpcEvent } from "./rpc-client.js";
import {
  createModelChangeNotice,
  modelChangeNoticeId,
  modelKeyFromRecord,
  previousModelKeyFromRecord,
  resolveModelLabel,
} from "../tasks/model-change.js";

export type NormalizedPiEvent =
  | { kind: "status"; streaming: boolean; settled?: boolean }
  | { kind: "message.started"; message: TimelineMessage }
  | { kind: "message.delta"; messageId: string; field: "text" | "thinking"; delta: string }
  | { kind: "message.completed"; message: TimelineMessage; error?: string }
  | { kind: "tool.started"; tool: ToolExecution }
  | { kind: "tool.updated"; tool: Partial<ToolExecution> & { toolCallId: string } }
  | { kind: "tool.completed"; tool: Partial<ToolExecution> & { toolCallId: string } }
  | {
      kind: "approval.ui";
      requestId: string;
      method: string;
      title?: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      notifyType?: "info" | "warning" | "error";
    }
  | { kind: "extension_error"; error: string }
  | { kind: "agent_error"; error: string }
  | { kind: "runtime.compaction"; phase: "start" | "end"; reason?: string }
  | {
      kind: "runtime.retry";
      phase: "start" | "end";
      attempt?: number;
      maxAttempts?: number;
      error?: string;
    }
  | { kind: "runtime.queue"; steering: string[]; followUp: string[] }
  | { kind: "ignored" };

function nowIso(timestamp?: number): string {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("");
}

function imagesFromContent(content: unknown): TimelineImage[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images: TimelineImage[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type !== "image") continue;
    const mimeType = typeof record.mimeType === "string" && record.mimeType ? record.mimeType : "image/png";
    const name = typeof record.name === "string" ? record.name : undefined;
    let dataUrl: string | undefined;
    if (typeof record.dataUrl === "string" && record.dataUrl) {
      dataUrl = record.dataUrl;
    } else if (typeof record.url === "string" && record.url) {
      dataUrl = record.url;
    } else if (typeof record.data === "string" && record.data) {
      dataUrl = record.data.startsWith("data:") ? record.data : `data:${mimeType};base64,${record.data}`;
    }
    if (dataUrl && dataUrl.length > MAX_IMAGE_DATA_URL) dataUrl = undefined;
    if (!dataUrl && !name) continue;
    images.push({ mimeType, name, ...(dataUrl ? { dataUrl } : {}) });
  }
  return images.length > 0 ? images : undefined;
}

function thinkingFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "thinking" && typeof record.thinking === "string") {
      parts.push(record.thinking);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function messageIdFor(role: string, timestamp: unknown, extra: string): string {
  const stableExtra = role === "assistant" ? "" : extra;
  return createHash("sha1").update(`${role}:${String(timestamp)}:${stableExtra}`).digest("hex").slice(0, 16);
}

function assistantFailure(message: Record<string, unknown>): string | undefined {
  if (message.role !== "assistant" || message.stopReason !== "error") return undefined;
  return redactSecrets(humanizeUserFacingError(extractErrorText(message.errorMessage) || "模型请求失败，请重试。"));
}

function timelineFromPiMessage(
  message: Record<string, unknown>,
  streaming: boolean,
  failure = assistantFailure(message),
): TimelineMessage | null {
  const role = String(message.role ?? message.type ?? "assistant");
  if (role === "model_change") {
    const createdAt = nowIso(typeof message.timestamp === "number" ? message.timestamp : undefined);
    const existing = textFromContent(message.content).trim();
    if (existing && /模型已/.test(existing)) {
      return {
        id: modelChangeNoticeId(messageIdFor("system", message.timestamp, existing.slice(0, 24))),
        role: "system",
        text: existing,
        createdAt,
        streaming: false,
      };
    }
    const from = resolveModelLabel(previousModelKeyFromRecord(message));
    const to = resolveModelLabel(modelKeyFromRecord(message));
    return createModelChangeNotice(messageIdFor("system", message.timestamp, `${from}->${to}`), from, to, createdAt);
  }
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;
  const content = textFromContent(message.content);
  const id = messageIdFor(role, message.timestamp, content.slice(0, 24));
  return {
    id,
    role,
    text: failure ? [content, failure].filter(Boolean).join("\n\n") : content,
    thinking: thinkingFromContent(message.content),
    createdAt: nowIso(typeof message.timestamp === "number" ? message.timestamp : undefined),
    streaming: streaming && role === "assistant",
    toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
    toolName: typeof message.toolName === "string" ? message.toolName : undefined,
    isError: Boolean(failure || message.isError),
    images: imagesFromContent(message.content),
  };
}

function targetFromArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  if (toolName === "bash" && typeof record.command === "string") return record.command;
  if (typeof record.path === "string") return record.path;
  return undefined;
}

export function resultTextFromPi(result: unknown): string {
  if (!result) return "";
  let raw = "";
  if (typeof result === "string") raw = result;
  else if (typeof result !== "object") raw = String(result);
  else {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.content)) raw = textFromContent(record.content);
    else if (typeof record.text === "string") raw = record.text;
  }
  return sanitizeToolResultText(raw);
}

export function normalizePiEvent(event: RpcEvent): NormalizedPiEvent {
  switch (event.type) {
    case "agent_start":
      return { kind: "status", streaming: true };
    case "agent_settled":
      return { kind: "status", streaming: false, settled: true };
    case "message_start": {
      const message = event.message as Record<string, unknown> | undefined;
      if (!message) return { kind: "ignored" };
      const timeline = timelineFromPiMessage(message, true);
      if (!timeline) return { kind: "ignored" };
      return { kind: "message.started", message: timeline };
    }
    case "message_update": {
      const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (!delta || typeof delta.type !== "string") return { kind: "ignored" };
      if (delta.type === "text_delta" && typeof delta.delta === "string") {
        return { kind: "message.delta", messageId: "assistant-live", field: "text", delta: delta.delta };
      }
      if (delta.type === "thinking_delta" && typeof delta.delta === "string") {
        return {
          kind: "message.delta",
          messageId: "assistant-live",
          field: "thinking",
          delta: delta.delta,
        };
      }
      return { kind: "ignored" };
    }
    case "message_end": {
      const message = event.message as Record<string, unknown> | undefined;
      if (!message) return { kind: "ignored" };
      const error = assistantFailure(message);
      const timeline = timelineFromPiMessage(message, false, error);
      if (!timeline) return { kind: "ignored" };
      return { kind: "message.completed", message: timeline, ...(error ? { error } : {}) };
    }
    case "tool_execution_start": {
      const toolCallId = String(event.toolCallId ?? "");
      const toolName = String(event.toolName ?? "tool");
      return {
        kind: "tool.started",
        tool: {
          toolCallId,
          toolName,
          target: targetFromArgs(toolName, event.args),
          args: event.args,
          status: "running",
          startedAt: nowIso(),
        },
      };
    }
    case "tool_execution_update": {
      const toolCallId = String(event.toolCallId ?? "");
      return {
        kind: "tool.updated",
        tool: {
          toolCallId,
          resultText: resultTextFromPi(event.partialResult),
          status: "running",
        },
      };
    }
    case "tool_execution_end": {
      const toolCallId = String(event.toolCallId ?? "");
      const isError = Boolean(event.isError);
      const text = resultTextFromPi(event.result);
      const blocked = /block|denied|timed out|not allowed/i.test(text);
      return {
        kind: "tool.completed",
        tool: {
          toolCallId,
          resultText: text,
          isError,
          status: isError ? (blocked ? "blocked" : "failed") : "succeeded",
          endedAt: nowIso(),
        },
      };
    }
    case "extension_ui_request": {
      const options = Array.isArray(event.options)
        ? event.options.map((item) => String(item)).filter(Boolean)
        : undefined;
      const notifyType =
        event.notifyType === "warning" || event.notifyType === "error" || event.notifyType === "info"
          ? event.notifyType
          : undefined;
      return {
        kind: "approval.ui",
        requestId: String(event.id ?? ""),
        method: String(event.method ?? ""),
        title: typeof event.title === "string" ? event.title : undefined,
        message: typeof event.message === "string" ? event.message : undefined,
        options: options && options.length > 0 ? options : undefined,
        placeholder: typeof event.placeholder === "string" ? event.placeholder : undefined,
        notifyType,
      };
    }
    case "extension_error":
      return { kind: "extension_error", error: extractErrorText(event.error) || "Extension error" };
    case "error":
    case "agent_error":
    case "turn_error":
      return {
        kind: "agent_error",
        error:
          extractErrorText(event.error) ||
          extractErrorText(event.message) ||
          extractErrorText(event.errorMessage) ||
          "Pi error",
      };
    case "compaction_start":
      return {
        kind: "runtime.compaction",
        phase: "start",
        reason: typeof event.reason === "string" ? event.reason : undefined,
      };
    case "compaction_end":
      return {
        kind: "runtime.compaction",
        phase: "end",
        reason: typeof event.reason === "string" ? event.reason : undefined,
      };
    case "auto_retry_start":
      return {
        kind: "runtime.retry",
        phase: "start",
        attempt: typeof event.attempt === "number" ? event.attempt : undefined,
        maxAttempts: typeof event.maxAttempts === "number" ? event.maxAttempts : undefined,
        error:
          extractErrorText(event.errorMessage) ||
          extractErrorText(event.error) ||
          extractErrorText(event.message) ||
          undefined,
      };
    case "auto_retry_end": {
      const finalError =
        extractErrorText(event.finalError) ||
        extractErrorText(event.error) ||
        extractErrorText(event.errorMessage) ||
        extractErrorText(event.message);
      return {
        kind: "runtime.retry",
        phase: "end",
        attempt: typeof event.attempt === "number" ? event.attempt : undefined,
        error: finalError || undefined,
      };
    }
    case "queue_update":
      return {
        kind: "runtime.queue",
        steering: Array.isArray(event.steering) ? event.steering.map((item) => String(item)) : [],
        followUp: Array.isArray(event.followUp) ? event.followUp.map((item) => String(item)) : [],
      };
    default:
      return { kind: "ignored" };
  }
}

export function piMessagesToTimeline(messages: unknown[]): TimelineMessage[] {
  const out: TimelineMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const timeline = timelineFromPiMessage(item as Record<string, unknown>, false);
    if (timeline) out.push(timeline);
  }
  return out;
}
