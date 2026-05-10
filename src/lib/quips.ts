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
    "You have a vault track opinion and you are dying to share it.",
    "The lyrics tattoo is healing nicely.",
    "You've ranked the bridges of Cruel Summer, August, and All Too Well in a Notes app. Be honest.",
  ],
  "drake": [
    "Drake in the top 10. Bold choice in the year of our lord 2026.",
    "Started from the bottom, now we're pretending we didn't see Kendrick's verse.",
    "Drake top 5 is a personality, a flag, and a cry for help.",
    "You bought the OVO hoodie and the matching shame.",
    "Champagne Papi behavior. The For All The Dogs apologists meet at your apartment.",
  ],
  "kendrick lamar": [
    "Kendrick top tier — confirmed you've watched the Super Bowl performance 40 times.",
    "Not Like Us is the national anthem of your living room.",
    "You can recite the GNX tracklist in order, in your sleep, and you have.",
    "Mr. Morale apologist. Therapy podcast vibes detected.",
  ],
  "kanye west": [
    "Still riding for Ye. The group chat is workshopping how to bring this up.",
    "Ye top 10 means you've separated the art from the everything, somehow.",
    "You have a 'but the production' speech rehearsed and ready.",
    "Old Kanye, New Kanye, Sad Kanye — you ranked them in a Letterboxd-style list.",
  ],
  "ye": [
    "Still riding for Ye. The group chat has notes.",
    "The 'but MBDTF though' defense is loaded into your camera roll, ready.",
  ],
  "bad bunny": [
    "Un Verano Sin Ti doing the work of three albums on this list.",
    "Conejo malo top 5. Tu español está improving por necesidad.",
    "You quote DtMF lyrics in Instagram captions and pretend it's an inside joke.",
    "Benito top tier. You've watched the trilogy short film twice.",
  ],
  "the weeknd": [
    "After Hours hasn't stopped playing in your apartment since 2020 and it shows.",
    "Abel top 10. Your situationship has a soundtrack and it's all his.",
    "Blinding Lights still in your top 25? Wrap it up, nostalgia bait.",
    "The Idol was bad and you'd still watch a season 2.",
  ],
  "sabrina carpenter": [
    "Espresso-pilled. That's not a personality, that's a marketing campaign you fell for.",
    "Sabrina top tier means you are, indeed, working late, because you're a singer.",
    "Please Please Please got you through Q3 and you owe her royalties.",
    "Short n' Sweet. Like your attention span. Like your last six situationships.",
  ],
  "olivia rodrigo": [
    "Driving past their house but make it a top 10. Devastating. Iconic. Concerning.",
    "Olivia top tier confirms you've never actually been over it.",
    "GUTS deluxe in the rotation — the rage stage is over but the playlist remains.",
    "Vampire on full volume in the car has happened more than you'd admit.",
  ],
  "billie eilish": [
    "Whisper-singing about him is officially a top 10 pastime.",
    "Birds of a Feather replay count: yes.",
    "Lunch-coded. We saw your TikTok thirst comment. We all saw it.",
    "What Was I Made For made you main character at 2am and we get it.",
  ],
  "sza": [
    "SZA top tier — at least we know you've been through it and processed nothing.",
    "Snooze on loop is not therapy and yet here we are.",
    "Saturn season hit and you never came back.",
    "Kill Bill on autoplay — your delivery driver is concerned.",
  ],
  "frank ocean": [
    "Frank Ocean top 5 means you have main character syndrome and a vinyl collection.",
    "Still waiting on the next album with your whole chest. He is not.",
    "Blonde was a religious experience for you and you still bring it up at brunch.",
    "Channel Orange thinkpiece in your drafts since 2019. Post it. Or don't.",
  ],
  "tyler, the creator": [
    "Tyler top 10. We need to talk about your 'Flower Boy' phase that never ended.",
    "CHROMAKOPIA in the rotation. The aesthetic has consumed you.",
    "You can rank his albums by suit color and that's a personality now.",
    "Igor era radicalized your wardrobe and the receipts are loud.",
  ],
  "lana del rey": [
    "Lana heavy rotation — sad girl autumn became sad person life for you.",
    "Lana top 5 is just a cry for a rooftop and a cigarette you don't smoke.",
    "Norman Rockwell apologist. The Coachella set lives rent-free in your head.",
    "You whisper 'God knows life is loud' to yourself in the produce aisle.",
  ],
  "post malone": [
    "Post Malone top 10. The country pivot has officially radicalized you.",
    "Posty top tier — half tattoos, half tears, all rotation.",
    "You said the Bud Light era was actually his best and you were wrong.",
    "F-1 Trillion in the top tier. The cowboy hat was always coming.",
  ],
  "travis scott": [
    "Travis top tier. Cactus Jack would be proud. Insurance underwriters less so.",
    "UTOPIA on loop — the album, the merch drop, the lifestyle.",
    "You yell 'IT'S LIT' unironically in the Uber and the driver hates it.",
  ],
  "morgan wallen": [
    "Morgan Wallen top 10 is a choice and you made it with your whole chest.",
    "Last Night on repeat says everything anyone needs to know about you.",
    "I'm The Problem played at every wedding you went to and you didn't sit down.",
    "The mullet is a vibe and the vibe is your top 25.",
  ],
  "noah kahan": [
    "Stick Season is a state of mind and you live there full-time.",
    "Noah Kahan top 10 confirms you cried in a Subaru this year.",
    "Dial Drunk after two beers — your roommate has a folder of voice memos.",
    "Vermont radicalized you and you've never been to Vermont.",
  ],
  "chappell roan": [
    "Pink Pony Club locked in. Your FYP is suspiciously coherent.",
    "Chappell top tier — femininomenon detected, no notes.",
    "Good Luck, Babe! is your villain origin story and the kingdom is a group chat.",
    "The Midwest Princess era turned your closet into a costume department.",
  ],
  "beyoncé": [
    "Cowboy Carter pilled. The Beyhive is in your DMs already.",
    "TEXAS HOLD 'EM at the function — you led the line dance and we all saw.",
    "Renaissance has been on rotation for 18 months. Beyoncé pays your rent emotionally.",
  ],
  "ariana grande": [
    "Eternal Sunshine on loop. We promise the breakup wasn't about you.",
    "We Can't Be Friends after the breakup is its own grief stage.",
    "Yes, And? is your alarm clock and your therapist hates it.",
    "The Wicked era has eaten your personality whole.",
  ],
  "doja cat": [
    "Doja top tier means you've defended at least three of her tweets unprompted.",
    "Paint The Town Red was a moment and you haven't moved past it.",
    "Scarlet apologist. We see you, we hear you, we're not joining you.",
  ],
  "tame impala": [
    "Tame Impala top 10. Your festival ticket spend is its own line item.",
    "Currents still in rotation? It's been a decade. Please go outside.",
    "Lonerism opener at full volume in the headphones, eyes closed, on the couch.",
  ],
  "phoebe bridgers": [
    "Phoebe top 5 means you've cried at a concert this year. Don't deny it.",
    "You scream-sing the I Know The End outro alone in the kitchen.",
    "Stranger In The Alps weather and you've worn the t-shirt to two funerals.",
  ],
  "mac demarco": [
    "Mac top tier. Your apartment smells like a vintage shop and you're proud.",
    "Salad Days at 5pm light on a Sunday is your entire personality.",
    "You learned Chamber of Reflection on guitar and now we all have to live with it.",
  ],
  "fred again..": [
    "Fred again.. top 10 — the Boiler Room set radicalized you and you tell people.",
    "Delilah at 2am made you feel things that are not on your spreadsheet.",
    "You've sent the Marea voice memo edit to a situationship. Multiple, even.",
  ],
  "fred again": [
    "Fred again top 10 — that one Boiler Room set has consumed your personality.",
    "Actual Life trilogy is now a deeply personal era for you and an exhausting one for us.",
  ],
  "playboi carti": [
    "Carti top tier. We can't understand a word and that's the point apparently.",
    "Whole Lotta Red apologist — yes, on day one, yes, we know.",
    "Music in the rotation. The vibes are unintelligible and the runtime is forever.",
  ],
  "future": [
    "Future top 10 — you have processed precisely zero feelings this year.",
    "Mask Off at the gym is the closest you've gotten to therapy.",
    "WE DON'T TRUST YOU — at this point neither does anyone you know.",
  ],
  "j. cole": [
    "Cole top 10 means you have at least one strong opinion about the big three.",
    "You wrote the Reddit comment defending 7 Minute Drill. We're not mad, just disappointed.",
    "Middle Child is your shower song and the acoustics are not on your side.",
  ],
  "21 savage": [
    "21 Savage top tier. The deadpan has become your communication style.",
    "American Dream era — the documentary made you cry on the train.",
    "You quote 21 Savage at brunch and the table goes completely silent.",
  ],
  "metro boomin": [
    "Metro top 10 — if you don't trust him you don't trust anyone, evidently.",
    "Heroes & Villains was your soundtrack to overstaying at a party.",
  ],
  "harry styles": [
    "Harry top 5. The cardigan, the boa, the parasocial bond — it's all here.",
    "Watermelon Sugar is in your wedding playlist drafts and you know it.",
    "You went to Harryween. You don't have to keep telling us.",
  ],
  "gracie abrams": [
    "Gracie top tier — you opened for the Eras Tour spiritually.",
    "Risk made you text someone you shouldn't have. Twice.",
    "The Secret of Us — the secret is you've cried to it in a Trader Joe's parking lot.",
  ],

  // --- Additional rotation: indie / R&B / hip-hop / pop / country ---
  "boygenius": [
    "Boygenius top tier — you have a 'these three saved my life' speech ready.",
    "Not Strong Enough at karaoke is you trying to pull and failing in real time.",
  ],
  "lucy dacus": [
    "Lucy Dacus top 10. Night Shift is your manifesto and you're handing it out.",
  ],
  "julien baker": [
    "Julien Baker on rotation — your roommate hides the journal when you put it on.",
  ],
  "mitski": [
    "Mitski top tier — Nobody is the song, the mood, and the diagnosis.",
    "My Love Mine All Mine made you romanticize a stranger on the L train.",
    "You went to a Mitski concert and forgot how to talk for a week after.",
  ],
  "clairo": [
    "Clairo top 10 — the bedroom-pop pipeline radicalized you in 2019 and never let go.",
    "Charm is on while you make a $14 lunch you photographed for nobody.",
  ],
  "beabadoobee": [
    "Beabadoobee top tier — your aesthetic is 'thrift store dressing room mirror'.",
  ],
  "wallows": [
    "Wallows on the list. Are You Bored Yet? — yes, since the second listen, but go off.",
  ],
  "alex g": [
    "Alex G top 10 — you have a Discord pinned message about Race.",
  ],
  "big thief": [
    "Big Thief top tier means you have an opinion about every Adrianne Lenker side project.",
  ],
  "japanese breakfast": [
    "Japanese Breakfast top 10 — you read the memoir and bring it up at every dinner.",
  ],
  "soccer mommy": [
    "Soccer Mommy on rotation — circle the drain energy, but make it Friday night.",
  ],
  "snail mail": [
    "Snail Mail top tier — the heartbreak is performative and the production is not.",
  ],
  "faye webster": [
    "Faye Webster top 10. Kingston in your stories every other week. We're seeing a pattern.",
  ],
  "weyes blood": [
    "Weyes Blood on rotation — you're the friend who 'discovered' her in 2022 and you say it loud.",
  ],
  "caroline polachek": [
    "Caroline Polachek top tier — Welcome to My Island is your character intro music.",
  ],
  "vampire weekend": [
    "Vampire Weekend top 10 — you have an 'A-Punk' to 'Capricorn' arc speech locked and loaded.",
    "Only God Was Above Us era. You look great in the boat shoes. We're all a little impressed.",
  ],
  "the marías": [
    "The Marías on the list — your living room lighting matches the album art and that's the point.",
  ],
  "men i trust": [
    "Men I Trust top tier. The vibe is pristine. The personality is approximately 4 BPM.",
  ],
  "alvvays": [
    "Alvvays top 10. Archie, Marry Me at the wedding was a choice and you stand by it.",
  ],
  "japanese house": [
    "The Japanese House top tier — you cried at the Lumineer-adjacent acoustics. Bold.",
  ],
  "rina sawayama": [
    "Rina Sawayama on the list — you have a 'this is pop music' essay drafted in your head.",
  ],
  "fka twigs": [
    "FKA twigs top 10 — your Pinterest board is 90% her press shots.",
  ],
  "charli xcx": [
    "Charli top tier. brat green has eaten your color palette and your camera roll.",
    "365 in the headphones at the office. The cube next to you knows.",
    "You said it was a brat summer and somehow it's still going.",
  ],
  "troye sivan": [
    "Troye Sivan top 10. Got Me Started — yes, at 4am, in the kitchen, alone.",
    "Rush turned your gym playlist into a club night and we're all paying for it.",
  ],
  "lorde": [
    "Lorde top tier — Solar Power apologist behavior is its own personality type.",
    "Green Light at full volume on a highway is your reset button.",
  ],
  "dua lipa": [
    "Dua Lipa top 10 — Houdini is on, the lights are dim, and you 'have to dance now'.",
  ],
  "rosalía": [
    "Rosalía top tier. Motomami radicalized your gym playlist and your inner monologue.",
  ],
  "rosalia": [
    "Rosalía top tier. Motomami eras have entered the chat.",
  ],
  "karol g": [
    "Karol G on rotation — manana sera bonito apologist and we love it for you.",
  ],
  "peso pluma": [
    "Peso Pluma top 10 — the corridos tumbados era took you whole and never gave you back.",
  ],
  "feid": [
    "Feid top tier — the green-everything aesthetic has consumed your stories.",
  ],
  "rauw alejandro": [
    "Rauw Alejandro on the list — Saturno still hits and you bring it up unprompted.",
  ],
  "newjeans": [
    "NewJeans top tier — Super Shy was your summer and the choreography lives in your camera roll.",
  ],
  "le sserafim": [
    "LE SSERAFIM top 10 — Easy on rotation, posture immaculate, vibe correct.",
  ],
  "ive": [
    "IVE top tier — Baddie was the lock screen, the gym mix, and the reason you bought a new mirror.",
  ],
  "blackpink": [
    "BLACKPINK top 10. The merch arrived. The lightstick has its own shelf.",
  ],
  "bts": [
    "BTS top tier. The army badge in the bio still hits.",
  ],
  "stray kids": [
    "Stray Kids on the list — Lalalala is your 'I'm locking in' walk-up music.",
  ],
  "mac miller": [
    "Mac Miller top 10 — Circles is the album you put on when no one's watching.",
    "Self Care apologist. The Faces deluxe drop made your week and ruined your month.",
  ],
  "juice wrld": [
    "Juice WRLD top tier — every posthumous drop hits you like it's 2018 again.",
  ],
  "summer walker": [
    "Summer Walker top 10 — Still Over It era means you sent that text. We all know.",
  ],
  "brent faiyaz": [
    "Brent Faiyaz top tier — the WASTELAND apologist tax is past due.",
  ],
  "daniel caesar": [
    "Daniel Caesar top 10 — Best Part is in your wedding draft folder. Be honest.",
  ],
  "giveon": [
    "Giveon top tier — that voice has made you forgive things you absolutely should not have.",
  ],
  "6lack": [
    "6LACK top 10 — Prblms is your 2am text energy and we're not endorsing it.",
  ],
  "jhené aiko": [
    "Jhené Aiko top tier — the bowls, the candles, the breakup playlist on shuffle.",
  ],
  "jhene aiko": [
    "Jhené Aiko top tier — the bowls, the candles, the breakup playlist on shuffle.",
  ],
  "joji": [
    "Joji top 10. Slow Dancing in the Dark is your shower song and your downfall.",
  ],
  "conan gray": [
    "Conan Gray top tier — Heather is still living in your throat unprovoked.",
  ],
  "tate mcrae": [
    "Tate McRae on the list — greedy choreography in the kitchen mirror at 1am, again.",
  ],
  "benson boone": [
    "Benson Boone top 10 — Beautiful Things at every wedding, including ones you didn't go to.",
  ],
  "role model": [
    "Role Model top tier — Sally, When the Wine Runs Out is the era and you live there.",
  ],
  "ricky montgomery": [
    "Ricky Montgomery top tier — Line Without a Hook is the song you've ruined for at least one ex.",
  ],
  "zach bryan": [
    "Zach Bryan top 10 — Something in the Orange has been on for 14 months and counting.",
    "The Belting era — your roommate filed a noise complaint and you wrote it off.",
  ],
  "tyler childers": [
    "Tyler Childers top tier — All Your'n is your text-them-back-at-3am song.",
  ],
  "jason isbell": [
    "Jason Isbell top 10 — Cover Me Up at karaoke and the room got real, real quiet.",
  ],
  "kacey musgraves": [
    "Kacey Musgraves top tier — Deeper Well is your morning meditation and your evening yap.",
  ],
  "vince staples": [
    "Vince Staples top 10 — the deadpan dry humor became your dating profile and we noticed.",
  ],
  "earl sweatshirt": [
    "Earl top tier — Some Rap Songs apologist. The bars are dense, the mood is denser.",
  ],
  "denzel curry": [
    "Denzel Curry top 10 — Walkin in the gym mix means PR season is open.",
  ],
  "jpegmafia": [
    "JPEGMAFIA top tier — the Discord-mod-with-a-mic energy has consumed your camera roll.",
  ],
  "freddie gibbs": [
    "Freddie Gibbs top 10 — Alfredo apologist behavior is the most honest stat on this page.",
  ],
  "smino": [
    "Smino top tier — the cadence is jazz, the lyrics are prayers, the vibe is unbeaten.",
  ],
  "saba": [
    "Saba top 10 — Few Good Things era. You're the friend who explains the production.",
  ],
  "noname": [
    "Noname top tier — your anti-capitalism arc has a soundtrack and a book club.",
  ],
  "joey bada$$": [
    "Joey on the list — '99 boom-bap is a state of mind you visit too often.",
  ],
  "joey badass": [
    "Joey on the list — '99 boom-bap is a state of mind you visit too often.",
  ],
  "ice spice": [
    "Ice Spice top 10 — the curls, the deadpan, the 'munch' allegations on your timeline.",
  ],
  "gunna": [
    "Gunna top tier — fukumean is your walk-up song and your security blanket.",
  ],
  "lil yachty": [
    "Lil Yachty top 10 — Let's Start Here. apologist behavior. We see you, prog rock convert.",
  ],
  "megan thee stallion": [
    "Megan top tier — the squat form is up, the playbook is closed, hot girl logistics on lock.",
  ],
  "glorilla": [
    "GloRilla top 10 — Yeah Glo is your gym walkout and your laundry-day power move.",
  ],
  "doechii": [
    "Doechii top tier — Anxiety, Denial Is A River, and a brand new personality. Welcome.",
  ],
  "sexyy red": [
    "Sexyy Red on the list — your gym mix has a curfew and a parental advisory.",
  ],
  "jack harlow": [
    "Jack Harlow top 10. The 'do you remember me' walk into every room — yes, painfully.",
  ],
  "lil baby": [
    "Lil Baby top tier — Drip Too Hard era is still the most honest stat on your Wrapped.",
  ],
  "lil durk": [
    "Lil Durk top 10 — All My Life on the run-the-day playlist, on the run-the-night playlist, in between.",
  ],
  "polo g": [
    "Polo G top tier — RAPSTAR apologist behavior is forever and you're not apologizing.",
  ],
  "rod wave": [
    "Rod Wave top 10 — every drive home is a confessional booth in your Camry.",
  ],
  "nba youngboy": [
    "NBA Youngboy top tier — the catalog is a black hole and you've been in for years.",
  ],
  "youngboy never broke again": [
    "NBA Youngboy top tier — the catalog is a black hole and you've been in for years.",
  ],
  "radiohead": [
    "Radiohead top 10 — the In Rainbows speech has been delivered to multiple unwilling parties.",
    "OK Computer top tier in 2026. We agree, but we also need you to log off.",
  ],
  "the smile": [
    "The Smile top tier — Radiohead-adjacent superiority complex unlocked.",
  ],
  "arctic monkeys": [
    "Arctic Monkeys top 10 — the AM TikTok era radicalized you and you've never let go.",
    "I Wanna Be Yours has been your bio quote at three different points. Be honest.",
  ],
  "the 1975": [
    "The 1975 top tier — Matty's monologue era hit you the wrong way and you stayed anyway.",
    "Robbers in the Uber on a winter night — the dramatic main character moment of your life.",
  ],
  "phoebe waller-bridge": [
    "Wrong app. Try Letterboxd.",
  ],
};

