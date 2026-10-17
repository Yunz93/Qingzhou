import { describe, expect, it } from "vitest";
import { requirementProgress } from "../../apps/web/src/lib/workflow-progress";

const delivery = {
  scopeId: "scope-1", implementation: { scopeId: "scope-1", status: "finished" as const },
  valid: true, accepted: true, merged: true, hasDelivery: true,
};

describe("current requirement progress", () => {
  it("does not show an old merged delivery as progress on a revised scope", () => {
    expect(requirementProgress({ ...delivery, scopeId: "scope-2" })).toEqual({ stage: 0, canStart: true });
  });
  it.each(["queued", "running", "failed", "interrupted", "cancelled"] as const)("returns to implementation for a %s round", (status) => {
    expect(requirementProgress({ ...delivery, implementation: { scopeId: "scope-1", status } }))
      .toEqual({ stage: 0, canStart: !["running", "queued"].includes(status) });
  });
  it("keeps a settled round at verification until the actual delivery is valid", () => {
    expect(requirementProgress({ ...delivery, valid: false, accepted: false, merged: false }))
      .toEqual({ stage: 1, canStart: false });
  });
  it("separates checked, accepted and merged deliveries", () => {
    expect(requirementProgress({ ...delivery, accepted: false, merged: false }).stage).toBe(2);
    expect(requirementProgress({ ...delivery, merged: false }).stage).toBe(3);
    expect(requirementProgress(delivery).stage).toBe(4);
  });
});
