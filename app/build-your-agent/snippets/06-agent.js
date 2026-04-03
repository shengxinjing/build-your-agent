import { formatSentence } from "./utils.js"

const houses = [
  "Stark",
  "Lannister",
  "Baratheon",
  "Targaryen",
  "Martell",
  "Tyrell",
  "Greyjoy",
]

const winterIsComing = () => {
  const isComing = Math.random() > 0.99

  if (isComing) {
    return "Winter is coming!"
  }

  return formatSentence("Winter", "is not coming.")
}

console.log(winterIsComing())
