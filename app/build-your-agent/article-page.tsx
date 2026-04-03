/* eslint-disable react/jsx-key */

import { Block, CodeBlock, parseRoot } from "codehike/blocks"
import type { MDXProps } from "mdx/types.js"
import type { ReactElement } from "react"
import path from "node:path"
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
import { mark } from "./mark"
import { focus } from "./focus"
import { callout } from "../components/annotations/callout"
import { ThemedPre } from "../components/themed-pre"
import { CodeStage } from "./code-stage"
import { SiteHeader } from "@/components/site-header"
import { HomeHero } from "@/components/hero"
import type { Locale } from "@/lib/i18n"
import {
  mergeDisplayFiles,
  parseCodeMeta,
  type TutorialDisplayFile,
} from "@/lib/tutorial-files"
import { loadSharedCodeFiles } from "@/lib/tutorial-files-server"
import { buildYourAgentSharedFiles } from "./shared-files"

type MDXContent = (props: MDXProps) => ReactElement

const Schema = Block.extend({
  intro: Block,
  steps: z.array(Block.extend({ code: CodeBlock })),
  outro: Block,
})

const ARTICLE_DIR = path.join(
  process.cwd(),
  "app/build-your-agent",
)

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

export async function BuildYourAgentArticlePage({
  content,
  locale,
}: {
  content: MDXContent
  locale: Locale
}) {
  const { intro, steps, outro } = parseRoot(content, Schema)
  const sharedFiles = await loadSharedCodeFiles(
    buildYourAgentSharedFiles,
    ARTICLE_DIR,
  )
  const stageSteps = await Promise.all(
    steps.map(async (step) => {
      const primaryFile = createPrimaryDisplayFile(step.code)
      const mergedFiles = mergeDisplayFiles(
        primaryFile,
        sharedFiles,
      )
      const preparedFiles = await Promise.all(
        mergedFiles.map((file) =>
          prepareStageFile(file),
        ),
      )

      return {
        entryFileName: primaryFile.fileName,
        files: preparedFiles.map((file) => ({
          copyText: file.copyText,
          fileName: file.fileName,
          lang: file.lang,
          meta: file.meta,
          runtimeCode: file.runtimeCode,
        })),
        animatedRenders: preparedFiles.map(
          (file) => file.animatedRender,
        ),
        staticRenders: preparedFiles.map(
          (file) => file.staticRender,
        ),
      }
    }),
  )

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
                locale={locale}
                animatedRenders={stageSteps.map(
                  (step) => step.animatedRenders,
                )}
                staticRenders={stageSteps.map(
                  (step) => step.staticRenders,
                )}
                steps={stageSteps.map((step) => ({
                  entryFileName: step.entryFileName,
                  files: step.files,
                }))}
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

async function prepareStageFile(
  file: TutorialDisplayFile,
) {
  const [light, dark] = await Promise.all([
    highlight(
      {
        lang: file.lang,
        meta: file.meta,
        value: file.displayValue,
      },
      "github-light",
    ),
    highlight(
      {
        lang: file.lang,
        meta: file.meta,
        value: file.displayValue,
      },
      "github-dark",
    ),
  ])

  return (
    {
      copyText: dark.code,
      fileName: file.fileName,
      lang: dark.lang,
      meta: dark.meta,
      animatedRender: (
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
      ),
      staticRender: (
        <ThemedPre
          light={light}
          dark={dark}
          handlers={[
            mark,
            focus,
            borderHandler,
            bgHandler,
            callout,
          ]}
          className="h-full bg-transparent pt-10"
        />
      ),
      runtimeCode: file.runtimeValue,
    }
  )
}

function createPrimaryDisplayFile(codeblock: RawCode) {
  const parsedMeta = parseCodeMeta(
    codeblock.meta,
    codeblock.lang,
  )

  return {
    displayValue: codeblock.value,
    fileName: parsedMeta.fileName,
    lang: codeblock.lang,
    meta: codeblock.meta,
    runtimeValue: codeblock.value,
  } satisfies TutorialDisplayFile
}
