import { RawCode, highlight } from "codehike/code"
import { CopyButton } from "@/app/build-your-agent/button"
import { callout } from "./annotations/callout"
import { MermaidDiagram } from "./mermaid-diagram"
import { ThemedPre } from "./themed-pre"

export async function Code({ codeblock }: { codeblock: RawCode }) {
  if (codeblock.lang === "mermaid") {
    return <MermaidDiagram chart={codeblock.value} />
  }

  const highlighted = await highlight(codeblock, "github-from-css")
  const isPrompt = !codeblock.lang || codeblock.lang === "text"
  const label = isPrompt ? "PROMPT" : codeblock.lang.toUpperCase()

  return (
    <div
      className={`prose-code-card${
        isPrompt ? " prose-code-card--prompt" : ""
      }`}
    >
      <div className="prose-code-card__header">
        <span className="prose-code-card__label">{label}</span>
        <CopyButton
          text={codeblock.value}
          className="prose-code-card__copy"
        />
      </div>
      <ThemedPre
        code={highlighted}
        handlers={[callout]}
        className="bg-transparent"
      />
    </div>
  )
}
