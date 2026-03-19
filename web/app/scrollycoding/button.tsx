"use client"

import { Copy, Check } from "lucide-react"
import { useState } from "react"

type CopyButtonProps = {
  text: string
  className?: string
}

export function CopyButton({
  text,
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      className={`rounded border border-zinc-700/70 bg-zinc-950/80 p-1 text-zinc-200 transition hover:bg-gray-400/20 ${className}`}
      aria-label="Copy to clipboard"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  )
}
