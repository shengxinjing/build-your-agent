import {
  formatSentence,
  pickRandom,
} from "./utils.js"

const houses = [
  "Stark",
  "Lannister",
  "Baratheon",
]

const reveal = () => {
  const traitor = pickRandom(houses)
  return formatSentence(traitor, "betrays the alliance!")
}

console.log(reveal())
