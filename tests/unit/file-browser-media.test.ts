import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mediaKindForPath, mimeTypeForPath, previewProjectFile } from "../../apps/server/src/tasks/file-browser.ts";

describe("file browser media preview", () => {
  it("classifies common multimedia extensions", () => {
    expect(mediaKindForPath("a/b/c.svg")).toBe("image");
    expect(mediaKindForPath("shot.PNG")).toBe("image");
    expect(mediaKindForPath("clip.mp4")).toBe("video");
    expect(mediaKindForPath("note.mp3")).toBe("audio");
    expect(mediaKindForPath("readme.md")).toBeNull();
    expect(mimeTypeForPath("小鸡吃米.svg")).toBe("image/svg+xml");
    expect(mimeTypeForPath("photo.webp")).toBe("image/webp");
  });

  it("returns a data URL for SVG instead of dumping source as text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-media-svg-"));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="orange"/></svg>`;
    await writeFile(path.join(root, "小鸡吃米.svg"), svg, "utf8");
    const preview = await previewProjectFile("小鸡吃米.svg", root, [root]);
    expect(preview.kind).toBe("image");
    expect(preview.mimeType).toBe("image/svg+xml");
    expect(preview.dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(preview.dataUrl!.split(",")[1]!)).toContain("<circle");
    expect(preview.content).toBe("");
  });

  it("returns a base64 data URL for PNG and marks unknown binaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-media-bin-"));
    // Minimal PNG header bytes (not a real image, but enough for base64 preview path).
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await writeFile(path.join(root, "dot.png"), png);
    const image = await previewProjectFile("dot.png", root, [root]);
    expect(image.kind).toBe("image");
    expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);

    await writeFile(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 0, 0, 0, 9, 8, 7]));
    const binary = await previewProjectFile("blob.bin", root, [root]);
    expect(binary.kind).toBe("binary");
    expect(binary.content).toMatch(/二进制/);
  });

  it("still returns text previews for source files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-media-text-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "hi.ts"), "export const n = 1;\n", "utf8");
    const preview = await previewProjectFile("src/hi.ts", root, [root]);
    expect(preview.kind).toBe("text");
    expect(preview.content).toContain("export const n");
    expect(preview.language).toBe("ts");
  });
});
