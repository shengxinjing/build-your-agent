/* eslint-disable react/jsx-key */

import { Block, CodeBlock, parseRoot } from "codehike/blocks"
import { z } from "zod"
import {
  AnnotationHandler,
  RawCode,
  highlight,
} from "codehike/code"
import {
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
import { ThemedPre } from "../components/themed-pre"
import { CodeStage } from "./code-stage"
import { SiteHeader } from "@/components/site-header"



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
    <main className="site-shell scrolly-shell">
      <SiteHeader />

      <div className="scrolly-hero">
        {/* <Link href="/" className="back-link">
          Back
        </Link> */}
        <h1 className="article-title">{intro.title}</h1>
        <div className="journal-prose article-summary">
          {intro.children}
        </div>
      </div>
      <SelectionProvider className="scrolly-grid">
        <div className="scrolly-copy journal-prose">
          {steps.map((step, i) => (
            <Selectable
              key={i}
              index={i}
              selectOn={["click", "scroll"]}
              className="scrolly-step"
            >
              <h2>{step.title}</h2>
              <div>{step.children}</div>
            </Selectable>
          ))}
        </div>
        <div className="scrolly-stage">
          <div className="scrolly-stage__stick">
            <div className="scrolly-stage__frame">
              <CodeStage
                from={steps.map((step) => (
                  <Code codeblock={step.code} />
                ))}
              />
            </div>
          </div>
        </div>
      </SelectionProvider>
      <div className="journal-prose">
        <h2>{outro.title}</h2>
        {outro.children}
      </div>
    </main>
  )
}

async function Code({ codeblock }: { codeblock: RawCode }) {
  const [light, dark] = await Promise.all([
    highlight(codeblock, "github-light"),
    highlight(codeblock, "github-dark"),
  ])

  return (
    <div className="scrolly-code">
      <div className="scrolly-code__meta">
        {dark.meta}
      </div>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        <LiveDemo
          code={dark.code}
          lang={dark.lang}
          meta={dark.meta}
        />
        <CopyButton text={dark.code} />
      </div>
      <ThemedPre
        light={light}
        dark={dark}
        handlers={[tokenTransitions, mark, focus, borderHandler, bgHandler, callout]}
        className="h-full bg-transparent pt-10"
      />
    </div>
  )
}
