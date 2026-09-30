/**
 * Fresh sessions: a chat with NO memory of anything before it.
 *
 * Why this exists: "clear the session and ask again" did not produce a fresh
 * answer. Even after a reset, a turn still carries durable recollection —
 * episodes distilled FROM the cleared conversation, build lessons, measured
 * build state, the operator's standing notes — so two "surprise me with a game"
 * asks converged on the same concept in the same house palette.
 *
 * A fresh session suppresses recollection entirely AND draws a random creative
 * brief, so two fresh chats cannot converge by construction.
 *
 * It is only a session-key convention: `web:<token>:fresh:<id>`. History and
 * builds are namespaced per key, so a fresh chat also starts with an empty
 * gallery and its own build space — prior work is not merely hidden from it,
 * it is unreachable (build lookups resolve inside the session's own directory).
 */
export const FRESH_SEP = ':fresh:';

export function isFreshSession(sessionKey: string): boolean {
  return sessionKey.includes(FRESH_SEP);
}

export function newFreshSessionKey(parentKey: string): string {
  return `${parentKey}${FRESH_SEP}${Date.now().toString(36)}`;
}

/**
 * Axes chosen to break different habits: genre and mood break the aesthetic
 * rut, interaction and twist break the structural one.
 */
const AXES: Array<[string, string[]]> = [
  [
    'genre',
    [
      'survival arena', 'tower defense', 'puzzle platformer', 'idle/incremental', 'rhythm', 'hidden-object',
      'deck-builder', 'physics sandbox', 'top-down racer', 'escape room', 'farm loop', 'dungeon crawl',
      'tycoon', 'bullet-hell shmup', 'word game', 'ecosystem sim',
    ],
  ],
  ['camera', ['top-down', 'side-on', 'first-person', 'isometric', 'fixed rooms', 'follow-cam']],
  [
    'core interaction',
    ['drag-to-aim', 'one button only', 'grid placement', 'stacking physics', 'timing windows', 'resource routing', 'pattern memory', 'light and shadow', 'flip gravity', 'heat management'],
  ],
  [
    'visual mood — NOT your usual palette',
    ['paper and ink', 'warm sunset gradients', 'concrete + safety orange', 'pastel vaporwave grid', 'crayon hand-drawn', 'blueprint schematic', 'bioluminescent deep sea', 'sepia archive', 'rainy neon noir', 'clay toy'],
  ],
  [
    'one twist',
    ['the world ages as you play', 'your score is your health', 'everything is seeded, nothing random', 'the level is built from your own inputs', 'the enemy learns your pattern', 'you play the thing being escaped', 'time moves only when you do', 'the interface is part of the level'],
  ],
];

/** Deterministic per session id: stable across that chat's turns, different between chats. */
export function freshBrief(sessionKey: string): string {
  const id = sessionKey.slice(sessionKey.indexOf(FRESH_SEP) + FRESH_SEP.length);
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return AXES.map(([label, options], axis) => `${label}: ${options[(h >>> (axis * 4)) % options.length]}`).join('\n');
}

/** The block injected into every turn of a fresh session. */
export function freshDirective(sessionKey: string): string {
  return [
    'FRESH SESSION — NO MEMORY: this chat starts from nothing. You have no recollection of earlier work here, and that is deliberate — the operator wants something genuinely NEW, not a variation of what came before.',
    '- Do not try to inspect or reuse prior builds; your gallery in this chat is empty and earlier work is not reachable from it.',
    '- Your usual house palette does NOT apply here. Take the visual mood below literally, not your defaults.',
    'Your brief was drawn at random for this session — keep to it:',
    freshBrief(sessionKey),
  ].join('\n');
}