const DOMINATION_QUIPS: Array<(n: number, artist: string) => string> = [
  (n, a) => `${a} ×${n} in the top 25. That's not a ranking, that's a fan account.`,
  (n, a) => `${n} ${a} tracks in the cut. Diversification is, apparently, for cowards.`,
  (n, a) => `${a} occupies ${n} slots. Your Spotify Wrapped is a one-pager.`,
  (n, a) => `${n}/${25} are ${a}. The algorithm gave up trying to recommend you anything else.`,
  (n, a) => `${a} got ${n} slots. The other artists filed a labor complaint.`,
  (n, a) => `${n}× ${a}. This isn't a top 25, it's a setlist.`,
  (n, a) => `${a} has colonized ${n} slots. The other tracks are hostages.`,
  (n, a) => `${n} ${a} entries. The DJ has muted you in the queue group chat.`,
  (n, a) => `You stanned ${a} ${n} times in a row. A jury would call that intent.`,
  (n, a) => `${a} ×${n}. At this point just buy the discography on vinyl and stop torturing us.`,
  (n, a) => `${n} of these are ${a}. We're not roasting you, we're concerned for you.`,
  (n, a) => `${a} got ${n} placements. Variety is the spice of life. You ordered plain.`,
];

const TOP_PICK_QUIPS: Array<(track: string, artist: string) => string> = [
  (t, a) => `"${t}" by ${a} as #1. Bold. Defensible in court? Unclear.`,
  (t, a) => `Top spot to "${t}" — locked in, no notes, slight concern.`,
  (t, a) => `"${t}" at #1 is a personality test you didn't know you were taking.`,
  (t, a) => `${a}'s "${t}" topping the bracket is exactly what your Hinge prompts implied.`,
  (t, a) => `"${t}" #1. The receipts are in, the verdict is 'of course it is'.`,
  (t, a) => `Crowning "${t}" — a choice with the confidence of a man who has not read the room.`,
  (t, a) => `"${t}" by ${a} at the top. Predictable. Comforting. Slightly damning.`,
  (t, a) => `#1: "${t}". The aux cord is being revoked at the next function.`,
  (t, a) => `"${t}" leads. Your friends called this in 2023 and you've grown not at all.`,
  (t, a) => `${a} with "${t}" at the peak. Pin this to your bio, you mean it.`,
  (t, a) => `"${t}" #1 — the song you put on when you want to feel something. The thing being smug.`,
  (t, a) => `Top pick: "${t}". A song, a flex, a confession.`,
];

