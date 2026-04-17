export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sport, date } = req.query;
  if (!sport) return res.status(400).json({ error: 'sport required' });

  const today = date || new Date().toISOString().split('T')[0];
  const month = new Date(today).getMonth() + 1; // 1-12

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
      // NBA season runs Oct-June
      if (month >= 10 || month <= 6) {
        try {
          // Try ESPN API as backup
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today.replace(/-/g,'')}`);
          const d = await r.json();
          games = (d.events || []).map(e => {
            const comp = e.competitions?.[0];
            const away = comp?.competitors?.find(c=>c.homeAway==='away');
            const home = comp?.competitors?.find(c=>c.homeAway==='home');
            return {
              id: e.id,
              away: away?.team?.abbreviation || '',
              home: home?.team?.abbreviation || '',
              away_score: parseInt(away?.score) || null,
              home_score: parseInt(home?.score) || null,
              status: e.status?.type?.description || '',
              final: e.status?.type?.completed || false,
            };
          });
        } catch {
          // Fallback to NBA CDN
          const r2 = await fetch(`https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`);
          const d2 = await r2.json();
          games = (d2.scoreboard?.games || []).map(g => ({
            id: g.gameId,
            away: g.awayTeam.teamTricode,
            home: g.homeTeam.teamTricode,
            away_score: g.awayTeam.score || null,
            home_score: g.homeTeam.score || null,
            status: g.gameStatusText,
            final: g.gameStatus === 3,
          }));
        }
      }
    }

    if (sport === 'NFL') {
      // NFL season runs Sep-Feb
      if (month >= 9 || month <= 2) {
        try {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${today.replace(/-/g,'')}`);
          const d = await r.json();
          games = (d.events || []).map(e => {
            const comp = e.competitions?.[0];
            const away = comp?.competitors?.find(c=>c.homeAway==='away');
            const home = comp?.competitors?.find(c=>c.homeAway==='home');
            return {
              id: e.id,
              away: away?.team?.abbreviation || '',
              home: home?.team?.abbreviation || '',
              away_score: parseInt(away?.score) || null,
              home_score: parseInt(home?.score) || null,
              status: e.status?.type?.description || '',
              final: e.status?.type?.completed || false,
            };
          });
        } catch(e) {
          games = [];
        }
      }
    }

    res.status(200).json({ sport, date: today, games });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
