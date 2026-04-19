const NHL_API = 'https://api-web.nhle.com/v1';

const TEAM_MAP = {
  'Anaheim Ducks':'ANA','Arizona Coyotes':'ARI','Boston Bruins':'BOS',
  'Buffalo Sabres':'BUF','Calgary Flames':'CGY','Carolina Hurricanes':'CAR',
  'Chicago Blackhawks':'CHI','Colorado Avalanche':'COL','Columbus Blue Jackets':'CBJ',
  'Dallas Stars':'DAL','Detroit Red Wings':'DET','Edmonton Oilers':'EDM',
  'Florida Panthers':'FLA','Los Angeles Kings':'LAK','Minnesota Wild':'MIN',
  'Montreal Canadiens':'MTL','Montréal Canadiens':'MTL','Nashville Predators':'NSH',
  'New Jersey Devils':'NJD','New York Islanders':'NYI','New York Rangers':'NYR',
  'Ottawa Senators':'OTT','Philadelphia Flyers':'PHI','Pittsburgh Penguins':'PIT',
  'San Jose Sharks':'SJS','Seattle Kraken':'SEA','St. Louis Blues':'STL',
  'Tampa Bay Lightning':'TBL','Toronto Maple Leafs':'TOR','Utah Mammoth':'UTA',
  'Vancouver Canucks':'VAN','Vegas Golden Knights':'VGK','Washington Capitals':'WSH',
  'Winnipeg Jets':'WPG',
};

// Daily Faceoff team name mapping
const DFO_TEAM_MAP = {
  'ANA':'Anaheim','BOS':'Boston','BUF':'Buffalo','CGY':'Calgary','CAR':'Carolina',
  'CHI':'Chicago','COL':'Colorado','CBJ':'Columbus','DAL':'Dallas','DET':'Detroit',
  'EDM':'Edmonton','FLA':'Florida','LAK':'Los Angeles','MIN':'Minnesota',
  'MTL':'Montreal','NSH':'Nashville','NJD':'New Jersey','NYI':'NY Islanders',
  'NYR':'NY Rangers','OTT':'Ottawa','PHI':'Philadelphia','PIT':'Pittsburgh',
  'SJS':'San Jose','SEA':'Seattle','STL':'St. Louis','TBL':'Tampa Bay',
  'TOR':'Toronto','UTA':'Utah','VAN':'Vancouver','VGK':'Vegas','WSH':'Washington',
  'WPG':'Winnipeg',
};

function getAbbr(teamName) {
  if (!teamName) return null;
  if (TEAM_MAP[teamName]) return TEAM_MAP[teamName];
  for (const [name, abbr] of Object.entries(TEAM_MAP)) {
    if (teamName.toLowerCase().includes(name.split(' ').pop().toLowerCase())) return abbr;
  }
  return null;
}

async function fetchStandings() {
  try {
    const r = await fetch(`${NHL_API}/standings/now`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchTeamStats(abbr, standings) {
  try {
    if (!standings?.standings) return null;
    const team = standings.standings.find(t=>t.teamAbbrev?.default===abbr);
    if (!team) return null;
    return {
      wins: team.wins,
      losses: team.losses,
      otLosses: team.otLosses,
      points: team.points,
      goalsForPerGame: team.goalFor&&team.gamesPlayed?(team.goalFor/team.gamesPlayed).toFixed(2):null,
      goalsAgainstPerGame: team.goalAgainst&&team.gamesPlayed?(team.goalAgainst/team.gamesPlayed).toFixed(2):null,
      powerPlayPct: team.powerPlayPct?(team.powerPlayPct*100).toFixed(1):null,
      penaltyKillPct: team.penaltyKillPct?(team.penaltyKillPct*100).toFixed(1):null,
      homeRecord: `${team.homeWins}-${team.homeLosses}-${team.homeOtLosses}`,
      awayRecord: `${team.roadWins}-${team.roadLosses}-${team.roadOtLosses}`,
      last10: `${team.l10Wins}-${team.l10Losses}-${team.l10OtLosses}`,
      streak: team.streakCode,
      gamesPlayed: team.gamesPlayed,
    };
  } catch { return null; }
}

async function fetchRecentGames(abbr) {
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
          score:`${teamScore}-${oppScore}`,
          date: g.gameDate,
        };
      });
    const wins = games.filter(g=>g.win).length;
    return { last10:`${wins}-${games.length-wins}`, games:games.slice(-5) };
  } catch { return null; }
}

