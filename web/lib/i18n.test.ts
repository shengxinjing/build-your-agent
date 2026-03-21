import test from "node:test"
import assert from "node:assert/strict"

import {
  buildLocalePath,
  getAlternateLocale,
  stripLocalePrefix,
} from "./i18n.ts"

test("stripLocalePrefix removes a locale segment", () => {
  assert.equal(
    stripLocalePrefix("/cn/build-your-agent"),
    "/build-your-agent",
  )
  assert.equal(stripLocalePrefix("/en"), "/")
})

test("buildLocalePath prefixes localized routes", () => {
  assert.equal(
    buildLocalePath("en", "/build-your-agent"),
    "/en/build-your-agent",
  )
  assert.equal(buildLocalePath("cn", "/"), "/cn")
})

test("getAlternateLocale swaps between english and chinese", () => {
  assert.equal(getAlternateLocale("en"), "cn")
  assert.equal(getAlternateLocale("cn"), "en")
})
