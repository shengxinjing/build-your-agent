import React, { type ReactNode } from "react"
import { compileMDX } from "next-mdx-remote/rsc"
import rehypePrettyCode from "rehype-pretty-code"
import { splitCodeWaveChildren } from "@/lib/code-wave"

function StaticCodeWave({ children }: { children: ReactNode }) {
  const steps = splitCodeWaveChildren(children)

  return (
    <section className="code-wave-block">
      {steps.map((step) => (
        <section key={step.id} className="code-wave-step">
          {step.content}
        </section>
      ))}
    </section>
  )
}

export async function renderMdx(source: string) {
  return compileMDX({
    source,
    components: {
      CodeWave: StaticCodeWave,
      Note: ({ children }: { children: ReactNode }) => (
        <aside className="note">{children}</aside>
      ),
    },
    options: {
      mdxOptions: {
        rehypePlugins: [[rehypePrettyCode, { theme: "github-dark-default" }]],
      },
    },
  })
}
