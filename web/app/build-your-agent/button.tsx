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
      className={`scrolly-icon-button ${className}`}
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
