import { diffFromApproval, gitDiffBlocks, type DiffLine } from "@qingzhou/protocol";

type Props = {
  oldText?: string;
  newText?: string;
  content?: string;
  lines?: DiffLine[] | null;
  fallback?: string;
  /** Cursor-style review: line numbers, skip bars, full-bleed add/remove. */
  review?: boolean;
};

function lineClass(line: DiffLine): string {
  if (line.type === "add") return "bg-success/15 text-ink";
  if (line.type === "remove") return "bg-danger/15 text-ink";
  if (line.text.startsWith("@@")) return "bg-accent-soft text-accent";
  return "text-mute";
}

function reviewRowClass(type: DiffLine["type"]): string {
  if (type === "add") return "bg-success/18 text-ink";
  if (type === "remove") return "bg-danger/18 text-ink";
  return "text-ink";
}

function ReviewDiff({ lines }: { lines: DiffLine[] }) {
  const blocks = gitDiffBlocks(lines);
  const visible = blocks.length > 400 ? blocks.slice(0, 400) : blocks;
  return (
    <div className="overflow-x-auto rounded-md border border-line/80 bg-canvas font-mono text-[11px] leading-[1.55]">
      <div className="min-w-full w-max">{visible.map((block, index) =>
        block.kind === "skip" ? (
          <div
            key={`skip-${index}`}
            className="flex items-center gap-2 border-y border-line/70 bg-fill px-2 py-1 text-[11px] text-mute"
          >
            <span className="inline-block h-px min-w-3 flex-1 bg-line" />
            {block.count} 行未改
            <span className="inline-block h-px min-w-3 flex-1 bg-line" />
          </div>
        ) : (
          <div key={`${block.type}-${index}`} className={`flex ${reviewRowClass(block.type)}`}>
            <span className="w-8 shrink-0 select-none pr-1.5 text-right text-[10px] text-mute tabular">
              {block.lineNo ?? ""}
            </span>
            <span className="w-3 shrink-0 select-none text-center text-mute">
              {block.type === "add" ? "+" : block.type === "remove" ? "-" : ""}
            </span>
            <span className="flex-1 whitespace-pre px-1">{block.text || " "}</span>
          </div>
        ),
      )}
      {blocks.length > 400 ? <div className="px-2 py-1 text-mute">还有 {blocks.length - 400} 行</div> : null}</div>
    </div>
  );
}

export function DiffView({ oldText, newText, content, lines: provided, fallback, review }: Props) {
  const lines = provided ?? diffFromApproval({ oldText, newText, content });
  if (!lines || lines.length === 0) {
    return <p className="text-sm text-mute">{fallback ?? "还没有差异。"}</p>;
  }
  if (review) return <ReviewDiff lines={lines} />;
  const visible = lines.length > 200 ? lines.slice(0, 200) : lines;
  return (
    <pre className="overflow-auto rounded-md bg-canvas p-2 font-mono text-[11px] leading-5">
      {visible.map((line, index) => (
        <div key={`${line.type}-${index}`} className={lineClass(line)}>
          {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} {line.text}
        </div>
      ))}
      {lines.length > 200 ? <div className="text-mute">…还有 {lines.length - 200} 行</div> : null}
    </pre>
  );
}
