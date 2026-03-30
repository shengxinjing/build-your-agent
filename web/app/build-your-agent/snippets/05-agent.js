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

const dragons = () => {
  const dragon = pickRandom(houses)
  return formatSentence(dragon, "has a dragon!")
}

console.log(dragons())
