#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

if (process.argv.includes("--version")) {
  process.stdout.write("0.0.0-fake\n");
  process.exit(0);
}

const args = process.argv.slice(2);
let sessionPath = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--session" && args[i + 1]) {
    sessionPath = args[i + 1];
  }
  if (args[i] === "--session-dir" && args[i + 1]) {
    sessionPath = path.join(args[i + 1], "fake-session.json");
  }
}

const MODELS = [
  { id: "fake-model", name: "Fake Model", provider: "fake", reasoning: true },
  {
    id: "fake-model-2",
    name: "Fake Model 2",
    provider: "fake",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      max: "max",
    },
  },
];

const state = {
  model: { ...MODELS[0] },
  thinkingLevel: "off",
  isStreaming: false,
  sessionFile: sessionPath,
  sessionId: "fake-session",
  messageCount: 0,
  pendingMessageCount: 0,
  messages: [],
  followUps: [],
  aborted: false,
  generationStamp: Date.now(),
  autoCompactionEnabled: true,
  autoRetryEnabled: true,
  fastModeEnabled: false,
  fastModeActive: false,
  steering: [],
};

function loadSessionMessages(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (parsed?.message && parsed.message.role) messages.push(parsed.message);
    else if (parsed?.role) messages.push(parsed);
  }
  return messages;
}

if (sessionPath) {
  try {
    state.messages = loadSessionMessages(sessionPath);
  } catch {
    state.messages = [];
  }
}

function thinkingLevelsFor(model) {
  if (!model?.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  const all = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const extended = new Set(["xhigh", "max"]);
  return all.filter((level) => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (extended.has(level)) return mapped !== undefined;
    return true;
  });
}

function persist() {
  if (!sessionPath) return;
  mkdirSync(path.dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(state.messages, null, 2));
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function respond(id, command, success, data, error) {
  const body = { id, type: "response", command, success };
  if (data !== undefined) body.data = data;
  if (error) body.error = error;
  send(body);
}

function now() {
  return Date.now();
}

const waiters = new Map();

function waitForUiResponse(id) {
  return new Promise((resolve) => {
    waiters.set(id, resolve);
  });
}

async function streamText(text, options = {}) {
  send({
    type: "message_start",
    message: {
      role: "assistant",
      content: [],
      timestamp: now(),
    },
  });
  send({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  const parts = options.chunkSize ? text.match(new RegExp(`[\\s\\S]{1,${options.chunkSize}}`, "g")) ?? [] : text.split(" ");
  const delayMs = options.delayMs ?? (text.includes("stream this slowly") ? 200 : 40);
  let acc = "";
  for (const part of parts) {
    if (state.aborted) break;
    const delta = options.chunkSize || !acc ? part : ` ${part}`;
    acc += delta;
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta } });
    await new Promise((r) => setTimeout(r, delayMs));
  }
  send({
    type: "message_update",
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: acc },
  });
  const message = { role: "assistant", content: [{ type: "text", text: acc }], timestamp: now() };
  send({ type: "message_end", message });
  state.messages.push(message);
  persist();
}

