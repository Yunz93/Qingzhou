import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractDesignProposal } from "@qingzhou/protocol";

const proposal = () => ({ schemaVersion: 1, itemId: randomUUID(), scopeId: randomUUID(), expectedPrdId: null,
  content: "完整设计", reason: "讨论结果", moduleChanges: [], questions: ["是否保留旧入口？"] });
const block = (value: unknown) => `\`\`\`qingzhou-design\n${JSON.stringify(value)}\n\`\`\``;
describe("structured design proposals", () => {
  it("extracts one typed proposal while preserving open questions", () => {
    const input = proposal(); expect(extractDesignProposal(`说明\n${block(input)}\n结束`)).toEqual(input);
    expect(extractDesignProposal("普通回复或未经标识的 JSON")).toBeNull();
  });
  it("rejects ambiguous proposals and malformed basis, content or JSON", () => {
    expect(() => extractDesignProposal(`${block(proposal())}\n${block(proposal())}`)).toThrow("一个");
    expect(() => extractDesignProposal(block({ ...proposal(), itemId: "wrong" }))).toThrow();
    expect(() => extractDesignProposal(block({ ...proposal(), content: " " }))).toThrow();
    expect(() => extractDesignProposal("```qingzhou-design\n{broken}\n```")).toThrow();
  });
});
