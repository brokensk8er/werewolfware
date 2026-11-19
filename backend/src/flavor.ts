// Narration lines the server picks from at random.



export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const VOTE_CAST_AMBIGUOUS = [
  'Somewhere, the clink of a pebble falls into a counting jar. A vote has been cast.',
  'A name is written in chalk. The tally grows by one.',
  'A stone is placed, quietly and with purpose. The count shifts.',
  'The scratch of a quill on parchment. Someone has made their choice.',
  'A bead slides on the abacus. The village inches toward a verdict.',
  'One more finger points in silence. The reckoning draws closer.',
  'A notch is carved. The count does not lie.',
];

export const VOTE_CAST_PRIVATE = [
  'Your vote is cast. May your deity of choice have mercy on their soul.',
  'It is done. History will judge you — probably harshly.',
  'Your stone is in the jar. What you have started, the village will finish.',
  'You have spoken. Whether wisely or not remains to be seen.',
  'The name is written. Light a candle for them tonight.',
  'Your conscience is your own business. The vote, however, is now everyone\'s.',
  'Done. Try not to think about it too much.',
];

export const WEREWOLF_DEATHS = [
  'found torn apart at the edge of the woods',
  'discovered in several pieces behind the mill',
  'dragged from their bed and left in the square',
  'found with claw marks too large to be any dog',
  'heard screaming at midnight — nothing left by dawn',
  'pulled into the dark, only their shoes remained',
];

export const VOTE_DEATHS = [
  'hoisted up by the angry mob',
  'pelted with vegetables until lifeless',
  'dragged to the gallows amid wild cheering',
  'driven out of town and never seen again — officially',
  'given a very strongly worded farewell',
  'met the pointy end of village justice',
];

export const SEER_WHISPERS = [
  'Your third eye twitches. The spirits reveal',
  'The visions crash over you like a wave —',
  'The crow lands on your shoulder and croaks:',
  'You gaze into the flame and see the truth:',
  'A cold certainty washes over you:',
];

export const PHASE_NIGHT = [
  '🌙 Darkness falls. The village sleeps — or pretends to.',
  '🌙 Night descends. Something stirs in the shadows.',
  '🌙 The torches flicker out. Pray for dawn.',
  '🌙 Night again. Lock your doors. Not that it helps.',
];

export const PHASE_DAY = [
  '☀️ Dawn breaks. Someone is missing. Surprise.',
  '☀️ The sun rises on a smaller village.',
  '☀️ Day breaks. Time to point fingers and argue.',
  '☀️ Morning. The survivors gather in the square.',
];