async function renderConversationDemo(failure = false) {
  let timestamp = now();
  for (const thinking of ["先分清需求、现有实现和验证依据。", "把结论与执行记录分开，保留完整过程供查阅。"]) {
    const message = { role: "assistant", content: [{ type: "thinking", thinking }], timestamp: ++timestamp };
    send({ type: "message_start", message });
    send({ type: "message_end", message });
    state.messages.push(message);
  }
  for (let index = 0; index < 2; index++) {
    const toolCallId = `render-read-${++timestamp}`;
    const target = index ? "src/conversation/renderer.tsx" : "docs/modules/conversation.md";
    send({ type: "tool_execution_start", toolCallId, toolName: "read", args: { path: target } });
    await new Promise((resolve) => setTimeout(resolve, failure && index ? 1000 : 40));
    const isError = failure && index === 1;
    const content = [{ type: "text", text: isError ? "读取失败：文件暂不可用，原始输出仍可查看。" : `已读取 ${target}\n${"文件内容与上下文。".repeat(12)}` }];
    send({ type: "tool_execution_end", toolCallId, toolName: "read", result: { content }, isError });
    const message = { role: "toolResult", toolCallId, toolName: "read", content, isError, timestamp: ++timestamp };
    send({ type: "message_end", message });
    state.messages.push(message);
  }
  if (failure) { await streamText("有一份文件读取失败，请先检查该文件，已有记录保留。"); return; }
  const response = [
    "## 阅读结论", "", "正文应该有清晰的阅读节奏。**先看结论**，再看方案，执行细节按需展开。", "",
    "这是另一个段落。切换内容主题时保留间距，避免把所有信息挤成一块。", "",
    "### 实施方案", "", "1. 区分正文、思考记录与工具结果。", "2. 生成过程中也显示标题、列表和代码。", "",
    "```typescript", "const greeting = '你好，轻舟';", "console.log(greeting);", "```", "",
    "> 检查通过与人工确认是两个不同的步骤。", "",
    "| 内容 | 展示方式 |", "| --- | --- |", "| 正文 | 分段阅读 |", "| 执行记录 | 按需展开 |", "",
    "- 第一项说明有独立的行距。", "- 第二项包含一段较长的路径：`src/conversation/a-very-long-module-name/another-long-directory/conversation-renderer.tsx`。", "",
    "- [x] 保留完整内容", "- [ ] 等待确认", "",
    "<script>window.__markdownInjected = true</script>", "",
    "[不安全链接](javascript:alert(1))", "",
    "### 回归验证", "", "分别检查桌面、深色和手机布局。生成结束后，正文沿用同一套排版，复制仍保留原始内容。",
  ].join("\n");
  await streamText(response, { chunkSize: 24, delayMs: 70 });
}

async function runWrite(filePath, content) {
  const toolCallId = `call-write-${now()}`;
  send({
    type: "message_start",
    message: { role: "assistant", content: [], timestamp: now() },
  });
  send({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { type: "toolCall", id: toolCallId, name: "write", arguments: { path: filePath, content } },
    },
  });
  send({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: "write", arguments: { path: filePath, content } }],
      timestamp: now(),
    },
  });
  send({ type: "tool_execution_start", toolCallId, toolName: "write", args: { path: filePath, content } });
  const requestId = `ui-${now()}`;
  const payload = {
    kind: "qingzhou.approval",
    toolName: "write",
    toolCallId,
    cwd: process.cwd(),
    target: filePath,
    risk: "This writes to the project filesystem. Review the path before allowing.",
  };
  send({
    type: "extension_ui_request",
    id: requestId,
    method: "confirm",
    title: "Allow write?",
    message: `Path:\n${filePath}\nWorking directory:\n${process.cwd()}\n${payload.risk}\n\nQINGZHOU_APPROVAL_V1\n${JSON.stringify(payload)}`,
  });
  const response = await waitForUiResponse(requestId);
  const allowed = Boolean(response.confirmed) && !response.cancelled;
  if (allowed) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    send({
      type: "tool_execution_end",
      toolCallId,
      toolName: "write",
      result: { content: [{ type: "text", text: `Wrote ${filePath}` }] },
      isError: false,
    });
  } else {
    send({
      type: "tool_execution_end",
      toolCallId,
      toolName: "write",
      result: { content: [{ type: "text", text: "Denied by user or timed out" }] },
      isError: true,
    });
  }
}

async function runBash(command) {
  const toolCallId = `call-bash-${now()}`;
  send({ type: "tool_execution_start", toolCallId, toolName: "bash", args: { command } });
  const requestId = `ui-${now()}`;
  const payload = {
    kind: "qingzhou.approval",
    toolName: "bash",
    toolCallId,
    cwd: process.cwd(),
    target: command,
    rawCommand: command,
    risk: "This command runs with your user privileges. Qingzhou does not try to guess whether Bash is safe.",
  };
  send({
    type: "extension_ui_request",
    id: requestId,
    method: "confirm",
    title: "Allow bash?",
    message: `Command:\n${command}\nWorking directory:\n${process.cwd()}\n${payload.risk}\n\nQINGZHOU_APPROVAL_V1\n${JSON.stringify(payload)}`,
  });
  const response = await waitForUiResponse(requestId);
  const allowed = Boolean(response.confirmed) && !response.cancelled;
  send({
    type: "tool_execution_end",
    toolCallId,
    toolName: "bash",
    result: {
      content: [{ type: "text", text: allowed ? `ran: ${command}` : "Denied by user or timed out" }],
    },
    isError: !allowed,
  });
}

