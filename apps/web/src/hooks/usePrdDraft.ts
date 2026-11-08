import { useEffect, useRef, useState } from "react";
import type { RequirementPrd } from "@qingzhou/protocol";
import { applySavedPrd, backupPrdDraft, followPrdRevision, isSavedPrdDraft, parsePrdDraft, readPrdDraftCache, savedPrdDraft, writePrdDraftCache, type PrdDraft } from "../lib/prd-draft";

export function usePrdDraft(key: string, initial: PrdDraft, prd: RequirementPrd | undefined, revisions: RequirementPrd[]) {
  const load = () => {
    let raw: string | null = null;
    try {
      raw = readPrdDraftCache(key);
      const cached = raw === null ? null : parsePrdDraft(raw);
      const draft = !cached || isSavedPrdDraft(raw!, revisions) ? initial : cached;
      return { draft, recovery: null as { raw: string | null } | null };
    } catch { return { draft: initial, recovery: { raw } }; }
  };
  const [state, setState] = useState(load);
  const [storageError, setStorageError] = useState("");
  const previous = useRef(prd ? savedPrdDraft(prd) : initial);
  useEffect(() => {
    if (!prd || previous.current.expectedPrdId === prd.id) return;
    const before = previous.current;
    previous.current = savedPrdDraft(prd);
    setState(current => ({ ...current, draft: followPrdRevision(current.draft, before, prd) }));
  }, [prd]);
  useEffect(() => {
    if (state.recovery) return;
    const saved = writePrdDraftCache(key, JSON.stringify(state.draft));
    setStorageError(saved ? "" : "本地草稿暂时无法保存，当前输入仍保留；请保存 PRD 后再离开。");
  }, [key, state.draft, state.recovery]);

  const replace = (draft: PrdDraft) => setState(current => ({ ...current, draft }));
  const patch = (value: Partial<PrdDraft>) => setState(current => ({ ...current, draft: { ...current.draft, ...value } }));
  const saved = (submitted: PrdDraft, result: RequirementPrd) => setState(current => ({ ...current, draft: applySavedPrd(current.draft, submitted, result) }));
  const reload = () => { setStorageError(""); setState(load()); };
  const recover = () => {
    if (state.recovery?.raw === null) { reload(); return; }
    if (!state.recovery) return;
    try {
      backupPrdDraft(key, state.recovery.raw);
      setStorageError(""); setState({ draft: initial, recovery: null });
    } catch { setStorageError("未能保留恢复副本，请重新读取或稍后重试；原始草稿保持不变。"); }
  };
  return { draft: state.draft, recovery: state.recovery, storageError, patch, replace, saved, recover, reload };
}
