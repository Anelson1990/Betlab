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
    const [statsR, detailR] = await Promise.all([
      fetch(`${MLB_API}/people/${pitcher.id}/stats?stats=season&group=pitching&season=2025`),
      fetch(`${MLB_API}/people/${pitcher.id}`),
    ]);
    const statsData = statsR.ok ? await statsR.json() : null;
    const detailData = detailR.ok ? await detailR.json() : null;
    const stats = statsData?.stats?.[0]?.splits?.[0]?.stat;
    const throws = detailData?.people?.[0]?.pitchHand?.code || null;
    return stats ? {
      name: pitcherName,
      throws: throws, // L or R
      era: stats.era,
      whip: stats.whip,
      inningsPitched: stats.inningsPitched,
      strikeouts: stats.strikeOuts,
      walks: stats.baseOnBalls,
      homeRunsAllowed: stats.homeRuns,
    } : { name: pitcherName, throws };
  } catch { return { name: pitcherName }; }
}

async function fetchBullpenAvailability(teamId) {
  try {
    // Get yesterday's game to check pitcher usage
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate()-1);
    const yDate = yesterday.toISOString().split('T')[0];
    
    const r = await fetch(`${MLB_API}/schedule?sportId=1&startDate=${yDate}&endDate=${yDate}&hydrate=decisions,pitchingLines&teamId=${teamId}`);
    if (!r.ok) return null;
    const data = await r.json();
    const game = data.dates?.[0]?.games?.[0];
    if (!game) return {status:'Fresh',note:'No game yesterday'};
    
    // Check if team played yesterday
    const decisions = game.decisions;
    const isHome = game.teams?.home?.team?.id===teamId;
    
    // Get pitching lines for this team
    const teamPitching = game.pitchingLines?.filter(p=>p.team?.id===teamId)||[];
    
    // Find closer/high leverage pitchers (pitched in 7th+ inning)
    const relieverUsage = teamPitching
      .filter(p=>p.inningsPitched && parseFloat(p.inningsPitched) < 2)
      .map(p=>({name:p.fullName, pitches:p.pitchesThrown||0, innings:p.inningsPitched}));
    
    const heavyUsage = relieverUsage.filter(p=>p.pitches>=20);
    const closerUsed = decisions?.save && teamPitching.some(p=>p.fullName===decisions.save?.fullName);
    
    return {
      playedYesterday: true,
      closerUsed: closerUsed||false,
      heavyUsagePitchers: heavyUsage.length,
      relieverUsage: relieverUsage.slice(0,3),
      status: heavyUsage.length>=2 ? 'Taxed' : heavyUsage.length>=1 ? 'Slightly Taxed' : 'Fresh',
    };
  } catch { return null; }
}

async function fetchESPNOdds(espnGameId) {
  if (!espnGameId) return null;
  try {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${espnGameId}/competitions/${espnGameId}/odds`);
    if (!r.ok) return null;
    const d = await r.json();
    const item = d.items?.[0];
    if (!item) return null;
    return {
      provider: item.provider?.name,
      overUnder: item.overUnder,
      spread: item.spread,
      overOdds: item.overOdds,
      underOdds: item.underOdds,
      homeMl: item.homeTeamOdds?.moneyLine,
      awayMl: item.awayTeamOdds?.moneyLine,
      details: item.details,
    };
  } catch { return null; }
}

async function fetchESPNWinProb(espnGameId) {
  if (!espnGameId) return null;
  try {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${espnGameId}/competitions/${espnGameId}/probabilities?limit=1`);
    if (!r.ok) return null;
    const d = await r.json();
    const item = d.items?.[0];
    return item ? { homeWinPct: item.homeWinPercentage, awayWinPct: item.awayWinPercentage } : null;
  } catch { return null; }
}

async function fetchRecentForm(teamId) {
  try {
    const r = await fetch(`${MLB_API}/teams/${teamId}/stats?stats=gameLog&group=hitting&season=2025`);
    if (!r.ok) return null;
    const data = await r.json();
    const games = data.stats?.[0]?.splits?.slice(-10)||[];
    const wins10 = games.filter(g=>g.isWin).length;
    const last5 = games.slice(-5);
    const last3 = games.slice(-3);
    const wins5 = last5.filter(g=>g.isWin).length;
    const wins3 = last3.filter(g=>g.isWin).length;
    // Get runs scored from game log
    const runsL5 = last5.reduce((a,g)=>a+(g.stat?.runs||0),0);
    const runsAllowedL5 = last5.reduce((a,g)=>a+(g.stat?.runsAllowed||0),0);
    return {
      last10:`${wins10}-${games.length-wins10}`,
      last5:`${wins5}-${last5.length-wins5}`,
      last3:`${wins3}-${last3.length-wins3}`,
      avgRS_L5: last5.length?(runsL5/last5.length).toFixed(1):null,
      avgRA_L5: last5.length?(runsAllowedL5/last5.length).toFixed(1):null,
    };
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

async function fetchMLBInjuries(teamName) {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries');
    if (!r.ok) return [];
    const data = await r.json();
    const teamData = data.injuries?.find(t=>t.displayName?.toLowerCase().includes(teamName.toLowerCase()));
    if (!teamData) return [];
    return teamData.injuries?.map(i=>({
      player: i.athlete?.displayName,
      status: i.status,
      comment: i.shortComment,
    }))||[];
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET');

  const { home, away, espnGameId } = req.query;
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

    const [homePitcher, awayPitcher, homeInjuries, awayInjuries, espnOdds, espnWinProb] = await Promise.all([
      homePitcherName ? fetchPitcherStats(homePitcherName) : null,
      awayPitcherName ? fetchPitcherStats(awayPitcherName) : null,
      fetchMLBInjuries(home),
      fetchMLBInjuries(away),
      espnGameId ? fetchESPNOdds(espnGameId) : Promise.resolve(null),
      espnGameId ? fetchESPNWinProb(espnGameId) : Promise.resolve(null),
    ]);

    const [homeBullpen, awayBullpen] = await Promise.all([homeId?fetchBullpenAvailability(homeId):null, awayId?fetchBullpenAvailability(awayId):null]);
    return res.status(200).json({
      success:true,
      home:{ team:home, id:homeId, stats:homeStats, recentForm:homeForm?.last10, last5:homeForm?.last5, last3:homeForm?.last3, avgRS_L5:homeForm?.avgRS_L5, avgRA_L5:homeForm?.avgRA_L5, probablePitcher:homePitcher, injuries:homeInjuries, bullpen:homeBullpen },
      away:{ team:away, id:awayId, stats:awayStats, recentForm:awayForm?.last10, last5:awayForm?.last5, last3:awayForm?.last3, avgRS_L5:awayForm?.avgRS_L5, avgRA_L5:awayForm?.avgRA_L5, probablePitcher:awayPitcher, injuries:awayInjuries, bullpen:awayBullpen },
      espnOdds, espnWinProb,
      fetchedAt: new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
