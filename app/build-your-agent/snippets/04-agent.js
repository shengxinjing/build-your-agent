import {
  pickPair,
} from "./utils.js"

const houses = [
  "Martell",
  "Lannister",
  "Baratheon",
  "Tyrell",
]

const intrigue = () => {
  const [ally1, ally2] = pickPair(houses)
  return `${ally1} and ${ally2} form an alliance!`
}

console.log(intrigue())
