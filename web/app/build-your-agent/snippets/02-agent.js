import {
  formatSentence,
  pickRandom,
} from "./utils.js"

const houses = [
  "Stark",
  "Lannister",
  "Baratheon",
  "Targaryen",
]

// !focus(1:3)
const clash = () => {
  const winner = pickRandom(houses)
  return formatSentence(winner, "wins the battle!")
}

console.log(clash())
