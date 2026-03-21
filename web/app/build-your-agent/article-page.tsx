/* eslint-disable react/jsx-key */

import { Block, CodeBlock, parseRoot } from "codehike/blocks"
import type { MDXProps } from "mdx/types.js"
import type { ReactElement } from "react"
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
import { tokenTransitions } from "../components/annotations/token-transitions"
import { CopyButton } from "./button"
import { mark } from "./mark"
import { focus } from "./focus"
import { LiveDemo } from "./livedemo"
import { callout } from "../components/annotations/callout"
import { ThemedPre } from "../components/themed-pre"
import { CodeStage } from "./code-stage"
import { SiteHeader } from "@/components/site-header"
import { HomeHero } from "@/components/hero"
import type { Locale } from "@/lib/i18n"

type MDXContent = (props: MDXProps) => ReactElement

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

export function BuildYourAgentArticlePage({
  content,
  locale,
}: {
  content: MDXContent
  locale: Locale
}) {
  const { intro, steps, outro } = parseRoot(content, Schema)

  return (
    <main className="site-shell scrolly-shell">
      <SiteHeader locale={locale} pathname="/build-your-agent" />

      <div className="scrolly-hero">
        <h1 className="article-title">{intro.title}</h1>
        <div className="journal-prose article-summary">
          {intro.children}
        </div>
      </div>
      <SelectionProvider className="scrolly-grid">
        <div className="scrolly-copy journal-prose">
          {steps.map((step, index) => (
            <Selectable
              key={index}
              index={index}
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
                  <Code codeblock={step.code} locale={locale} />
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

      <footer className="article-footer">
        <HomeHero locale={locale} />
      </footer>
    </main>
  )
}

async function Code({
  codeblock,
  locale,
}: {
  codeblock: RawCode
  locale: Locale
}) {
  const [light, dark] = await Promise.all([
    highlight(codeblock, "github-light"),
    highlight(codeblock, "github-dark"),
  ])

  return (
    <div className="scrolly-code">
      <div className="scrolly-code__meta">{dark.meta}</div>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        <LiveDemo
          code={dark.code}
          lang={dark.lang}
          locale={locale}
          meta={dark.meta}
        />
        <CopyButton text={dark.code} />
      </div>
      <ThemedPre
        light={light}
        dark={dark}
        handlers={[
          tokenTransitions,
          mark,
          focus,
          borderHandler,
          bgHandler,
          callout,
        ]}
        className="h-full bg-transparent pt-10"
      />
    </div>
  )
}
