import {
  formatOutcome,
  pickRandom,
} from "./utils.js"

// !mark
const houses = [
  "Stark",
  "Lannister",
  "Baratheon",
  "Targaryen",
]

// !mark(1:3) gold
const winner = pickRandom(houses)

// !border(1:2) yellow
console.log(formatOutcome("Iron Throne", winner))
console.log(formatOutcome("Iron Throne", winner))
console.log(formatOutcome("Iron Throne", winner))
console.log(formatOutcome("Iron Throne", winner))
// !bg[5:16] orange
console.log(formatOutcome("Iron Throne", winner))
