"use client"

import React from "react"
import { splitCodeWaveChildren } from "@/lib/code-wave"

type CodePanelContextValue = {
  setCode: (code: React.ReactNode | null) => void
}

const CodePanelContext = React.createContext<CodePanelContextValue | null>(null)

export function PostScrollyShell({
  children,
  initialCode,
}: {
  children: React.ReactNode
  initialCode?: {
    language: string
    code: string
  } | null
}) {
  const initialNode = initialCode ? (
    <pre data-language={initialCode.language}>
      <code>{initialCode.code}</code>
    </pre>
  ) : null

  const [activeCode, setActiveCode] = React.useState<React.ReactNode | null>(initialNode)

  return (
    <CodePanelContext.Provider value={{ setCode: setActiveCode }}>
      <div
        className="scrolly-layout"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "40px",
        }}
      >
        <aside
          className="scrolly-code-pane"
          style={{
            flex: "0 0 420px",
            position: "sticky",
            top: "24px",
            alignSelf: "flex-start",
          }}
        >
          <div className="scrolly-code-stick" style={{ width: "100%" }}>
            {activeCode ? (
              <div className="scrolly-code-frame">{activeCode}</div>
            ) : (
              <div className="scrolly-code-empty">
                <p className="scrolly-code-label">Code Panel</p>
                <p className="scrolly-code-help">
                  Scroll to the first <code>CodeWave</code> section to pin code here.
                </p>
              </div>
            )}
          </div>
        </aside>
        <div
          className="scrolly-doc-pane"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            maxWidth: "860px",
          }}
        >
          {children}
        </div>
      </div>
    </CodePanelContext.Provider>
  )
}

export function CodeWave({ children }: { children: React.ReactNode }) {
  const steps = React.useMemo(() => splitCodeWaveChildren(children), [children])

  return (
    <section className="code-wave-block">
      {steps.map((step, index) => (
        <CodeWaveStepSection key={step.id} code={step.code} isFirst={index === 0}>
          {step.content}
        </CodeWaveStepSection>
      ))}
    </section>
  )
}

function CodeWaveStepSection({
  code,
  children,
  isFirst,
}: {
  code: React.ReactNode
  children: React.ReactNode
  isFirst: boolean
}) {
  const ref = React.useRef<HTMLElement | null>(null)
  const context = React.useContext(CodePanelContext)

  React.useEffect(() => {
    if (!context || !ref.current) return

    const element = ref.current
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          context.setCode(code)
        }
      },
      {
        rootMargin: "-18% 0px -52% 0px",
        threshold: 0.1,
      }
    )

    observer.observe(element)

    if (isFirst) {
      context.setCode(code)
    }

    return () => observer.disconnect()
  }, [code, context, isFirst])

  return (
    <section ref={ref} className="code-wave-step">
      {children}
    </section>
  )
}
