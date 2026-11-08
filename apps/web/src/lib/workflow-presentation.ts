import type { Verification } from "@qingzhou/protocol";

export const workflowError = (error: unknown) => error instanceof Error ? error.message : String(error);
export const workflowDate = (value: string) => new Date(value).toLocaleString("zh-CN");
export const checkLabels: Record<Verification["status"], string> = {
  queued: "等待验证名额", running: "验证中", passed: "必需检查通过", failed: "验证失败", unverified: "未验证", interrupted: "验证中断",
};
