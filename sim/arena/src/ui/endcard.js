// Kit link on the end card. Same rule as the SO-101 win card (no purchase button before the 3rd own win):
// a quiet secondary text link, only after a won quick match once the player has won 3 matches, never in a
// tournament and never as the primary button. It points to the kit page's "notify me" form, because no kit
// is on sale (UCPD Annex I no. 28: no direct exhortation to children to buy).
export const KIT_ROBOTS = new Set(['svrn', 'vert150']);
export const KIT_MIN_WINS = 3;
export const KIT_LABEL = 'Dejte mi vědět, až bude sada';

/** wins: the player's own wins against the AI so far, including this match. Returns null or { href, label }. */
export function kitLink({ mode, win, wins, robot }) {
  if (mode !== 'quick' || win !== true || !(wins >= KIT_MIN_WINS) || !KIT_ROBOTS.has(robot)) return null;
  return { href: `../../sada/${robot}/#predobjednavka`, label: KIT_LABEL };
}

/** Wins that count: a solo match against the AI that the player won (not two players on one device). */
export const countsAsWin = ({ mode, win }) => win === true && (mode === 'quick' || mode === 'ladder');