async function runSelect(options) {
  const requestId = `ui-${now()}`;
  send({
    type: "extension_ui_request",
    id: requestId,
    method: "select",
    title: "Choose",
    message: "Pick one",
    options,
  });
  const response = await waitForUiResponse(requestId);
  const value = response.cancelled ? "(cancelled)" : String(response.value ?? "");
  await streamText(`Selected: ${value}`);
}

async function runInput(placeholder) {
  const requestId = `ui-${now()}`;
  send({
    type: "extension_ui_request",
    id: requestId,
    method: "input",
    title: "Enter a value",
    placeholder: placeholder || "Type here",
  });
  const response = await waitForUiResponse(requestId);
  const value = response.cancelled ? "(cancelled)" : String(response.value ?? "");
  await streamText(`Input: ${value}`);
}

async function runNotify(message) {
  const requestId = `ui-${now()}`;
  send({
    type: "extension_ui_request",
    id: requestId,
    method: "notify",
    title: "Notice",
    message,
    notifyType: "info",
  });
  await waitForUiResponse(requestId);
  await streamText(`Notified: ${message}`);
}

async function handlePrompt(message, mode) {
  state.aborted = false;
  state.isStreaming = true;
  send({ type: "agent_start" });
  send({ type: "turn_start" });
  const user = { role: "user", content: [{ type: "text", text: message }], timestamp: now() };
  send({ type: "message_start", message: user });
  send({ type: "message_end", message: user });
  state.messages.push(user);

  if (message.trim() === "CRASH") {
    process.exit(1);
  }

  try {
    if (message.trim() === "RENDER_CONVERSATION" || message.trim() === "RENDER_TOOL_FAILURE") {
      await renderConversationDemo(message.trim() === "RENDER_TOOL_FAILURE");
      return;
    }
    if (message.trim() === "FAIL429") {
      send({
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: now() },
      });
      process.stderr.write("HTTP 429 Too Many Requests: rate_limit_error\n");
      send({
        type: "auto_retry_end",
        success: false,
        attempt: 1,
        finalError: { type: "rate_limit_error", message: "Request would exceed rate limit" },
      });
      send({
        type: "message_end",
        message: { role: "assistant", content: [], timestamp: now() },
      });
      return;
    }
    if (message.trim() === "FAIL401") {
      send({
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: now() },
      });
      process.stderr.write("HTTP 401 Unauthorized: authentication_error invalid x-api-key\n");
      send({
        type: "auto_retry_end",
        success: false,
        attempt: 1,
        finalError: "HTTP 401 Unauthorized",
      });
      send({
        type: "message_end",
        message: { role: "assistant", content: [], timestamp: now() },
      });
      return;
    }
    if (message.includes("STRUCTURED_DESIGN") && message.includes("qingzhou-design")) {
      const itemId = message.match(/itemId:"([a-f0-9-]+)"/)?.[1];
      const scopeId = message.match(/scopeId:"([a-f0-9-]+)"/)?.[1];
      const expected = message.match(/expectedPrdId:(null|"[a-f0-9-]+")/)?.[1];
      await streamText("结构化设计建议\n```qingzhou-design\n" + JSON.stringify({ schemaVersion: 1, itemId, scopeId, expectedPrdId: JSON.parse(expected || "null"), content: "# 结构化方案\n明确目标、错误路径及回归标准。", reason: "讨论后形成完整设计", moduleChanges: [], questions: ["是否保留原入口？"] }) + "\n```");
      return;
    }
    const writeAt = message.indexOf("WRITE:");
    const bashAt = message.indexOf("BASH:");
    const selectAt = message.indexOf("SELECT:");
    const inputAt = message.indexOf("INPUT:");
    const notifyAt = message.indexOf("NOTIFY:");
    if (selectAt >= 0) {
      const options = message
        .slice(selectAt + "SELECT:".length)
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
      await runSelect(options);
    } else if (inputAt >= 0) {
      await runInput(message.slice(inputAt + "INPUT:".length).trim());
    } else if (notifyAt >= 0) {
      await runNotify(message.slice(notifyAt + "NOTIFY:".length).trim());
    } else if (writeAt >= 0) {
      const rest = message.slice(writeAt + "WRITE:".length);
      const split = rest.indexOf(":");
      const filePath = rest.slice(0, split);
      const content = rest.slice(split + 1);
      await runWrite(filePath, content);
    } else if (bashAt >= 0) {
      await runBash(message.slice(bashAt + "BASH:".length));
    } else {
      const prefix = mode === "steer" ? "Steered: " : mode === "follow_up" ? "Follow-up: " : "Echo: ";
      await streamText(`${prefix}${message}`);
    }
  } finally {
    send({ type: "turn_end", message: { role: "assistant", content: [] }, toolResults: [] });
    send({ type: "agent_end", messages: state.messages, willRetry: false });
    send({ type: "agent_settled" });
    state.isStreaming = false;
    persist();
    const queued = state.followUps.splice(0);
    state.steering = [];
    state.pendingMessageCount = 0;
    send({ type: "queue_update", steering: [], followUp: [] });
    for (const queuedMessage of queued) {
      enqueuePrompt(queuedMessage, "follow_up");
    }
  }
}

