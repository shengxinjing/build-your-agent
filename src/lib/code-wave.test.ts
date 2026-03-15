import React from "react"
import { describe, expect, it } from "vitest"
import { splitCodeWaveChildren } from "./code-wave"

function makeCode(label: string) {
  return React.createElement(
    "figure",
    { "data-rehype-pretty-code-figure": "" },
    React.createElement(
      "pre",
      {},
      React.createElement("code", {}, `const value = "${label}"`)
    )
  )
}

describe("splitCodeWaveChildren", () => {
  it("groups each code block with the content that follows it", () => {
    const children = [
      makeCode("first"),
      React.createElement("h3", { key: "h1" }, "Step one"),
      React.createElement("p", { key: "p1" }, "Explain first step"),
      makeCode("second"),
      React.createElement("p", { key: "p2" }, "Explain second step"),
    ]

    const steps = splitCodeWaveChildren(children)

    expect(steps).toHaveLength(2)
    expect(steps[0].content).toHaveLength(2)
    expect(steps[1].content).toHaveLength(1)
  })

  it("ignores leading non-code nodes until the first code block", () => {
    const children = [
      React.createElement("p", { key: "lead" }, "Intro"),
      makeCode("first"),
      React.createElement("p", { key: "p1" }, "After first"),
    ]

    const steps = splitCodeWaveChildren(children)

    expect(steps).toHaveLength(1)
    expect(steps[0].content).toHaveLength(1)
  })

  it("finds code blocks nested inside fragments", () => {
    const children = React.createElement(
      React.Fragment,
      {},
      makeCode("first"),
      React.createElement("p", { key: "p1" }, "After first")
    )

    const steps = splitCodeWaveChildren(children)

    expect(steps).toHaveLength(1)
    expect(steps[0].content).toHaveLength(1)
  })
})