const DIVERSITY_QUIPS = {
  veryDiverse: [
    "25 tracks, mostly different artists. Indecisive king/queen behavior.",
    "Spread thinner than your group chat's plans. Respect.",
    "This list has the chaotic energy of a public radio DJ on a redbull.",
    "Every artist gets one slot. The Geneva Convention of music ranking.",
    "Your top 25 reads like a year-end critic ballot from someone with a thesis.",
    "Wide net, no commitment. Classic avoidant attachment in playlist form.",
    "This is a mixtape, not a top 25. The diplomatic immunity is showing.",
    "You picked 25 songs from 25 artists like you were trying not to hurt anyone's feelings.",
  ],
  veryConcentrated: [
    "Three artists, twenty-five slots. Monogamous behavior. Beautiful.",
    "You don't listen to music, you commit to it.",
    "Your top 25 has fewer artists than a household has roommates.",
    "The streaming wrapped page must be terrifying to render.",
    "Loyalty stat: maxed. Variety stat: cancelled.",
    "Three artists. Twenty-five tracks. One personality.",
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
  "This list looks like the AUX cord at a party where nobody's having fun.",
  "Half of this is for the bit and the other half is unironic and we cannot tell which is which.",
  "There are choices on here that would not survive a friend audit.",
  "You picked these like you knew someone was going to see them.",
  "Pinterest mood board energy, but as a top 25.",
  "This ranking is the playlist version of an outfit you'd post but not wear.",
  "Your therapist would call this 'avoidance.' We call it #18.",
  "The Spotify family plan owner is reading this and laughing.",
  "If your top 25 had a Yelp page, the reviews would be 'cute spot, weird hours'.",
  "This list is a vibe check and a cry for help in equal measure.",
  "Eight of these are for the lore. Four are for the algorithm. The rest are evidence.",
  "Your Discover Weekly is going to be unhinged for the foreseeable future.",
  "This is what 'I'm into a little of everything' looks like in production.",
  "The taste level here is high. The therapy level is higher. Balance pending.",
  "Reads like a New Yorker profile of a 'rising taste-maker who works at a co-op'.",
  "Your top 25 has the structural integrity of a Notion page nobody else has access to.",
  "Half of these bangers, half of these confessions. Coin flip on which is which.",
  "We've cracked the code: this is a soundtrack to a mid-budget A24 movie about your week.",
  "This list has 'main character at brunch, supporting cast on weekdays' written all over it.",
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
