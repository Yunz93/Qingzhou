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
  it("keeps Markdown fences inside the serialized PRD intact", () => {
    const input = { ...proposal(), content: '# 方案\n\n```json\n{"version":1}\n```\n\n## 验收\n保留正文。' };
    expect(extractDesignProposal(block(input))).toEqual(input);
    expect(extractDesignProposal(block(input).replaceAll('\n', '\r\n'))).toEqual(input);
  });
  it("accepts a validated JSON proposal without adopting ordinary JSON examples", () => {
    const input = { ...proposal(), content: '数据示例：\n```json\n{"tasks":[]}\n```' };
    const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
    expect(extractDesignProposal(`${json({ version: 1, tasks: [] })}\n${json(input)}`)).toEqual(input);
    expect(extractDesignProposal(json({ version: 1, tasks: [] }))).toBeNull();
    expect(() => extractDesignProposal(json({ ...input, itemId: 'wrong' }))).toThrow();
    expect(() => extractDesignProposal(`${block(input)}\n${json(input)}`)).toThrow('一个');
    expect(() => extractDesignProposal(`\`\`\`json\n{"schemaVersion":1,"itemId":"${input.itemId}","scopeId":"${input.scopeId}","content":"未转义\n换行"}\n\`\`\``)).toThrow('格式无效');
  });
  it("recognizes longer Markdown fences without silently selecting a second proposal", () => {
    const input = proposal();
    const longer = `\`\`\`\`qingzhou-design\n${JSON.stringify(input)}\n\`\`\`\``;
    expect(extractDesignProposal(longer)).toEqual(input);
    expect(extractDesignProposal(`${longer}\``)).toEqual(input);
    expect(() => extractDesignProposal(`${longer}\n${block(input)}`)).toThrow("一个");
  });
  it("ignores protocol examples inside other fenced code blocks", () => {
    const example = `\`\`\`json\n${JSON.stringify(proposal())}\n\`\`\``;
    expect(extractDesignProposal(`\`\`\`\`markdown\n${example}\n\`\`\`\``)).toBeNull();
    expect(extractDesignProposal(`~~~markdown\n${example}\n~~~`)).toBeNull();
    expect(extractDesignProposal(`\`\`\`\`markdown\n${example}\n\`\`\`\`\n${block(proposal())}`)).not.toBeNull();
  });
  it("handles repeated unclosed fences without rescanning the remaining message", () => {
    const start = performance.now();
    expect(extractDesignProposal("```json\n{}\n".repeat(20_000))).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
