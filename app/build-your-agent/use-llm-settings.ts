"use client"

import {
  useCallback,
  useEffect,
  useState,
} from "react"
import {
  DEFAULT_LLM_SETTINGS,
  LLM_SETTINGS_EVENT_NAME,
  LLM_SETTINGS_STORAGE_KEY,
  normalizeLlmSettings,
  parseLlmSettings,
  serializeLlmSettings,
  type LlmProvider,
} from "@/lib/build-your-agent-llm"

function readStoredLlmSettings() {
  if (typeof window === "undefined") {
    return DEFAULT_LLM_SETTINGS
  }

  return parseLlmSettings(
    window.localStorage.getItem(
      LLM_SETTINGS_STORAGE_KEY,
    ),
  )
}

export function useLlmSettings() {
  const [settings, setSettings] = useState(
    DEFAULT_LLM_SETTINGS,
  )
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const sync = () => {
      setSettings(readStoredLlmSettings())
      setHydrated(true)
    }

    sync()

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key &&
        event.key !== LLM_SETTINGS_STORAGE_KEY
      ) {
        return
      }

      sync()
    }

    const handleLocalChange = () => {
      sync()
    }

    window.addEventListener("storage", handleStorage)
    window.addEventListener(
      LLM_SETTINGS_EVENT_NAME,
      handleLocalChange,
    )

    return () => {
      window.removeEventListener(
        "storage",
        handleStorage,
      )
      window.removeEventListener(
        LLM_SETTINGS_EVENT_NAME,
        handleLocalChange,
      )
    }
  }, [])

  const save = useCallback(
    (nextValue: Partial<typeof settings>) => {
      if (typeof window === "undefined") {
        return
      }

      const nextSettings = normalizeLlmSettings({
        ...readStoredLlmSettings(),
        ...nextValue,
      })

      window.localStorage.setItem(
        LLM_SETTINGS_STORAGE_KEY,
        serializeLlmSettings(nextSettings),
      )
      window.dispatchEvent(
        new Event(LLM_SETTINGS_EVENT_NAME),
      )
      setSettings(nextSettings)
      setHydrated(true)
    },
    [],
  )

  return {
    apiToken: settings.apiToken,
    hydrated,
    llmProvider: settings.llmProvider,
    setApiToken: (apiToken: string) => save({ apiToken }),
    setLlmProvider: (llmProvider: LlmProvider) =>
      save({ llmProvider }),
  }
}
