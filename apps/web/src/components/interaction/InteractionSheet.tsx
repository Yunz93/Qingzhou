import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useRef, useState } from "react";
import type { InteractionRequest } from "@qingzhou/protocol";

type Props = {
  interaction: InteractionRequest;
  onRespond: (payload: { cancelled?: boolean; value?: string }) => void;
};

export function InteractionSheet({ interaction, onRespond }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogLayer(panelRef, () => onRespond({ cancelled: true }));
  const [value, setValue] = useState("");

  useEffect(() => {
    panelRef.current?.focus();
    setValue("");
  }, [interaction.requestId]);

  const title =
    interaction.title ??
    (interaction.method === "select" ? "请选择一项" : interaction.method === "input" ? "请输入" : "询问");

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="interaction-title"
      tabIndex={-1}
      data-testid="interaction-dialog"
      className="dialog-panel outline-none"
    >
      <div className="dialog-head">
        <div className="dialog-head-text">
          <h2 id="interaction-title" className="dialog-title">
            {title}
          </h2>
          {interaction.message ? <p className="dialog-copy">{interaction.message}</p> : null}
        </div>
      </div>
      <div className="dialog-body">
        {interaction.method === "select" ? (
          <ul className="max-h-64 space-y-1 overflow-auto">
            {(interaction.options ?? []).map((option) => (
              <li key={option}>
                <button
                  type="button"
                  className="pressable btn btn-ghost h-8 w-full justify-start px-3 text-left text-[13px]"
                  onClick={() => onRespond({ value: option })}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <label className="block">
            <span className="sr-only">{interaction.placeholder ?? "输入"}</span>
            <input
              autoFocus
              className="field w-full text-[13px] text-ink"
              value={value}
              placeholder={interaction.placeholder ?? "输入后确定"}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onRespond({ value });
                }
              }}
            />
          </label>
        )}
      </div>
      <div className="dialog-actions dialog-actions-split">
        <button type="button" className="pressable btn btn-ghost" onClick={() => onRespond({ cancelled: true })}>
          取消
        </button>
        {interaction.method === "input" ? (
          <button
            type="button"
            className="pressable btn btn-primary"
            disabled={!value.trim()}
            onClick={() => onRespond({ value })}
          >
            确定
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
