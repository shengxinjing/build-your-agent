"use client"

import React from "react"

export type ThemeMode = "light" | "dark"
type ThemeSource = "default" | "user"

type ThemeContextValue = {
  resolvedTheme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext =
  React.createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = "build-your-agent-theme"
const DEFAULT_THEME: ThemeMode = "dark"

function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === "light" || stored === "dark") {
    return stored
  }

  return null
}

function readThemeFromDom(): ThemeMode | null {
  if (typeof document === "undefined") {
    return null
  }

  const root = document.documentElement
  const datasetTheme = root.dataset.theme

  if (datasetTheme === "light" || datasetTheme === "dark") {
    return datasetTheme
  }

  if (root.classList.contains("dark")) {
    return "dark"
  }

  return null
}

function applyTheme(
  theme: ThemeMode,
  source: ThemeSource,
) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.themeSource = source
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [resolvedTheme, setResolvedTheme] =
    React.useState<ThemeMode>(DEFAULT_THEME)

  React.useEffect(() => {
    const stored = readStoredTheme()
    const domTheme = readThemeFromDom()
    const nextTheme = stored ?? domTheme ?? DEFAULT_THEME
    const nextSource: ThemeSource = stored ? "user" : "default"

    setResolvedTheme(nextTheme)
    applyTheme(nextTheme, nextSource)

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== STORAGE_KEY) {
        return
      }
      const latest = readStoredTheme()
      const target = latest ?? DEFAULT_THEME
      setResolvedTheme(target)
      applyTheme(target, latest ? "user" : "default")
    }

    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  const setTheme = React.useCallback((theme: ThemeMode) => {
    setResolvedTheme(theme)
    applyTheme(theme, "user")
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

export function useDomThemeMode() {
  return useTheme().resolvedTheme
}
