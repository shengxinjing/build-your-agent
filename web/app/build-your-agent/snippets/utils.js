export function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)]
}

export function pickPair(items) {
  return [pickRandom(items), pickRandom(items)]
}

export function formatOutcome(label, value) {
  return `${label}: ${value}`
}

export function formatSentence(value, suffix) {
  return `${value} ${suffix}`
}
