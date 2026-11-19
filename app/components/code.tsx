import { RawCode, highlight } from "codehike/code"
import { callout } from "./annotations/callout"
import { MermaidDiagram } from "./mermaid-diagram"
import { ThemedPre } from "./themed-pre"

export async function Code({ codeblock }: { codeblock: RawCode }) {
  if (codeblock.lang === "mermaid") {
    return <MermaidDiagram chart={codeblock.value} />
  }

  const highlighted = await highlight(codeblock, "github-from-css")

  return (
    <ThemedPre
      code={highlighted}
      handlers={[callout]}
      className="rounded-[24px] border border-[var(--code-line)] bg-transparent"
    />
  )
}
