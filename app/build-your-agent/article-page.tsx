/* eslint-disable react/jsx-key */

import { Block, CodeBlock, parseRoot } from "codehike/blocks"
import type { MDXProps } from "mdx/types.js"
import type { ReactElement } from "react"
import path from "node:path"
import { ArrowDownRight } from "lucide-react"
import { z } from "zod"
import {
  highlight,
  type HighlightedCode,
  type RawCode,
} from "codehike/code"
import {
  Selectable,
  SelectionProvider,
} from "codehike/utils/selection"
import { ChapterNav } from "./chapter-nav"
import { CodeStage } from "./code-stage"
import { ImageLightbox } from "./image-lightbox"
import { LlmSettingsPanel } from "./llm-settings-panel"
import { SiteHeader } from "@/components/site-header"
import { HomeHero } from "@/components/hero"
import type { Locale } from "@/lib/i18n"
import { buildChapterIndex } from "@/lib/tutorial-chapters"
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
  const { chapters, stepMeta } = buildChapterIndex(
    steps.map((step) => step.title),
  )
  const sharedFiles = await loadSharedCodeFiles(
    buildYourAgentSharedFiles,
    ARTICLE_DIR,
  )
  const preparedSharedFiles = await Promise.all(
    sharedFiles.map(async (file) => {
      // helper.js 不高亮：客户端会按用户的 LLM 设置改写它再展示。
      // helper.js is not highlighted: the client rewrites it with the user's LLM settings.
      const { highlightedCode: _unused, ...rest } = await prepareStageFile(file)
      return rest
    }),
  )
  const stageSteps = await Promise.all(
    steps.map(async (step) => {
      // 完整 runtimeCode 不随页面下发，打开 Live Demo 时再按需拉取。
      // Full runtimeCode is not sent with the page; Live Demo fetches it on demand.
      const { highlightedCode, runtimeCode: _unused, ...file } =
        await prepareStageFile(createPrimaryDisplayFile(step.code))
      return { file, highlightedCode }
    }),
  )

  return (
    <main className="site-shell scrolly-shell">
      <SiteHeader locale={locale} pathname="/build-your-agent" />

      <div className="scrolly-hero">
        <div className="scrolly-hero__eyebrow">
          <span className="scrolly-hero__pulse" aria-hidden="true" />
          <span>
            {`SYSTEMS LAB · ${chapters.length} CHAPTERS · ${steps.length} STEPS · PURE JS`}
          </span>
        </div>
        <h1 className="article-title">{intro.title}</h1>
        <div className="journal-prose article-summary">
          {intro.children}
        </div>
        <div className="scrolly-hero__actions">
          <a
            href={`#${chapters[0]?.id ?? "s00"}`}
            className="scrolly-hero__cta"
          >
            <span>{locale === "cn" ? "从 S00 开始" : "Start S00"}</span>
            <ArrowDownRight size={15} />
          </a>
          <div className="min-w-0 flex-1">
            <LlmSettingsPanel locale={locale} />
          </div>
        </div>
      </div>

      <SelectionProvider>
        <ChapterNav
          chapters={chapters}
          locale={locale}
          totalSteps={steps.length}
        />
        <div className="scrolly-grid">
          <div className="scrolly-copy journal-prose">
            {steps.map((step, index) => (
              <Selectable
                key={index}
                id={step.title ? stepMeta[index]?.chapterId : undefined}
                index={index}
                selectOn={["click", "scroll"]}
                className={`scrolly-step${
                  step.title ? " scrolly-step--chapter" : ""
                }`}
              >
                {step.title ? <h2>{step.title}</h2> : null}
                <div>{step.children}</div>
              </Selectable>
            ))}
          </div>
          <div className="scrolly-stage">
            <div className="scrolly-stage__stick">
              <div className="scrolly-stage__frame">
                <CodeStage
                  locale={locale}
                  sharedFiles={preparedSharedFiles}
                  stepMeta={stepMeta}
                  steps={stageSteps}
                />
              </div>
            </div>
          </div>
        </div>
      </SelectionProvider>
      <div className="journal-prose">
        {outro.title ? <h2>{outro.title}</h2> : null}
        {outro.children}
      </div>

      <footer className="article-footer">
        <HomeHero locale={locale} />
      </footer>
      <ImageLightbox label={locale === "cn" ? "关闭图片" : "Close image"} />
    </main>
  )
}

async function prepareStageFile(file: TutorialDisplayFile) {
  const base = {
    fileName: file.fileName,
    lang: file.lang,
    meta: file.meta,
    runtimeCode: file.runtimeValue,
  }

  if (
    file.fileName === "helper.js" ||
    !parseCodeMeta(file.meta, file.lang).range
  ) {
    return { ...base, copyText: file.displayValue, highlightedCode: null }
  }

  const highlighted = await highlight(
    { lang: file.lang, meta: file.meta, value: file.displayValue },
    "github-from-css",
  )

  // 只保留渲染需要的 tokens/annotations，复制文本由 tokens 还原，省掉重复字符串。
  // Keep only tokens/annotations; copy text is rebuilt from tokens to avoid duplicate strings.
  const highlightedCode: HighlightedCode = {
    annotations: highlighted.annotations,
    code: "",
    lang: highlighted.lang,
    meta: "",
    style: {},
    themeName: highlighted.themeName,
    tokens: highlighted.tokens,
    value: "",
  }

  return { ...base, highlightedCode }
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