async function fetchDailyFaceoffGoalies() {
  try {
    const r = await fetch('https://www.dailyfaceoff.com/starting-goalies', {
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':'text/html',
      }
    });
    if (!r.ok) return {};
    const html = await r.text();
    const goalies = {};
    
    // Parse goalie names from Daily Faceoff HTML
    // Look for patterns like "Frederik Andersen" near team names
    const teamMatches = html.matchAll(/class="[^"]*goalie[^"]*"[^>]*>([^<]+)</gi);
    const nameMatches = html.matchAll(/([A-Z][a-z]+ [A-Z][a-z]+(?:-[A-Z][a-z]+)?)\s*<\/(?:a|span|div|h[1-6])[^>]*>/g);
    
    // Try JSON-LD structured data first
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        // Extract from structured data if available
      } catch {}
    }

    // Parse game blocks - look for team abbreviations near goalie names
    for (const [abbr, city] of Object.entries(DFO_TEAM_MAP)) {
      const cityRegex = new RegExp(`${city}[\\s\\S]{0,500}?([A-Z][a-z]+ [A-Z][a-z]+(?:-[A-Z][a-z]+)?)`, 'i');
      const match = html.match(cityRegex);
      if (match) goalies[abbr] = match[1];
    }
    
    return goalies;
  } catch { return {}; }
}

async function fetchGoalieStats(goalieName) {
  try {
    // Search NHL API for goalie stats
    const r = await fetch(`https://api-web.nhle.com/v1/player-search?queryString=${encodeURIComponent(goalieName)}&culture=en-us`);
    if (!r.ok) return null;
    const data = await r.json();
    const player = data.players?.[0];
    if (!player) return null;
    
    const statsR = await fetch(`https://api-web.nhle.com/v1/player/${player.playerId}/landing`);
    if (!statsR.ok) return null;
    const statsData = await statsR.json();
    const season = statsData.seasonTotals?.find(s=>s.season===20242025&&s.gameTypeId===2);
    
    return season ? {
      name: goalieName,
      gaa: season.goalsAgainstAvg?.toFixed(2),
      savePct: season.savePctg?.toFixed(3),
      wins: season.wins,
      losses: season.losses,
      shutouts: season.shutouts,
      gamesPlayed: season.gamesPlayed,
    } : { name: goalieName };
  } catch { return { name: goalieName }; }
}

async function fetchMoneyPuck(abbr) {
  try {
    const r = await fetch('https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/teams.csv');
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.split('\n');
    const headers = lines[0].split(',');
    const teamLine = lines.find(l=>l.startsWith(abbr+','));
    if (!teamLine) return null;
    const vals = teamLine.split(',');
    const row = {};
    headers.forEach((h,i)=>row[h.trim()]=vals[i]?.trim());
    return {
      xGoalsFor: row['xGoalsFor'],
      xGoalsAgainst: row['xGoalsAgainst'],
      xGoalsForPct: row['xGoalsForPercentage'],
      corsiForPct: row['corsiForPercentage'],
      fenwickForPct: row['fenwickForPercentage'],
      highDangerGoalsFor: row['highDangerGoalsFor'],
      highDangerGoalsAgainst: row['highDangerGoalsAgainst'],
      shotAttemptsFor: row['shotAttemptsFor'],
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET');

  const { home, away } = req.query;
  if (!home||!away) return res.status(400).json({error:'Missing home/away'});

  const homeAbbr = getAbbr(home);
  const awayAbbr = getAbbr(away);
  if (!homeAbbr||!awayAbbr) return res.status(400).json({
    error:`Team not found: ${!homeAbbr?home:away}`
  });

  try {
    const [standings, homeForm, awayForm, dfoGoalies, homeMPuck, awayMPuck] = await Promise.all([
      fetchStandings(),
      fetchRecentGames(homeAbbr),
      fetchRecentGames(awayAbbr),
      fetchDailyFaceoffGoalies(),
      fetchMoneyPuck(homeAbbr),
      fetchMoneyPuck(awayAbbr),
    ]);

    const homeStats = await fetchTeamStats(homeAbbr, standings);
    const awayStats = await fetchTeamStats(awayAbbr, standings);

    // Get goalie names from Daily Faceoff
    const homeGoalieName = dfoGoalies[homeAbbr]||null;
    const awayGoalieName = dfoGoalies[awayAbbr]||null;

    // Fetch goalie stats if we have names
    const [homeGoalie, awayGoalie] = await Promise.all([
      homeGoalieName ? fetchGoalieStats(homeGoalieName) : null,
      awayGoalieName ? fetchGoalieStats(awayGoalieName) : null,
    ]);

    return res.status(200).json({
      success:true,
      home:{
        team:home, abbr:homeAbbr,
        stats:homeStats,
        recentForm:homeForm?.last10,
        recentGames:homeForm?.games,
        probableGoalie:homeGoalie||homeGoalieName,
        moneyPuck:homeMPuck,
      },
      away:{
        team:away, abbr:awayAbbr,
        stats:awayStats,
        recentForm:awayForm?.last10,
        recentGames:awayForm?.games,
        probableGoalie:awayGoalie||awayGoalieName,
        moneyPuck:awayMPuck,
      },
      fetchedAt:new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