let promptChain = Promise.resolve();

function enqueuePrompt(message, mode) {
  promptChain = promptChain.then(
    () => handlePrompt(message, mode),
    () => handlePrompt(message, mode),
  );
}

function handleLine(line) {
  if (!line.trim()) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (parsed.type === "extension_ui_response") {
    const waiter = waiters.get(parsed.id);
    if (waiter) {
      waiters.delete(parsed.id);
      waiter(parsed);
    }
    return;
  }

  const id = parsed.id;
  const type = parsed.type;
  switch (type) {
    case "get_state":
      respond(id, type, true, {
        model: state.model,
        thinkingLevel: state.thinkingLevel,
        isStreaming: state.isStreaming,
        isCompacting: false,
        steeringMode: "one-at-a-time",
        followUpMode: "one-at-a-time",
        sessionFile: state.sessionFile,
        sessionId: state.sessionId,
        autoCompactionEnabled: state.autoCompactionEnabled,
        autoRetryEnabled: state.autoRetryEnabled,
        fastModeEnabled: state.fastModeEnabled,
        fastModeActive: state.fastModeActive,
        messageCount: state.messages.length,
        pendingMessageCount: state.followUps.length,
      });
      break;
    case "get_messages":
      respond(id, type, true, { messages: state.messages });
      break;
    case "get_available_models":
      respond(id, type, true, { models: MODELS });
      break;
    case "get_available_thinking_levels":
      respond(id, type, true, { levels: thinkingLevelsFor(state.model) });
      break;
    case "set_model": {
      const previous = state.model;
      const found = MODELS.find((model) => model.provider === parsed.provider && model.id === parsed.modelId);
      state.model = found
        ? { ...found }
        : { ...state.model, provider: parsed.provider, id: parsed.modelId, name: parsed.modelId };
      const nextLevels = thinkingLevelsFor(state.model);
      if (!nextLevels.includes(state.thinkingLevel)) state.thinkingLevel = nextLevels[0] ?? "off";
      state.messages.push({
        role: "model_change",
        provider: state.model.provider,
        modelId: state.model.id,
        model: `${state.model.provider}/${state.model.id}`,
        previousModel: `${previous.provider}/${previous.id}`,
        content: [],
        timestamp: now(),
      });
      persist();
      respond(id, type, true, state.model);
      break;
    }
    case "set_thinking_level":
      state.thinkingLevel = parsed.level;
      respond(id, type, true);
      break;
    case "prompt":
      respond(id, type, true);
      enqueuePrompt(parsed.message, "prompt");
      break;
    case "steer":
      respond(id, type, true);
      state.steering = [parsed.message];
      send({ type: "queue_update", steering: [...state.steering], followUp: [...state.followUps] });
      enqueuePrompt(parsed.message, "steer");
      break;
    case "follow_up":
      respond(id, type, true);
      if (state.isStreaming) {
        state.followUps.push(parsed.message);
        state.pendingMessageCount = state.followUps.length;
        send({ type: "queue_update", steering: [...state.steering], followUp: [...state.followUps] });
      } else {
        state.followUps.push(parsed.message);
        state.pendingMessageCount = state.followUps.length;
        send({ type: "queue_update", steering: [], followUp: [...state.followUps] });
      }
      break;
    case "clear_queue": {
      const queued = { steering: [...state.steering], followUp: [...state.followUps] };
      state.steering = [];
      state.followUps = [];
      state.pendingMessageCount = 0;
      send({ type: "queue_update", steering: [], followUp: [] });
      respond(id, type, true, queued);
      break;
    }
    case "abort":
      state.aborted = true;
      respond(id, type, true);
      break;
    case "compact":
      respond(id, type, true, { summary: "compacted", tokensBefore: 100, estimatedTokensAfter: 40 });
      break;
    case "get_commands":
      respond(id, type, true, {
        commands: [
          { name: "skill:review", description: "Review the current change", source: "skill" },
        ],
      });
      break;
    case "get_fork_messages":
      respond(id, type, true, {
        messages: state.messages
          .filter((item) => item.role === "user")
          .map((item, index) => ({
            entryId: `user-${index}`,
            text: Array.isArray(item.content)
              ? item.content.map((block) => block.text ?? "").join("")
              : String(item.content ?? ""),
          })),
      });
      break;
    case "fork": {
      const messages = state.messages
        .filter((item) => item.role === "user")
        .map((item, index) => ({
          entryId: `user-${index}`,
          item,
        }));
      const match = messages.find((item) => item.entryId === parsed.entryId);
      if (!match) {
        respond(id, type, false, undefined, "Unknown fork entry");
        break;
      }
      const cut = state.messages.indexOf(match.item);
      state.messages = cut >= 0 ? state.messages.slice(0, cut + 1) : state.messages;
      persist();
      respond(id, type, true, { text: match.item.content?.[0]?.text ?? "", cancelled: false });
      break;
    }
    case "get_tree": {
      const tree = [];
      let parentId = null;
      let leafId = null;
      for (let index = 0; index < state.messages.length; index += 1) {
        const message = state.messages[index];
        const isModelChange = message.role === "model_change";
        const nodeId = `${isModelChange ? "model" : message.role === "user" ? "user" : "asst"}-${index}`;
        const node = {
          entry: isModelChange
            ? {
                type: "model_change",
                id: nodeId,
                parentId,
                provider: message.provider,
                modelId: message.modelId,
                model: message.model,
                message,
              }
            : { type: "message", id: nodeId, parentId, message },
          children: [],
        };
        if (tree.length === 0) tree.push(node);
        else {
          let cursor = tree[0];
          while (cursor.children[0]) cursor = cursor.children[0];
          cursor.children.push(node);
        }
        parentId = nodeId;
        leafId = nodeId;
      }
      respond(id, type, true, { tree, leafId });
      break;
    }
    case "export_html": {
      const out = sessionPath ? `${sessionPath}.html` : path.join(process.cwd(), "fake-session.html");
      writeFileSync(out, `<html><body>${state.messages.length} messages</body></html>`);
      respond(id, type, true, { path: out });
      break;
    }
    case "set_auto_compaction":
      state.autoCompactionEnabled = Boolean(parsed.enabled);
      respond(id, type, true);
      break;
    case "set_auto_retry":
      state.autoRetryEnabled = Boolean(parsed.enabled);
      respond(id, type, true);
      break;
    case "set_fast_mode":
      state.fastModeEnabled = Boolean(parsed.enabled);
      state.fastModeActive = Boolean(parsed.enabled);
      respond(id, type, true, { enabled: state.fastModeEnabled, active: state.fastModeActive });
      break;
    case "get_session_stats":
      respond(id, type, true, {
        sessionFile: state.sessionFile,
        sessionId: state.sessionId,
        userMessages: state.messages.filter((m) => m.role === "user").length,
        assistantMessages: state.messages.filter((m) => m.role === "assistant").length,
        toolCalls: 0,
        totalMessages: state.messages.length,
        tokens: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, total: 20 },
        cost: 0.0012,
        contextUsage: { tokens: 20, contextWindow: 100000, percent: 1 },
      });
      break;
    case "reload_skills":
      respond(id, type, true, { ok: true });
      break;
    default:
      respond(id, type, false, undefined, `Unknown command: ${type}`);
  }
}

const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx === -1) break;
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    handleLine(line);
  }
});

process.stdin.on("end", () => {
  buffer += decoder.end();
  if (buffer) handleLine(buffer);
});
