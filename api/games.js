const SPORT_MAP = {
  NHL: {espn:'hockey/nhl', odds:'icehockey_nhl'},
  MLB: {espn:'baseball/mlb', odds:'baseball_mlb'},
  NBA: {espn:'basketball/nba', odds:'basketball_nba'},
  NFL: {espn:'football/nfl', odds:'americanfootball_nfl'},
};

function americanToImplied(odds) {
  const n = parseInt(odds);
  if (isNaN(n)) return 0.5;
  return n > 0 ? 100/(n+100) : Math.abs(n)/(Math.abs(n)+100);
}

async function fetchCoreOdds(sport, eventId) {
  try {
    const leagueMap = {NHL:'hockey/leagues/nhl', MLB:'baseball/leagues/mlb', NBA:'basketball/leagues/nba', NFL:'football/leagues/nfl'};
    const path = leagueMap[sport];
    if (!path) return null;
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/${path}/events/${eventId}/competitions/${eventId}/odds`);
    if (!r.ok) return null;
    const d = await r.json();
    const item = d.items?.[0];
    if (!item) return null;
    return {
      homeML: item.homeTeamOdds?.moneyLine||null,
      awayML: item.awayTeamOdds?.moneyLine||null,
      overUnder: item.overUnder||null,
      overOdds: item.overOdds||null,
      underOdds: item.underOdds||null,
      details: item.details||null,
    };
  } catch { return null; }
}

async function getESPNGames(sport) {
  try {
    const path = SPORT_MAP[sport]?.espn;
    if (!path) return [];
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
    if (!r.ok) return [];
    const d = await r.json();
    const games = [];
    for (const event of d.events||[]) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors?.find(c=>c.homeAway==='home');
      const away = comp.competitors?.find(c=>c.homeAway==='away');
      if (!home||!away) continue;

      // Try scoreboard odds first, fall back to core API
      let scoreboardOdds = comp.odds?.[0];
      let homeML = scoreboardOdds?.homeTeamOdds?.moneyLine||null;
      let awayML = scoreboardOdds?.awayTeamOdds?.moneyLine||null;
      let overUnder = scoreboardOdds?.overUnder||null;

      // If no odds in scoreboard, fetch from core API
      if (!homeML) {
        const coreOdds = await fetchCoreOdds(sport, event.id);
        if (coreOdds) {
          homeML = coreOdds.homeML;
          awayML = coreOdds.awayML;
          overUnder = coreOdds.overUnder;
        }
      }

      games.push({
        id: event.id,
        espnId: event.id,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        home: away.team.displayName,
        away: home.team.displayName,
        home_full: home.team.displayName,
        away_full: away.team.displayName,
        homeAbbr: home.team.abbreviation,
        awayAbbr: away.team.abbreviation,
        commenceTime: event.date,
        sport,
        homeML, awayML, overUnder,
        homeImplied: homeML ? americanToImplied(homeML)*100 : 50,
        awayImplied: awayML ? americanToImplied(awayML)*100 : 50,
        status: event.status?.type?.name||'scheduled',
      });
    }
    return games;
  } catch(e) { return []; }
}

async function getOddsAPIGames(sport, apiKey) {
  try {
    const slug = SPORT_MAP[sport]?.odds;
    if (!slug||!apiKey) return [];
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${slug}/odds?apiKey=${apiKey}&regions=us&markets=h2h,totals&oddsFormat=american`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.map(g=>{
      const dk = g.bookmakers?.find(b=>b.key==='draftkings')||g.bookmakers?.[0];
      const h2h = dk?.markets?.find(m=>m.key==='h2h');
      const tot = dk?.markets?.find(m=>m.key==='totals');
      const homeO = h2h?.outcomes?.find(o=>o.name===g.home_team);
      const awayO = h2h?.outcomes?.find(o=>o.name===g.away_team);
      const overO = tot?.outcomes?.find(o=>o.name==='Over');
      return {
        id: g.id, espnId: null,
        homeTeam: g.home_team, awayTeam: g.away_team,
        commenceTime: g.commence_time, sport,
        homeML: homeO?.price||null, awayML: awayO?.price||null,
        overUnder: overO?.point||null,
        homeImplied: homeO ? americanToImplied(homeO.price)*100 : 50,
        awayImplied: awayO ? americanToImplied(awayO.price)*100 : 50,
      };
    });
  } catch(e) { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const sport = req.query.sport||'NHL';
  const apiKey = process.env.ODDS_API_KEY;

  // Try ESPN first (free)
  let games = await getESPNGames(sport);

  // Fall back to Odds API if ESPN has no odds
  if (games.length===0 || games.every(g=>!g.homeML)) {
    const oddsGames = await getOddsAPIGames(sport, apiKey);
    if (oddsGames.length > 0) games = oddsGames;
  }

  return res.status(200).json({success:true, sport, games, source: games[0]?.espnId ? 'espn' : 'odds_api'});
}
