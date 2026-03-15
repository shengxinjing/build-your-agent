import React from "react"

export type CodeWaveStep = {
  id: string
  code: React.ReactElement
  content: React.ReactNode[]
}

export type InitialCodeBlock = {
  language: string
  code: string
}

export function splitCodeWaveChildren(children: React.ReactNode): CodeWaveStep[] {
  const nodes = flattenChildren(children)
  const steps: CodeWaveStep[] = []
  let current: CodeWaveStep | null = null

  nodes.forEach((node, index) => {
    if (isCodeBlock(node)) {
      current = {
        id: `code-wave-step-${steps.length}-${index}`,
        code: node,
        content: [],
      }
      steps.push(current)
      return
    }

    if (current) {
      current.content.push(node)
    }
  })

  return steps
}

function isCodeBlock(node: React.ReactNode): node is React.ReactElement {
  if (!React.isValidElement(node)) return false
  if (node.type === "pre") return true

  const props = node.props as { children?: React.ReactNode } | undefined
  const childNodes = props?.children ? React.Children.toArray(props.children) : []

  return (
    childNodes.length > 0 &&
    childNodes.some((child) => React.isValidElement(child) && child.type === "pre")
  )
}

function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((node) => {
    if (React.isValidElement(node) && node.type === React.Fragment) {
      const props = node.props as { children?: React.ReactNode }
      return flattenChildren(props.children)
    }

    return [node]
  })
}

export function extractFirstCodeBlockFromSource(source: string): InitialCodeBlock | null {
  const waveMatch = source.match(/<CodeWave>([\s\S]*?)<\/CodeWave>/)
  if (!waveMatch) return null

  const fenceMatch = waveMatch[1]?.match(/```([^\n]*)\n([\s\S]*?)```/)
  if (!fenceMatch) return null

  const [, rawInfo, rawCode] = fenceMatch
  const language = rawInfo.trim().split(/\s+/)[0] || "txt"

  return {
    language,
    code: rawCode.trimEnd(),
  }
}
