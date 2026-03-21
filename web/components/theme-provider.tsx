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

function readSystemTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)")
    .matches
    ? "dark"
    : "light"
}

function resolveTheme(): ThemeMode {
  return readStoredTheme() ?? readSystemTheme()
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [resolvedTheme, setResolvedTheme] =
    React.useState<ThemeMode>(
      () => readThemeFromDom() ?? resolveTheme(),
    )

  React.useEffect(() => {
    const media = window.matchMedia(
      "(prefers-color-scheme: dark)",
    )
    const domTheme = readThemeFromDom()

    if (domTheme) {
      setResolvedTheme(domTheme)
    } else {
      const nextTheme = resolveTheme()
      setResolvedTheme(nextTheme)
      applyTheme(nextTheme)
    }

    const handleSystemChange = () => {
      if (!readStoredTheme()) {
        const nextTheme = readSystemTheme()
        setResolvedTheme(nextTheme)
        applyTheme(nextTheme)
      }
    }

    media.addEventListener("change", handleSystemChange)

    return () => {
      media.removeEventListener(
        "change",
        handleSystemChange,
      )
    }
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

export function useDomThemeMode() {
  return useTheme().resolvedTheme
}
