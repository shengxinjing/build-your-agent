import { RawCode, highlight } from "codehike/code"
import { callout } from "./annotations/callout"
import { ThemedPre } from "./themed-pre"

export async function Code({ codeblock }: { codeblock: RawCode }) {
  const [light, dark] = await Promise.all([
    highlight(codeblock, "github-light"),
    highlight(codeblock, "github-dark"),
  ])

  return (
    <ThemedPre
      light={light}
      dark={dark}
      handlers={[callout]}
      className="rounded-[24px] border border-[var(--code-line)] bg-transparent"
    />
  )
}
