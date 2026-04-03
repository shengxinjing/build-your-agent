"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] transition hover:border-[var(--text)] hover:bg-[var(--surface-elevated)]"
      aria-label={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Toggle theme"
      }
    >
      {mounted ? (
        isDark ? <Sun size={15} /> : <Moon size={15} />
      ) : (
        <span
          aria-hidden="true"
          className="h-[15px] w-[15px] rounded-full border border-current opacity-40"
        />
      )}
    </button>
  )
}
