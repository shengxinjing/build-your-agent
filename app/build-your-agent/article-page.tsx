/* eslint-disable react/jsx-key */

import { Block, CodeBlock, parseRoot } from "codehike/blocks"
import type { MDXProps } from "mdx/types.js"
import type { ReactElement } from "react"
import path from "node:path"
import { z } from "zod"
import {
  highlight,
  type RawCode,
} from "codehike/code"
import {
  Selectable,
  SelectionProvider,
} from "codehike/utils/selection"
import { CodeStage } from "./code-stage"
import { LlmSettingsPanel } from "./llm-settings-panel"
import { SiteHeader } from "@/components/site-header"
import { HomeHero } from "@/components/hero"
import type { Locale } from "@/lib/i18n"
import {
  parseCodeMeta,
  sliceCodeByRange,
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
  const preparedSharedFiles = (
    await Promise.all(sharedFiles.map(prepareStageFile))
  ).map((file) => ({
    copyText: file.copyText,
    fileName: file.fileName,
    lang: file.lang,
    meta: file.meta,
    runtimeCode: file.runtimeCode,
  }))
  const stageSteps = await Promise.all(
    steps.map(async (step) => {
      const primaryFile = createPrimaryDisplayFile(step.code)
      const preparedFile = await prepareStageFile(primaryFile)

      return {
        entryFileName: primaryFile.fileName,
        files: [{
          copyText: preparedFile.copyText,
          fileName: preparedFile.fileName,
          lang: preparedFile.lang,
          meta: preparedFile.meta,
          runtimeCode: preparedFile.runtimeCode,
        }],
        highlightedCodes: [preparedFile.highlightedCode],
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
        <LlmSettingsPanel locale={locale} />
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
                highlightedCodes={stageSteps.map(
                  (step) => step.highlightedCodes,
                )}
                sharedFiles={preparedSharedFiles}
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
  if (file.fileName === "helper.js") {
    return {
      copyText: file.displayValue,
      fileName: file.fileName,
      lang: file.lang,
      meta: file.meta,
      highlightedCode: null,
      runtimeCode: file.runtimeValue,
    }
  }

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
      highlightedCode: { light, dark },
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
    displayValue: sliceCodeByRange(
      codeblock.value,
      parsedMeta.range,
    ),
    fileName: parsedMeta.fileName,
    lang: codeblock.lang,
    meta: codeblock.meta,
    runtimeValue: codeblock.value,
  } satisfies TutorialDisplayFile
}
