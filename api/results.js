export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sport, date } = req.query;
  if (!sport) return res.status(400).json({ error: 'sport required' });

  const today = date || new Date().toISOString().split('T')[0];

  try {
    let games = [];

    if (sport === 'MLB') {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=linescore`);
      const d = await r.json();
      games = (d.dates?.[0]?.games || []).map(g => ({
        id: g.gamePk,
        away: g.teams.away.team.abbreviation,
        home: g.teams.home.team.abbreviation,
        away_score: g.linescore?.teams?.away?.runs ?? null,
        home_score: g.linescore?.teams?.home?.runs ?? null,
        away_r1: g.linescore?.innings?.[0]?.away?.runs ?? null,
        home_r1: g.linescore?.innings?.[0]?.home?.runs ?? null,
        status: g.status.detailedState,
        final: g.status.detailedState.includes('Final'),
      }));
    }

    if (sport === 'NHL') {
      const r = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`);
      const d = await r.json();
      const dayGames = d.gameWeek?.[0]?.games || [];
      games = dayGames.map(g => ({
        id: g.id,
        away: g.awayTeam.abbrev,
        home: g.homeTeam.abbrev,
        away_score: g.awayTeam.score ?? null,
        home_score: g.homeTeam.score ?? null,
        status: g.gameState,
        final: g.gameState === 'OFF' || g.gameState === 'FINAL',
      }));
    }

    if (sport === 'NBA') {
      const r = await fetch(`https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`);
      const d = await r.json();
      games = (d.scoreboard?.games || []).map(g => ({
        id: g.gameId,
        away: g.awayTeam.teamTricode,
        home: g.homeTeam.teamTricode,
        away_score: g.awayTeam.score,
        home_score: g.homeTeam.score,
        status: g.gameStatusText,
        final: g.gameStatus === 3,
      }));
    }

    res.status(200).json({ sport, date: today, games });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
