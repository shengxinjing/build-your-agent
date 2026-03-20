"use client"

import React from "react"

export type ThemeMode = "light" | "dark"

type ThemeContextValue = {
  resolvedTheme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext =
  React.createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = "build-your-agent-theme"

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle("dark", theme === "dark")
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [resolvedTheme, setResolvedTheme] =
    React.useState<ThemeMode>("light")

  React.useEffect(() => {
    const stored =
      window.localStorage.getItem(STORAGE_KEY)
    const nextTheme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia(
            "(prefers-color-scheme: dark)",
          ).matches
          ? "dark"
          : "light"

    setResolvedTheme(nextTheme)
    applyTheme(nextTheme)
  }, [])

  const setTheme = React.useCallback((theme: ThemeMode) => {
    setResolvedTheme(theme)
    applyTheme(theme)
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [])

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  const value = React.useMemo(
    () => ({
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [resolvedTheme, setTheme, toggleTheme],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeContext)

  if (!context) {
    throw new Error(
      "useTheme must be used inside ThemeProvider",
    )
  }

  return context
}
