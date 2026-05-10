// Sarcastic-but-affectionate commentary on the user's ranked top 25.
//
// Three layers, in order of specificity:
//   1. Artist-specific zingers — pop-culture jabs at known names (Drake,
//      Taylor, Bad Bunny, etc). These are the funniest hits when they land.
//   2. Domination quips — fired when one artist hoards 3+ slots.
//   3. Top-pick + generic fallbacks — never let the page render zero roasts.
//
// Pure logic; no DOM. The reveal page picks 2 quips and lets the user reroll.

import type { PoolEntry } from "./pool";

// Keys are lowercased; match against any artist name in the top 25.
const ARTIST_QUIPS: Record<string, string[]> = {
  "taylor swift": [
    "Swiftie behavior detected. The friendship bracelet supply chain salutes you.",
    "Your top is giving 'I can fix him' energy. He is, in fact, a Taylor Swift song.",
    "Tortured Poets pilled. We're all just living in your Eras Tour fanfic.",
  ],
  "drake": [
    "Drake in the top 10. Bold choice in the year of our lord 2026.",
    "Started from the bottom, now we're pretending we didn't see Kendrick's verse.",
    "Drake top 5 is a personality, a flag, and a cry for help.",
  ],
  "kendrick lamar": [
    "Kendrick top tier — confirmed you've watched the Super Bowl performance 40 times.",
    "Not Like Us is the national anthem of your living room.",
  ],
  "kanye west": [
    "Still riding for Ye. The group chat is workshopping how to bring this up.",
    "Ye top 10 means you've separated the art from the everything, somehow.",
  ],
  "ye": [
    "Still riding for Ye. The group chat has notes.",
  ],
  "bad bunny": [
    "Un Verano Sin Ti doing the work of three albums on this list.",
    "Conejo malo top 5. Tu español está improving por necesidad.",
  ],
  "the weeknd": [
    "After Hours hasn't stopped playing in your apartment since 2020 and it shows.",
    "Abel top 10. Your situationship has a soundtrack and it's all his.",
  ],
  "sabrina carpenter": [
    "Espresso-pilled. That's not a personality, that's a marketing campaign you fell for.",
    "Sabrina top tier means you are, indeed, working late, because you're a singer.",
  ],
  "olivia rodrigo": [
    "Driving past their house but make it a top 10. Devastating. Iconic. Concerning.",
    "Olivia top tier confirms you've never actually been over it.",
  ],
  "billie eilish": [
    "Whisper-singing about him is officially a top 10 pastime.",
    "Birds of a Feather replay count: yes.",
  ],
  "sza": [
    "SZA top tier — at least we know you've been through it and processed nothing.",
    "Snooze on loop is not therapy and yet here we are.",
  ],
  "frank ocean": [
    "Frank Ocean top 5 means you have main character syndrome and a vinyl collection.",
    "Still waiting on the next album with your whole chest. He is not.",
  ],
  "tyler, the creator": [
    "Tyler top 10. We need to talk about your 'Flower Boy' phase that never ended.",
    "CHROMAKOPIA in the rotation. The aesthetic has consumed you.",
  ],
  "lana del rey": [
    "Lana heavy rotation — sad girl autumn became sad person life for you.",
    "Lana top 5 is just a cry for a rooftop and a cigarette you don't smoke.",
  ],
  "post malone": [
    "Post Malone top 10. The country pivot has officially radicalized you.",
    "Posty top tier — half tattoos, half tears, all rotation.",
  ],
  "travis scott": [
    "Travis top tier. Cactus Jack would be proud. Insurance underwriters less so.",
  ],
  "morgan wallen": [
    "Morgan Wallen top 10 is a choice and you made it with your whole chest.",
    "Last Night on repeat says everything anyone needs to know about you.",
  ],
  "noah kahan": [
    "Stick Season is a state of mind and you live there full-time.",
    "Noah Kahan top 10 confirms you cried in a Subaru this year.",
  ],
  "chappell roan": [
    "Pink Pony Club locked in. Your FYP is suspiciously coherent.",
    "Chappell top tier — femininomenon detected, no notes.",
  ],
  "beyoncé": [
    "Cowboy Carter pilled. The Beyhive is in your DMs already.",
  ],
  "ariana grande": [
    "Eternal Sunshine on loop. We promise the breakup wasn't about you.",
  ],
  "doja cat": [
    "Doja top tier means you've defended at least three of her tweets unprompted.",
  ],
  "tame impala": [
    "Tame Impala top 10. Your festival ticket spend is its own line item.",
    "Currents still in rotation? It's been a decade. Please go outside.",
  ],
  "phoebe bridgers": [
    "Phoebe top 5 means you've cried at a concert this year. Don't deny it.",
  ],
  "mac demarco": [
    "Mac top tier. Your apartment smells like a vintage shop and you're proud.",
  ],
  "fred again..": [
    "Fred again.. top 10 — the Boiler Room set radicalized you and you tell people.",
  ],
  "fred again": [
    "Fred again top 10 — that one Boiler Room set has consumed your personality.",
  ],
  "playboi carti": [
    "Carti top tier. We can't understand a word and that's the point apparently.",
  ],
  "future": [
    "Future top 10 — you have processed precisely zero feelings this year.",
  ],
  "j. cole": [
    "Cole top 10 means you have at least one strong opinion about the big three.",
  ],
  "21 savage": [
    "21 Savage top tier. The deadpan has become your communication style.",
  ],
  "metro boomin": [
    "Metro top 10 — if you don't trust him you don't trust anyone, evidently.",
  ],
  "harry styles": [
    "Harry top 5. The cardigan, the boa, the parasocial bond — it's all here.",
  ],
  "gracie abrams": [
    "Gracie top tier — you opened for the Eras Tour spiritually.",
  ],
};

