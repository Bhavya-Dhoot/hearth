/**
 * Deterministic synonyms table (PRD Appendix D: no embeddings). Each key is a concept name that
 * playbook `symptoms` and question `routes` may use as a term; its value lists the surface forms
 * that count as that concept in a customer's words.
 *
 * Surface forms are written the way `normalise()` renders text: lower case, apostrophes dropped
 * ("won't" becomes "wont"), every other punctuation mark a space. A form matches at the start of a
 * word ("leak" matches "leaking"); a trailing "$" requires the whole word ("ac$" does not match
 * "action").
 */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  leak: ["leak", "drip", "seep", "weep", "trickl", "puddl", "pool", "damp", "moist", "wet", "soak", "water under", "water in the cabinet", "water on the floor", "water coming", "water is coming"],
  under: ["under", "beneath", "below", "underneath", "cabinet"],
  sink: ["sink", "basin", "vanity"],
  ptrap: ["p trap", "ptrap", "trap", "u bend", "u shaped", "slip nut", "slip joint", "tailpiece", "curved pipe", "drain pipe"],
  pipe: ["pipe", "plumbing", "pvc", "fitting", "joint", "coupling", "connection"],
  hose: ["hose", "supply line", "supply", "braided", "flexible line", "water line", "connector", "compression nut"],
  dishwasher: ["dishwasher", "dish washer"],
  disposal: ["disposal", "disposer", "insinkerator", "garburator", "garbage grinder"],
  itself: ["itself", "body", "housing", "casing", "underside", "side of the", "bottom of the"],
  hum: ["hum", "buzz", "growl", "groan", "moan", "grind", "jam", "stuck", "seized", "stalled", "wont spin", "not spinning", "wont turn", "clunk", "clank", "rattl"],
  dead: ["not working", "wont work", "doesnt work", "stopped working", "isnt working", "dead", "wont turn on", "wont start", "wont run", "wont come on", "broken"],
  toilet: ["toilet", "commode", "loo$", "john$", "wc$", "lavatory", "water closet", "throne"],
  run: ["run", "hiss", "keeps filling", "fills again", "never stops", "wont stop", "phantom", "ghost flush", "refill", "fills up", "keeps going"],
  clog: ["clog", "plugged", "plug", "blocked", "block", "backed up", "backing up", "backup", "overflow", "wont flush", "wont drain", "slow drain", "drains slowly", "draining slowly", "gurgl", "wont go down", "rising", "filling up", "full of water", "stopped up", "plunge"],
  notdraining: ["drain", "standing water", "wont empty", "full of water", "water at the bottom", "water in the bottom", "water left", "sitting in", "stays in", "wont pump", "still full", "leftover water", "dirty water", "backed up"],
  breaker: ["breaker", "fuse", "trip", "gfci", "circuit"],
  outlet: ["outlet", "receptacle", "socket", "power point"],
  nopower: ["no power", "lost power", "power out", "power is out", "power went out", "power is off", "lights out", "lights are out", "no electricity", "went out", "blackout"],
  anyroom: ["kitchen", "bathroom", "bedroom", "garage", "living room", "office", "laundry", "basement", "room"],
  ac: ["ac$", "a c$", "air conditioner", "air conditioning", "aircon", "air con", "central air", "condenser", "compressor"],
  notcool: ["not cooling", "wont cool", "doesnt cool", "isnt cooling", "not cool", "no cool", "no cold air", "no cooling", "not cold", "isnt cold", "doesnt get cold", "wont get cold", "not keeping up", "cant cool", "cant keep up", "too warm", "too hot", "wont cool down"],
  warm: ["warm", "humid", "muggy", "sticky", "stuffy", "too hot", "so hot", "its hot", "getting hot", "very hot"],
  nowarm: ["no heat", "not heating", "wont heat", "doesnt heat", "isnt heating", "not warm", "no warm", "cold house", "house is cold", "freezing", "wont warm", "doesnt warm", "isnt warm", "blowing cold", "no hot air", "too cold", "no heating", "isnt getting warm", "cold in the house", "cold upstairs"],
  furnace: ["furnace", "heater$", "heaters$", "heating", "heat$", "boiler"],
  house: ["house", "home", "room", "upstairs", "downstairs", "bedroom", "apartment", "living room", "everywhere", "vents"],
  waterheater: ["waterheater", "hot water", "rheem"],
  nohot: ["no hot water", "not hot", "isnt hot", "wont get hot", "lukewarm", "runs cold", "only cold", "ran out of hot", "out of hot", "hot water gone", "water is cold", "water isnt hot", "no warm water", "not getting hot", "hot water wont", "hot water isnt", "hot water stopped", "hot water is out", "hot water runs out"],
  smoke: ["smoke detector", "smoke alarm", "detector", "alarm", "fire alarm"],
  chirp: ["chirp", "beep", "ping$", "squeak", "blink", "low battery", "keeps going off", "going off", "randomly", "false alarm", "every minute", "every 30", "every few", "middle of the night", "3 am"],
  battery: ["battery", "batteries", "9v"],
};
