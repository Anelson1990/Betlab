// Free ESPN API - no key needed, always returns today's games

const SPORT_CONFIG = {
  NHL: { sport: 'hockey', league: 'nhl' },
  NBA: { sport: 'basketball', league: 'nba' },
  MLB: { sport: 'baseball', league: 'mlb' },
  NFL: { sport: 'football', league: 'nfl' },
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
  const cfg = SPORT_CONFIG[sport.toUpperCase()];
  if (!cfg) return res.status(400).json({error:'Invalid sport'});

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard`;
    const r = await fetch(url, {
      headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}
    });
    if (!r.ok) return res.status(502).json({error:'ESPN API error'});
    const data = await r.json();

    const games = (data.events||[]).map(event => {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find(c=>c.homeAway==='home');
      const away = comp?.competitors?.find(c=>c.homeAway==='away');

      // Try to get odds from ESPN
      const odds = comp?.odds?.[0];
      const homeOdds = odds?.homeTeamOdds?.moneyLine || -110;
      const awayOdds = odds?.awayTeamOdds?.moneyLine || -110;

      const homeImpl = americanToImplied(homeOdds)*100;
      const awayImpl = americanToImplied(awayOdds)*100;
      const total = homeImpl+awayImpl;

      return {
        sport: sport.toUpperCase(),
        gameId: event.id,
        homeTeam: home?.team?.displayName||'Home',
        awayTeam: away?.team?.displayName||'Away',
        homeOdds,
        awayOdds,
        homeImpliedProb: Math.round(homeImpl/total*1000)/10,
        awayImpliedProb: Math.round(awayImpl/total*1000)/10,
        startTime: event.date,
        status: event.status?.type?.description||'Scheduled',
      };
    });

    return res.status(200).json({success:true, count:games.length, games, date:new Date().toISOString()});
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
