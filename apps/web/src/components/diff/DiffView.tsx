import { useMemo, useState } from "react";
import { diffFromApproval, type DiffLine } from "@qingzhou/protocol";
import { splitDiffRows, type DiffCell } from "../../lib/split-diff";

type Props = {
  oldText?: string; newText?: string; content?: string; lines?: DiffLine[] | null;
  fallback?: string; review?: boolean; beforeLabel?: string; afterLabel?: string;
};

function Cell({ cell, side }: { cell: DiffCell | null; side: "before" | "after" }) {
  return <div className={`split-diff-cell${!cell ? " split-diff-blank" : cell.changed ? ` split-diff-${side}` : ""}`}>
    <span className="split-diff-number">{cell?.line ?? ""}</span>
    <span className="split-diff-sign" aria-hidden="true">{cell?.changed ? side === "before" ? "−" : "+" : ""}</span>
    <code>{cell?.text || " "}</code>
  </div>;
}

export function DiffView({ oldText, newText, content, lines: provided, fallback, beforeLabel = "修改前", afterLabel = "修改后" }: Props) {
  const rows = useMemo(() => splitDiffRows(provided ?? diffFromApproval({ oldText, newText, content }) ?? [], !!provided), [provided, oldText, newText, content]);
  const [limit, setLimit] = useState(400);
  if (!rows.length) return <p className="text-sm text-mute">{fallback ?? "还没有差异。"}</p>;
  return <section className="split-diff" aria-label="左右分屏差异">
    <div className="split-diff-scroll" tabIndex={0} role="region" aria-label="差异内容，可横向滚动">
      <div className="split-diff-table">
        <div className="split-diff-heading"><span>{beforeLabel}</span><span>{afterLabel}</span></div>
        {rows.slice(0, limit).map((row, index) => row.kind === "hunk"
          ? <div className="split-diff-hunk" key={index}>差异片段 · {row.text}</div>
          : <div className="split-diff-row" key={index}><Cell cell={row.before} side="before" /><Cell cell={row.after} side="after" /></div>)}
      </div>
    </div>
    {rows.length > limit ? <button className="btn btn-secondary mt-2" onClick={() => setLimit(limit + 400)}>继续显示 · 还有 {rows.length - limit} 行</button> : null}
  </section>;
}
