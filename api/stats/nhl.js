// NHL Stats API - Official NHL Stats API (free, no key needed)
// Fetches team stats, goalie starters, injuries, recent form

const NHL_API = 'https://api-web.nhle.com/v1';
const NHL_STATS = 'https://api.nhle.com/stats/rest/en';

// Team abbreviation map
const TEAM_MAP = {
  'Anaheim Ducks':'ANA','Arizona Coyotes':'ARI','Boston Bruins':'BOS',
  'Buffalo Sabres':'BUF','Calgary Flames':'CGY','Carolina Hurricanes':'CAR',
  'Chicago Blackhawks':'CHI','Colorado Avalanche':'COL','Columbus Blue Jackets':'CBJ',
  'Dallas Stars':'DAL','Detroit Red Wings':'DET','Edmonton Oilers':'EDM',
  'Florida Panthers':'FLA','Los Angeles Kings':'LAK','Minnesota Wild':'MIN',
  'Montreal Canadiens':'MTL','Nashville Predators':'NSH','New Jersey Devils':'NJD',
  'New York Islanders':'NYI','New York Rangers':'NYR','Ottawa Senators':'OTT',
  'Philadelphia Flyers':'PHI','Pittsburgh Penguins':'PIT','San Jose Sharks':'SJS',
  'Seattle Kraken':'SEA','St. Louis Blues':'STL','Tampa Bay Lightning':'TBL',
  'Toronto Maple Leafs':'TOR','Utah Mammoth':'UTA','Vancouver Canucks':'VAN',
  'Vegas Golden Knights':'VGK','Washington Capitals':'WSH','Winnipeg Jets':'WPG',
};

function getAbbr(teamName) {
  if (!teamName) return null;
  // Direct match
  if (TEAM_MAP[teamName]) return TEAM_MAP[teamName];
  // Partial match
  for (const [name, abbr] of Object.entries(TEAM_MAP)) {
    if (teamName.includes(name.split(' ').pop())) return abbr;
  }
  return null;
}

async function fetchTeamStats(abbr) {
  try {
    const r = await fetch(`${NHL_API}/club-stats/${abbr}/now`);
    if (!r.ok) return null;
    const data = await r.json();
    return {
      gamesPlayed: data.gamesPlayed,
      wins: data.wins,
      losses: data.losses,
      otLosses: data.otLosses,
      points: data.points,
      goalsForPerGame: data.goalsForPerGame,
      goalsAgainstPerGame: data.goalsAgainstPerGame,
      powerPlayPct: data.powerPlayPct,
      penaltyKillPct: data.penaltyKillPct,
      shotsForPerGame: data.shotsForPerGame,
      shotsAgainstPerGame: data.shotsAgainstPerGame,
    };
  } catch { return null; }
}

async function fetchRecentForm(abbr) {
  try {
    const r = await fetch(`${NHL_API}/club-schedule-season/${abbr}/now`);
    if (!r.ok) return null;
    const data = await r.json();
    const games = (data.games||[])
      .filter(g=>g.gameState==='OFF'||g.gameState==='FINAL')
      .slice(-10)
      .map(g=>{
        const isHome = g.homeTeam?.abbrev===abbr;
        const teamScore = isHome?g.homeTeam?.score:g.awayTeam?.score;
        const oppScore = isHome?g.awayTeam?.score:g.homeTeam?.score;
        return {
          opponent: isHome?g.awayTeam?.abbrev:g.homeTeam?.abbrev,
          homeAway: isHome?'home':'away',
          win: teamScore>oppScore,
          score: `${teamScore}-${oppScore}`,
          date: g.gameDate,
        };
      });
    const last10 = games.slice(-10);
    const wins = last10.filter(g=>g.win).length;
    return { last10: `${wins}-${last10.length-wins}`, games: last10 };
  } catch { return null; }
}

async function fetchTodayGoalie(abbr) {
  try {
    const r = await fetch(`${NHL_API}/schedule/now`);
    if (!r.ok) return null;
    const data = await r.json();
    const today = data.gameWeek?.[0]?.games||[];
    const game = today.find(g=>
      g.homeTeam?.abbrev===abbr||g.awayTeam?.abbrev===abbr
    );
    if (!game) return null;
    const isHome = game.homeTeam?.abbrev===abbr;
    const team = isHome?game.homeTeam:game.awayTeam;
    return team?.probableGoalie?.fullName||null;
  } catch { return null; }
}

async function fetchInjuries(abbr) {
  try {
    const r = await fetch(`${NHL_API}/roster/${abbr}/current`);
    if (!r.ok) return [];
    // NHL API doesn't have direct injury endpoint - return empty for now
    return [];
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET');

  const { home, away } = req.query;
  if (!home||!away) return res.status(400).json({error:'Missing home/away team names'});

  const homeAbbr = getAbbr(home);
  const awayAbbr = getAbbr(away);

  if (!homeAbbr||!awayAbbr) return res.status(400).json({
    error:`Could not find team: ${!homeAbbr?home:away}`,
    available: Object.keys(TEAM_MAP),
  });

  try {
    const [homeStats, awayStats, homeForm, awayForm, homeGoalie, awayGoalie] = await Promise.all([
      fetchTeamStats(homeAbbr),
      fetchTeamStats(awayAbbr),
      fetchRecentForm(homeAbbr),
      fetchRecentForm(awayAbbr),
      fetchTodayGoalie(homeAbbr),
      fetchTodayGoalie(awayAbbr),
    ]);

    const result = {
      home: {
        team: home,
        abbr: homeAbbr,
        stats: homeStats,
        recentForm: homeForm?.last10,
        recentGames: homeForm?.games?.slice(-5),
        probableGoalie: homeGoalie,
      },
      away: {
        team: away,
        abbr: awayAbbr,
        stats: awayStats,
        recentForm: awayForm?.last10,
        recentGames: awayForm?.games?.slice(-5),
        probableGoalie: awayGoalie,
      },
      fetchedAt: new Date().toISOString(),
    };

    return res.status(200).json({success:true, ...result});
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
