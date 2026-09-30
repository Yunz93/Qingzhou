import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "@qingzhou/protocol";
import { AlertTriangle, Shield, ShieldAlert } from "lucide-react";
import { toolNameLabel } from "../../copy";
import { approvalRiskLabel, approvalRiskLevel, splitDangerousCommand } from "../../lib/approval-risk";
import { DiffView } from "../diff/DiffView";

type Props = {
  approval: ApprovalRequest;
  onRespond: (allow: boolean, remember: boolean) => void;
};

function heading(toolName: string): string {
  if (toolName === "write" || toolName === "edit") return "允许修改文件吗？";
  if (toolName === "bash") return "允许运行这条命令吗？";
  return `允许${toolNameLabel(toolName)}吗？`;
}

export function ApprovalSheet({ approval, onRespond }: Props) {
  const [remember, setRemember] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogLayer(panelRef, () => onRespond(false, false));
  const expiresAt = Date.parse(approval.expiresAt);
  const totalMs = useRef(Math.max(1, expiresAt - Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, expiresAt - now);
  const seconds = Math.ceil(remaining / 1000);
  const progress = Math.max(0, Math.min(1, remaining / totalMs.current));
  const hasDiff = Boolean(approval.oldText || approval.newText || approval.content);
  const level = approvalRiskLevel(approval);
  const command = approval.rawCommand ?? approval.target;
  const commandParts = approval.toolName === "bash" ? splitDangerousCommand(command) : null;
  const RiskIcon = level === "high" ? ShieldAlert : level === "medium" ? AlertTriangle : Shield;

  useEffect(() => {
    panelRef.current?.focus();
  }, [approval.requestId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [approval.requestId]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      tabIndex={-1}
      className="dialog-panel dialog-panel-lg outline-none"
    >
      <div className="dialog-head">
        <div className="dialog-head-text">
          <h2 id="approval-title" className="dialog-title">
            {heading(approval.toolName)}
          </h2>
          <p className={`approval-risk approval-risk-${level}`}>
            <RiskIcon size={13} />
            {approvalRiskLabel(level)}
            {approval.risk ? <span className="text-mute"> · {approval.risk}</span> : null}
          </p>
          <p className="sr-only" aria-live="polite">
            {remaining <= 0 ? "确认已超时" : `还剩 ${seconds} 秒`}
          </p>
        </div>
      </div>
      <div className="dialog-body">
        <dl className="space-y-3 text-xs text-ink">
          <div>
            <dt className="text-mute">工作文件夹</dt>
            <dd className="mt-1 break-all font-mono text-[12px]">{approval.cwd || "—"}</dd>
          </div>
          <div>
            <dt className="text-mute">{approval.toolName === "bash" ? "命令" : "目标"}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-all font-mono text-[12px]">
              {commandParts
                ? commandParts.map((part, index) => (
                    <span key={`${part.text}-${index}`} className={part.danger ? "approval-danger" : undefined}>
                      {part.text}
                    </span>
                  ))
                : command}
            </dd>
          </div>
        </dl>
        {hasDiff ? (
          <div className="mt-3">
            <p className="mb-1 text-[12px] text-mute">将要写入的内容</p>
            <DiffView oldText={approval.oldText} newText={approval.newText} content={approval.content} />
          </div>
        ) : null}
      </div>
      <div className="dialog-actions dialog-actions-split">
        <label className="approval-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          记住这次
        </label>
        <div className="flex flex-1 items-center justify-end gap-2">
          <button type="button" className="pressable btn btn-danger" onClick={() => onRespond(false, false)}>
            拒绝
          </button>
          <button
            type="button"
            className="pressable btn btn-primary approval-allow"
            aria-label="允许这次"
            disabled={remaining <= 0}
            onClick={() => onRespond(true, remember)}
          >
            <span className="approval-allow-progress" style={{ transform: `scaleX(${progress})` }} />
            <span className="relative">{remaining <= 0 ? "已超时" : `允许这次 · ${seconds}s`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
