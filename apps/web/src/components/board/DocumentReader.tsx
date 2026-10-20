import { AssistantMarkdown } from "../timeline/AssistantMarkdown";

export function DocumentReader({ children }: { children: string }) {
  return <article className="workflow-document-reader"><AssistantMarkdown text={children} /></article>;
}
