/** Stable FBS conference artwork registry. No runtime conference-discovery request.
 * ESPN conference CDN convention is documented by SportsDataverse/cfbplotR:
 * https://a.espncdn.com/i/teamlogos/ncaa_conf/500/{conference_id}.png
 * IDs are CFBD conference identifiers; missing/failed artwork stays text-only.
 */
const image = id => `https://a.espncdn.com/i/teamlogos/ncaa_conf/500/${id}.png`;
const CONFERENCE_IDS = Object.freeze({
  acc:1, 'atlantic coast':1, 'atlantic coast conference':1,
  sec:8, southeastern:8, 'southeastern conference':8,
  'big ten':5, 'big ten conference':5, big10:5,
  'big 12':4, 'big 12 conference':4, big12:4,
  'american athletic':151, 'american athletic conference':151, american:151, aac:151,
  'conference usa':12, cusa:12, 'c-usa':12,
  'mid-american':15, 'mid-american conference':15, mac:15,
  'mountain west':17, 'mountain west conference':17,
  'pac-12':9, 'pac 12':9, 'pac-12 conference':9,
  'sun belt':37, 'sun belt conference':37
});
export function cfbConferenceLogo(name) {
  const key=String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
  const id=CONFERENCE_IDS[key];
  return id ? image(id) : null;
}
