// MLB Stats API - Official MLB Stats API (free, no key needed)
// Fetches team stats, starting pitchers, lineups, bullpen, recent form

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const TEAM_MAP = {
  'Arizona Diamondbacks':109,'Atlanta Braves':144,'Baltimore Orioles':110,
  'Boston Red Sox':111,'Chicago Cubs':112,'Chicago White Sox':145,
  'Cincinnati Reds':113,'Cleveland Guardians':114,'Colorado Rockies':115,
  'Detroit Tigers':116,'Houston Astros':117,'Kansas City Royals':118,
  'Los Angeles Angels':108,'Los Angeles Dodgers':119,'Miami Marlins':146,
  'Milwaukee Brewers':158,'Minnesota Twins':142,'New York Mets':121,
  'New York Yankees':147,'Oakland Athletics':133,'Philadelphia Phillies':143,
  'Pittsburgh Pirates':134,'San Diego Padres':135,'San Francisco Giants':137,
  'Seattle Mariners':136,'St. Louis Cardinals':138,'Tampa Bay Rays':139,
  'Texas Rangers':140,'Toronto Blue Jays':141,'Washington Nationals':120,
  'Athletics':133,
};

function getTeamId(teamName) {
  if (!teamName) return null;
  if (TEAM_MAP[teamName]) return TEAM_MAP[teamName];
  for (const [name, id] of Object.entries(TEAM_MAP)) {
    if (teamName.includes(name.split(' ').pop()) || name.includes(teamName)) return id;
  }
  return null;
}

async function fetchTeamStats(teamId) {
  try {
    const r = await fetch(`${MLB_API}/teams/${teamId}/stats?stats=season&group=pitching,hitting&season=2025`);
    if (!r.ok) return null;
    const data = await r.json();
    const hitting = data.stats?.find(s=>s.group?.displayName==='hitting')?.splits?.[0]?.stat;
    const pitching = data.stats?.find(s=>s.group?.displayName==='pitching')?.splits?.[0]?.stat;
    return {
      batting: {
        avg: hitting?.avg,
        ops: hitting?.ops,
        runsPerGame: hitting?.runs && hitting?.gamesPlayed ? (hitting.runs/hitting.gamesPlayed).toFixed(2) : null,
        homeRuns: hitting?.homeRuns,
      },
      pitching: {
        era: pitching?.era,
        whip: pitching?.whip,
        strikeoutsPerGame: pitching?.strikeOuts && pitching?.gamesPlayed ? (pitching.strikeOuts/pitching.gamesPlayed).toFixed(1) : null,
      },
    };
  } catch { return null; }
}

async function fetchTodayPitcher(teamId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await fetch(`${MLB_API}/schedule?sportId=1&date=${today}&hydrate=probablePitcher`);
    if (!r.ok) return null;
    const data = await r.json();
    const games = data.dates?.[0]?.games||[];
    const game = games.find(g=>
      g.teams?.home?.team?.id===teamId||
      g.teams?.away?.team?.id===teamId
    );
    if (!game) return null;
    const isHome = game.teams?.home?.team?.id===teamId;
    const pitcher = isHome?game.teams?.home?.probablePitcher:game.teams?.away?.probablePitcher;
    return pitcher?.fullName||null;
  } catch { return null; }
}

async function fetchPitcherStats(pitcherName) {
  try {
    const r = await fetch(`${MLB_API}/people/search?names=${encodeURIComponent(pitcherName)}`);
    if (!r.ok) return null;
    const data = await r.json();
    const pitcher = data.people?.[0];
    if (!pitcher) return null;
    const statsR = await fetch(`${MLB_API}/people/${pitcher.id}/stats?stats=season&group=pitching&season=2025`);
    if (!statsR.ok) return null;
    const statsData = await statsR.json();
    const stats = statsData.stats?.[0]?.splits?.[0]?.stat;
    return stats ? {
      name: pitcherName,
      era: stats.era,
      whip: stats.whip,
      inningsPitched: stats.inningsPitched,
      strikeouts: stats.strikeOuts,
      walks: stats.baseOnBalls,
      homeRunsAllowed: stats.homeRuns,
    } : { name: pitcherName };
  } catch { return { name: pitcherName }; }
}

async function fetchRecentForm(teamId) {
  try {
    const r = await fetch(`${MLB_API}/teams/${teamId}/stats?stats=gameLog&group=hitting&season=2025`);
    if (!r.ok) return null;
    const data = await r.json();
    const games = data.stats?.[0]?.splits?.slice(-10)||[];
    const wins = games.filter(g=>g.isWin).length;
    return { last10:`${wins}-${games.length-wins}`, games:games.length };
  } catch { return null; }
}

async function fetchStatcast(pitcherId) {
  try {
    // Baseball Savant Statcast - free, no key needed
    const url = `https://baseballsavant.mlb.com/statcast_search/csv?hfPT=&hfAB=&hfGT=R%7C&hfPR=&hfZ=&hfStadium=&hfBBL=&hfNewZones=&hfPull=&hfC=&hfSea=2025%7C&hfSit=&player_type=pitcher&hfOuts=&hfOpponent=&pitcher_throws=&batter_stands=&hfSA=&game_date_gt=&game_date_lt=&hfMo=&hfTeam=&home_road=&hfRO=&position=&hfInfield=&hfOutfield=&hfInn=&hfBBT=&batters_lookup%5B%5D=&pitchers_lookup%5B%5D=${pitcherId}&team=&position=&hfLandmark=&hfInn=&hfBBT=&metric_1=&hfInn=&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0&type=details`;
    // Use the simpler summary endpoint instead
    const summaryUrl = `https://baseballsavant.mlb.com/player-services/metrics?playerId=${pitcherId}&position=SP&year=2025&type=pitcher`;
    const r = await fetch(summaryUrl, {
      headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}
    });
    if (!r.ok) return null;
    const data = await r.json();
    return {
      xera: data.xera,
      hardHitPct: data.hard_hit_percent,
      barrelPct: data.barrel_batted_rate,
      kPct: data.k_percent,
      bbPct: data.bb_percent,
      xwoba: data.xwoba,
    };
  } catch { return null; }
}

async function fetchPitcherStatcast(pitcherName, mlbId) {
  if (!mlbId) return null;
  try {
    return await fetchStatcast(mlbId);
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET');

  const { home, away } = req.query;
  if (!home||!away) return res.status(400).json({error:'Missing home/away'});

  const homeId = getTeamId(home);
  const awayId = getTeamId(away);
  if (!homeId||!awayId) return res.status(400).json({error:`Team not found: ${!homeId?home:away}`});

  try {
    const [homeStats, awayStats, homeForm, awayForm, homePitcherName, awayPitcherName] = await Promise.all([
      fetchTeamStats(homeId),
      fetchTeamStats(awayId),
      fetchRecentForm(homeId),
      fetchRecentForm(awayId),
      fetchTodayPitcher(homeId),
      fetchTodayPitcher(awayId),
    ]);

    const [homePitcher, awayPitcher] = await Promise.all([
      homePitcherName ? fetchPitcherStats(homePitcherName) : null,
      awayPitcherName ? fetchPitcherStats(awayPitcherName) : null,
    ]);

    return res.status(200).json({
      success:true,
      home:{ team:home, id:homeId, stats:homeStats, recentForm:homeForm?.last10, probablePitcher:homePitcher },
      away:{ team:away, id:awayId, stats:awayStats, recentForm:awayForm?.last10, probablePitcher:awayPitcher },
      fetchedAt: new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
