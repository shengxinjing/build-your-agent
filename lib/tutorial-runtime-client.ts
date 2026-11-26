const runtimeCodeCache = new Map<number, Promise<string>>()

export async function loadStepRuntimeCode(stepIndex: number) {
  const cached = runtimeCodeCache.get(stepIndex)

  if (cached) {
    return cached
  }

  const request = fetch(
    `/api/build-your-agent/runtime/${stepIndex}`,
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Failed to load runtime code for step ${stepIndex} (${response.status})`,
        )
      }

      const payload = (await response.json()) as {
        code?: unknown
      }

      if (typeof payload.code !== "string") {
        throw new Error(
          `Invalid runtime payload for step ${stepIndex}`,
        )
      }

      return payload.code
    })
    .catch((error) => {
      runtimeCodeCache.delete(stepIndex)
      throw error
    })

  runtimeCodeCache.set(stepIndex, request)
  return request
}
