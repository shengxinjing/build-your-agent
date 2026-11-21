const STEP_SECTION = "博客代码演进"

export function applyAgentPatch(source, patch, { maxChangedLines = 10 } = {}) {
  const hunks = parseHunks(patch)
  const changedLines = hunks.flat().filter((line) => /^[+-]/.test(line)).length

  if (changedLines > maxChangedLines) {
    throw new Error(`${changedLines} changed lines; the limit is ${maxChangedLines}`)
  }

  const normalized = source.replaceAll("\r\n", "\n")
  const sourceLines = normalized.split("\n").map((value) => ({ value, focus: false }))

  for (const hunk of hunks) {
    const before = []

    for (const line of hunk) {
      const marker = line[0]
      const value = line.slice(1)
      if (marker === " " || marker === "-") before.push(value)
      if (!" +-".includes(marker)) {
        throw new Error(`Invalid agent-step line: ${line}`)
      }
    }

    const matches = findMatches(sourceLines.map((line) => line.value), before)
    if (matches.length !== 1) {
      throw new Error(`Agent step must match exactly once; found ${matches.length}`)
    }

    let sourceOffset = 0
    let removedBefore = false
    const after = hunk.flatMap((line) => {
      const marker = line[0]
      if (marker === "-") {
        sourceOffset += 1
        removedBefore = true
        return []
      }
      if (marker === " ") {
        const existingLine = sourceLines[matches[0] + sourceOffset]
        sourceOffset += 1
        if (removedBefore) existingLine.removalAnchor = true
        removedBefore = false
        return [existingLine]
      }
      removedBefore = false
      return [{ value: line.slice(1), focus: true }]
    })
    if (removedBefore && after.length) after.at(-1).removalAnchor = true

    sourceLines.splice(matches[0], before.length, ...after)
  }

  // A frame that only removes code highlights the line where the code used to be.
  if (!sourceLines.some((line) => line.focus)) {
    for (const line of sourceLines) if (line.removalAnchor) line.focus = true
  }

  return {
    code: sourceLines.map((line) => line.value).join("\n"),
    changedLines,
    focusRanges: collectFocusRanges(sourceLines),
  }
}

export function parseAgentSteps(markdown) {
  const section = markdown.match(
    new RegExp(`(?:^|\\n)##\\s+${STEP_SECTION}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`),
  )?.[1]
  if (!section) return []

  return section
    .split(/^###\s+/m)
    .slice(1)
    .map((block) => {
      const newline = block.indexOf("\n")
      const title = block.slice(0, newline).trim()
      const content = block.slice(newline + 1)
      const fence = content.match(/```diff\s+agent-step\s*\n([\s\S]*?)```/)

      if (!fence) throw new Error(`Missing diff agent-step block: ${title}`)

      return {
        title,
        description: content.replace(fence[0], "").trim(),
        patch: fence[1].trimEnd(),
      }
    })
}

export function buildAgentSnapshots({ source, target, steps, maxChangedLines = 10 }) {
  let code = source
  const snapshots = steps.map((step) => {
    const result = applyAgentPatch(code, step.patch, { maxChangedLines })
    code = result.code
    return { ...step, ...result }
  })

  if (code !== target) {
    throw new Error("The final agent-step snapshot does not match the chapter source")
  }

  return snapshots
}

function parseHunks(patch) {
  const hunks = []
  let current = []

  for (const line of patch.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("@@")) {
      if (current.length) hunks.push(current)
      current = []
    } else if (!line.startsWith("---") && !line.startsWith("+++")) {
      current.push(line)
    }
  }
  if (current.length) hunks.push(current)
  if (!hunks.length) throw new Error("Agent step has no patch hunks")

  return hunks
}

function findMatches(lines, target) {
  if (!target.length) {
    if (lines.length === 1 && lines[0] === "") {
      return [0]
    }

    throw new Error("Agent step needs at least one context or removed line")
  }

  const matches = []
  for (let index = 0; index <= lines.length - target.length; index += 1) {
    if (target.every((line, offset) => lines[index + offset] === line)) {
      matches.push(index)
    }
  }
  return matches
}

function collectFocusRanges(lines) {
  const ranges = []
  let start = null

  for (let index = 0; index <= lines.length; index += 1) {
    if (lines[index]?.focus && start === null) start = index + 1
    if (!lines[index]?.focus && start !== null) {
      ranges.push({ start, end: index })
      start = null
    }
  }

  return ranges
}
