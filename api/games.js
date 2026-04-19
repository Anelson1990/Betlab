// Games API - uses The Odds API (same as Claude)
// Returns today's games with live odds

const SPORT_MAP = {
  NHL: 'icehockey_nhl',
  MLB: 'baseball_mlb', 
  NBA: 'basketball_nba',
  NFL: 'americanfootball_nfl',
};

function americanToImplied(odds) {
  const n = parseInt(odds);
  if (isNaN(n)) return 0.5;
  return n > 0 ? 100/(n+100) : Math.abs(n)/(Math.abs(n)+100);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET');

  const { sport='NHL' } = req.query;
  const sportKey = SPORT_MAP[sport.toUpperCase()];
  if (!sportKey) return res.status(400).json({error:'Invalid sport'});

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return res.status(500).json({error:'ODDS_API_KEY not set'});

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({error:'Odds API error'});
    const data = await r.json();

    const games = data.map(g => {
      const book = g.bookmakers?.[0];
      const h2h = book?.markets?.find(m=>m.key==='h2h');
      const homeOutcome = h2h?.outcomes?.find(o=>o.name===g.home_team);
      const awayOutcome = h2h?.outcomes?.find(o=>o.name===g.away_team);
      const homeOdds = homeOutcome?.price || -110;
      const awayOdds = awayOutcome?.price || -110;
      const homeImpl = americanToImplied(homeOdds)*100;
      const awayImpl = americanToImplied(awayOdds)*100;
      const total = homeImpl+awayImpl;

      return {
        sport: sport.toUpperCase(),
        gameId: g.id,
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        homeOdds,
        awayOdds,
        homeImpliedProb: Math.round(homeImpl/total*1000)/10,
        awayImpliedProb: Math.round(awayImpl/total*1000)/10,
        startTime: g.commence_time,
        status: 'Scheduled',
        completed: false,
      };
    });

    return res.status(200).json({success:true, count:games.length, games, date:new Date().toISOString()});
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
