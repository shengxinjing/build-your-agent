"use client"

import { HighlightedCode, Pre, highlight } from "codehike/code"
import { useState } from "react"

export function Code({ highlighted }: { highlighted: HighlightedCode[] }) {
  const [selectedLang, setSelectedLang] = useState(highlighted[0].lang)
  const selectedCode = highlighted.find((code) => code.lang === selectedLang)!

  return (
    <div className="relative">
      <Pre code={selectedCode} className="m-0 pt-6 px-4 bg-zinc-950/80" />
      <div className="absolute top-2 right-2">
        <label className="sr-only" htmlFor="code-language-select">
          Select language
        </label>
        <select
          id="code-language-select"
          value={selectedLang}
          onChange={(event) =>
            setSelectedLang(event.target.value)
          }
          className="h-8 rounded border border-zinc-700 bg-zinc-950/90 px-2 text-xs text-slate-300 outline-none transition focus:border-zinc-500"
        >
          {highlighted.map(({ lang }, index) => (
            <option key={index} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
