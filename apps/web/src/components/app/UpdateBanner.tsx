import { useEffect, useRef, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import { useUpdateStore } from "../../stores/update-store";
import { getDesktop } from "../../desktop-bridge";
import { UpdateProgressPanel } from "../settings/UpdateProgressPanel";

export function UpdateBanner() {
  const latest = useUpdateStore((state) => state.latest);
  const updateAvailable = useUpdateStore((state) => state.updateAvailable);
  const canUpdate = useUpdateStore((state) => state.canUpdate);
  const url = useUpdateStore((state) => state.url);
  const installing = useUpdateStore((state) => state.installing);
  const notice = useUpdateStore((state) => state.notice);
  const skippedUpdateVersion = useUpdateStore((state) => state.skippedUpdateVersion);
  const progress = useUpdateStore((state) => state.progress);
  const install = useUpdateStore((state) => state.install);
  const dismiss = useUpdateStore((state) => state.dismiss);
  const skipCurrent = useUpdateStore((state) => state.skipCurrent);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const skipped = Boolean(latest && skippedUpdateVersion === latest);
  const portableUrl = !canUpdate && getDesktop()?.platform === "win32" ? url : null;

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!updateAvailable || !(canUpdate || portableUrl) || !latest || skipped) return null;

  return (
    <div ref={rootRef} className="relative app-no-drag">
      <button
        type="button"
        className="pressable icon-btn text-accent"
        aria-label={`墨问 ${latest} 可用`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ArrowUpCircle size={15} />
        <span className="update-dot" />
      </button>
      {open ? (
        <div className="update-popover" role="status">
          {installing || notice ? (
            <>
              <p>{notice || "正在更新…"}</p>
              <UpdateProgressPanel progress={progress} version={latest} />
            </>
          ) : (
            <>
              <p>墨问 {latest} 可用</p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" className="pressable btn btn-ghost h-7" onClick={() => void skipCurrent()}>
                  忽略
                </button>
                <button type="button" className="pressable btn btn-ghost h-7" onClick={dismiss}>
                  稍后
                </button>
                {portableUrl ? (
                  <a className="pressable btn btn-primary h-7" href={portableUrl} target="_blank" rel="noreferrer">下载便携包</a>
                ) : (
                  <button type="button" className="pressable btn btn-primary h-7" onClick={() => void install()}>
                    更新并重启
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
