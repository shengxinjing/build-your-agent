import { Block, CodeBlock, parseRoot } from "codehike/blocks"
import { z } from "zod"
import {
  AnnotationHandler,
  Pre,
  RawCode,
  highlight,
} from "codehike/code"
import {
  Selection,
  Selectable,
  SelectionProvider,
} from "codehike/utils/selection"
import Content from "./content.mdx"
import Link from "next/link"
import { tokenTransitions } from "../components/annotations/token-transitions"
import { CopyButton } from "./button"
import { mark } from "./mark"
import { focus } from './focus'
import { LiveDemo } from "./livedemo"
import { callout } from "../components/annotations/callout"



const Schema = Block.extend({
  intro: Block,
  steps: z.array(Block.extend({ code: CodeBlock })),
  outro: Block,
})

const borderHandler: AnnotationHandler = {
  name: "border",
  Block: ({ annotation, children }) => {
    const borderColor = annotation.query || "red"
    return <div style={{ border: "1px solid", borderColor }}>{children}</div>
  },
}

const bgHandler: AnnotationHandler = {
  name: "bg",
  Inline: ({ annotation, children }) => {
    const background = annotation.query || "#2d26"
    return <span style={{ background }}>{children}</span>
  },
}

export default function Page() {
  const { intro, steps, outro } = parseRoot(Content, Schema)
  return (
    <main>
      <Link href="/">Back</Link>
      <h1 className="mt-8">{intro.title}</h1>
      {intro.children}
      <SelectionProvider className="flex gap-4">
        <div className="flex-1 mt-32 mb-[90vh] ml-2 prose prose-invert">
          {steps.map((step, i) => (
            <Selectable
              key={i}
              index={i}
              selectOn={["click", "scroll"]}
              className="border-l-4 border-zinc-700 data-[selected=true]:border-blue-400 px-5 py-2 mb-12 rounded bg-zinc-900"
            >
              <h2 className="mt-4 text-xl">{step.title}</h2>
              <div>{step.children}</div>
            </Selectable>
          ))}
        </div>
        <div className="w-[40vw] max-w-xl bg-zinc-900">
          <div className="top-4 sticky overflow-auto">
            <Selection
              from={steps.map((step) => (
                <Code codeblock={step.code} />
              ))}
            />
          </div>
        </div>
      </SelectionProvider>
      <h2>{outro.title}</h2>
      {outro.children}
    </main>
  )
}

async function Code({ codeblock }: { codeblock: RawCode }) {
  const highlighted = await highlight(codeblock, "github-dark")
  return (
    <div className="relative">
      <div className="text-center text-zinc-400 text-sm py-2 absolute top-0 w-full">
        {highlighted.meta}
      </div>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        <LiveDemo
          code={highlighted.code}
          lang={highlighted.lang}
          meta={highlighted.meta}
        />
        <CopyButton text={highlighted.code} />
      </div>
      <Pre
        code={highlighted}
        handlers={[tokenTransitions, mark, focus, borderHandler, bgHandler, callout]}
        className="min-h-[40rem] bg-transparent pt-10"
      />
    </div>
  )
}