const DOMINATION_QUIPS: Array<(n: number, artist: string) => string> = [
  (n, a) => `${a} ×${n} in the top 25. That's not a ranking, that's a fan account.`,
  (n, a) => `${n} ${a} tracks in the cut. Diversification is, apparently, for cowards.`,
  (n, a) => `${a} occupies ${n} slots. Your Spotify Wrapped is a one-pager.`,
  (n, a) => `${n}/${25} are ${a}. The algorithm gave up trying to recommend you anything else.`,
];

const TOP_PICK_QUIPS: Array<(track: string, artist: string) => string> = [
  (t, a) => `"${t}" by ${a} as #1. Bold. Defensible in court? Unclear.`,
  (t, a) => `Top spot to "${t}" — locked in, no notes, slight concern.`,
  (t, a) => `"${t}" at #1 is a personality test you didn't know you were taking.`,
  (t, a) => `${a}'s "${t}" topping the bracket is exactly what your Hinge prompts implied.`,
];

const DIVERSITY_QUIPS = {
  veryDiverse: [
    "25 tracks, mostly different artists. Indecisive king/queen behavior.",
    "Spread thinner than your group chat's plans. Respect.",
    "This list has the chaotic energy of a public radio DJ on a redbull.",
  ],
  veryConcentrated: [
    "Three artists, twenty-five slots. Monogamous behavior. Beautiful.",
    "You don't listen to music, you commit to it.",
  ],
};

const GENERIC_QUIPS = [
  "This ranking is giving 'I have a Letterboxd account I check daily.'",
  "These picks scream 'I curate, I don't consume.'",
  "You have taste — just not the kind that wins arguments at the function.",
  "Reads like a coffee shop playlist that's a little too on the nose.",
  "Seven of these would do numbers on TikTok and you know exactly which seven.",
  "Algorithm: 0. Vibes: 1. Self-awareness: pending.",
  "The data has spoken and the data needs to mind its business.",
  "Your roman empire is a Genius lyrics page from 2017.",
  "This is what happens when you let your FYP raise you.",
];

/** Pick up to `count` quips for the given ranking. Includes a deliberate
 *  shuffle so each call returns something fresh — the reveal page exposes
 *  a "roast me again" button. */
export function getQuips(ranked: PoolEntry[], count = 2): string[] {
  if (ranked.length === 0) return [];

  const pool: string[] = [];

  // Count artists across the ranked list.
  const artistCounts = new Map<string, { count: number; display: string }>();
  for (const t of ranked) {
    for (const a of t.artists) {
      const key = a.name.toLowerCase();
      const prev = artistCounts.get(key);
      if (prev) prev.count += 1;
      else artistCounts.set(key, { count: 1, display: a.name });
    }
  }

  // Layer 1 — artist-specific zingers (one per matching artist).
  for (const [key] of artistCounts) {
    const lines = ARTIST_QUIPS[key];
    if (lines) pool.push(pickRandom(lines));
  }

  // Layer 2 — domination (3+ slots from one artist).
  let topArtistKey = "";
  let topArtistCount = 0;
  for (const [k, v] of artistCounts) {
    if (v.count > topArtistCount) {
      topArtistKey = k;
      topArtistCount = v.count;
    }
  }
  if (topArtistCount >= 3) {
    const display = artistCounts.get(topArtistKey)?.display ?? topArtistKey;
    pool.push(pickRandom(DOMINATION_QUIPS)(topArtistCount, display));
  }

  // Layer 2.5 — diversity gag.
  const uniqueArtists = artistCounts.size;
  if (ranked.length >= 10 && uniqueArtists / ranked.length >= 0.9) {
    pool.push(pickRandom(DIVERSITY_QUIPS.veryDiverse));
  } else if (ranked.length >= 15 && uniqueArtists <= 3) {
    pool.push(pickRandom(DIVERSITY_QUIPS.veryConcentrated));
  }

  // Layer 3 — top-pick callout (always available).
  if (ranked[0]) {
    const top = ranked[0];
    const a = top.artists[0]?.name ?? "this artist";
    pool.push(pickRandom(TOP_PICK_QUIPS)(top.name, a));
  }

  // Layer 4 — generic backstop (pad if pool is short).
  while (pool.length < count) {
    pool.push(pickRandom(GENERIC_QUIPS));
  }

  // Shuffle and dedupe before returning the requested count.
  return shuffle(unique(pool)).slice(0, count);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function unique(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
