import path from "node:path";

export function systemTar(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== "win32") return "tar";
  // Git Bash can put GNU tar first on PATH. System tar supports ZIP and Windows drive letters.
  return path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
}
