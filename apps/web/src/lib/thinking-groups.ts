import type { TimelineMessage } from "@qingzhou/protocol";

export function groupThinkingMessages(messages: TimelineMessage[]): Array<TimelineMessage | TimelineMessage[]> {
  const rows: Array<TimelineMessage | TimelineMessage[]> = [];
  let pending: TimelineMessage[] = [];
  function flush() {
    if (pending.length) rows.push(pending.length === 1 ? pending[0]! : pending);
    pending = [];
  }
  for (const message of messages) {
    if (message.role === "assistant" && !message.text.trim() && message.thinking && !message.streaming && !message.images?.length) pending.push(message);
    else { flush(); rows.push(message); }
  }
  flush();
  return rows;
}
