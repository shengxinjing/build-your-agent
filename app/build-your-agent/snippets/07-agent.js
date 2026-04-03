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

const keepDreaming = () => {
  return formatSentence("Not gonna happen...", "")
}

console.log(keepDreaming().trim())
