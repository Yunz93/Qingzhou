import { z } from "zod";

const relativePath = (limit: number, message: string) => z.string().trim().min(1, "目录不能为空").max(limit, message).refine((value) => !value.startsWith("/") && !value.includes("\\") && !/^[A-Za-z]:/.test(value)
  && Array.from(value).every((character) => character.charCodeAt(0) >= 32)
  && value.split("/").every((part) => !!part && part !== "." && part !== ".." && part.toLowerCase() !== ".git"), "请填写项目内的相对目录");
const directory = relativePath(240, "目录不能超过 240 个字符");
const file = relativePath(1024, "文档路径不能超过 1024 个字符");
export const documentPathsSchema = z.object({ prds: directory, modules: directory }).refine(({ prds, modules }) => {
  const a = prds.toLowerCase(), b = modules.toLowerCase();
  return a !== b && !a.startsWith(`${b}/`) && !b.startsWith(`${a}/`);
}, "PRD 与模块目录不能相同或相互嵌套");
export type DocumentPaths = z.infer<typeof documentPathsSchema>;
export const DEFAULT_DOCUMENT_PATHS: DocumentPaths = { prds: "docs/requirements", modules: "docs/modules" };
export const documentSourceSchema = z.object({ path: file, revisionPath: file, workspacePath: file.optional(), hash: z.string().regex(/^[a-f0-9]{64}$/) });
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export type DocumentInspection = {
  paths: DocumentPaths;
  files: Array<{ source: string; path: string; status: "ready" | "present" | "conflict"; message?: string }>;
};
