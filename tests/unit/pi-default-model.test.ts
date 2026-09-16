import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readPiDefaultModel,
  readPiDefaultModelSync,
  writePiDefaultModel,
} from "../../apps/server/src/tasks/pi-default-model.ts";

describe("pi default model settings", () => {
  it("reads and writes defaultProvider/defaultModel without dropping other keys", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-default-model-"));
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify({ packages: ["npm:pi-web-access"] }, null, 2)}\n`,
      "utf8",
    );
    expect(readPiDefaultModelSync(agentDir)).toBeNull();
    const written = await writePiDefaultModel(agentDir, { provider: "openai", id: "gpt-5.4" });
    expect(written).toEqual({ provider: "openai", id: "gpt-5.4" });
    expect(await readPiDefaultModel(agentDir)).toEqual({ provider: "openai", id: "gpt-5.4" });
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")) as {
      packages: string[];
      defaultProvider: string;
      defaultModel: string;
    };
    expect(settings.packages).toEqual(["npm:pi-web-access"]);
    expect(settings.defaultProvider).toBe("openai");
    expect(settings.defaultModel).toBe("gpt-5.4");
  });

  it("parses provider/id packed into defaultModel", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-default-packed-"));
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify({ defaultModel: "google/gemini" }, null, 2)}\n`,
      "utf8",
    );
    expect(readPiDefaultModelSync(agentDir)).toEqual({ provider: "google", id: "gemini" });
  });
});
