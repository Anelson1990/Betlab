const MLB_ABBREVS = {
  'Arizona Diamondbacks':'ARI','Atlanta Braves':'ATL','Baltimore Orioles':'BAL',
  'Boston Red Sox':'BOS','Chicago Cubs':'CHC','Chicago White Sox':'CHW',
  'Cincinnati Reds':'CIN','Cleveland Guardians':'CLE','Colorado Rockies':'COL',
  'Detroit Tigers':'DET','Houston Astros':'HOU','Kansas City Royals':'KCR',
  'Los Angeles Angels':'LAA','Los Angeles Dodgers':'LAD','Miami Marlins':'MIA',
  'Milwaukee Brewers':'MIL','Minnesota Twins':'MIN','New York Mets':'NYM',
  'New York Yankees':'NYY','Oakland Athletics':'OAK','Philadelphia Phillies':'PHI',
  'Pittsburgh Pirates':'PIT','San Diego Padres':'SDP','San Francisco Giants':'SFG',
  'Seattle Mariners':'SEA','St. Louis Cardinals':'STL','Tampa Bay Rays':'TBR',
  'Texas Rangers':'TEX','Toronto Blue Jays':'TOR','Washington Nationals':'WSH',
  'Athletics':'OAK','Sacramento Athletics':'OAK'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sport, date } = req.query;
  if (!sport) return res.status(400).json({ error: 'sport required' });

  const today = date || new Date().toISOString().split('T')[0];
  const month = new Date(today).getMonth() + 1;

  try {
    let games = [];

    if (sport === 'MLB') {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=linescore`);
      const d = await r.json();
      games = (d.dates?.[0]?.games || []).map(g => {
        const awayName = g.teams?.away?.team?.name || '';
        const homeName = g.teams?.home?.team?.name || '';
        return {
          id: g.gamePk,
          away: MLB_ABBREVS[awayName] || awayName.split(' ').pop().substring(0,3).toUpperCase(),
          home: MLB_ABBREVS[homeName] || homeName.split(' ').pop().substring(0,3).toUpperCase(),
          away_full: awayName,
          home_full: homeName,
          away_score: g.linescore?.teams?.away?.runs ?? null,
          home_score: g.linescore?.teams?.home?.runs ?? null,
          away_r1: g.linescore?.innings?.[0]?.away?.runs ?? null,
          home_r1: g.linescore?.innings?.[0]?.home?.runs ?? null,
          status: g.status?.detailedState || '',
          final: (g.status?.detailedState || '').includes('Final'),
        };
      });
    }

    if (sport === 'NHL') {
      const r = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`);
      const d = await r.json();
      const dayGames = d.gameWeek?.[0]?.games || [];
      games = dayGames.map(g => ({
        id: g.id,
        away: g.awayTeam?.abbrev || '',
        home: g.homeTeam?.abbrev || '',
        away_full: g.awayTeam?.name?.default || '',
        home_full: g.homeTeam?.name?.default || '',
        away_score: g.awayTeam?.score ?? null,
        home_score: g.homeTeam?.score ?? null,
        status: g.gameState || '',
        final: g.gameState === 'OFF' || g.gameState === 'FINAL',
      }));
    }

    if (sport === 'NBA' && (month >= 10 || month <= 6)) {
      try {
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
            away_full: away?.team?.displayName || '',
            home_full: home?.team?.displayName || '',
            away_score: parseInt(away?.score) || null,
            home_score: parseInt(home?.score) || null,
            status: e.status?.type?.description || '',
            final: e.status?.type?.completed || false,
          };
        });
      } catch {
        const r2 = await fetch(`https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`);
        const d2 = await r2.json();
        games = (d2.scoreboard?.games || []).map(g => ({
          id: g.gameId,
          away: g.awayTeam?.teamTricode || '',
          home: g.homeTeam?.teamTricode || '',
          away_full: g.awayTeam?.teamName || '',
          home_full: g.homeTeam?.teamName || '',
          away_score: g.awayTeam?.score || null,
          home_score: g.homeTeam?.score || null,
          status: g.gameStatusText || '',
          final: g.gameStatus === 3,
        }));
      }
    }

    if (sport === 'NFL' && (month >= 9 || month <= 2)) {
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
            away_full: away?.team?.displayName || '',
            home_full: home?.team?.displayName || '',
            away_score: parseInt(away?.score) || null,
            home_score: parseInt(home?.score) || null,
            status: e.status?.type?.description || '',
            final: e.status?.type?.completed || false,
          };
        });
      } catch { games = []; }
    }

    res.status(200).json({ sport, date: today, games });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
