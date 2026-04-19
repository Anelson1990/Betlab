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
      goalsForPerGame: team.goalFor && team.gamesPlayed ? (team.goalFor/team.gamesPlayed).toFixed(2) : null,
      goalsAgainstPerGame: team.goalAgainst && team.gamesPlayed ? (team.goalAgainst/team.gamesPlayed).toFixed(2) : null,
      powerPlayPct: team.powerPlayPct ? (team.powerPlayPct*100).toFixed(1) : null,
      penaltyKillPct: team.penaltyKillPct ? (team.penaltyKillPct*100).toFixed(1) : null,
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
          score: `${teamScore}-${oppScore}`,
          date: g.gameDate,
        };
      });
    const wins = games.filter(g=>g.win).length;
    return { last10:`${wins}-${games.length-wins}`, games:games.slice(-5) };
  } catch { return null; }
}

async function fetchTodayGoalie(abbr) {
  try {
    const r = await fetch(`${NHL_API}/schedule/now`);
    if (!r.ok) return null;
    const data = await r.json();
    const allGames = data.gameWeek?.flatMap(w=>w.games)||[];
    const game = allGames.find(g=>
      g.homeTeam?.abbrev===abbr||g.awayTeam?.abbrev===abbr
    );
    if (!game) return null;
    const isHome = game.homeTeam?.abbrev===abbr;
    const team = isHome?game.homeTeam:game.awayTeam;
    return team?.probableGoalie?.fullName||null;
  } catch { return null; }
}

async function fetchMoneyPuck(abbr) {
  try {
    const r = await fetch(`https://moneypuck.com/moneypuck/playerData/seasonSummary/2024/regular/teams.csv`);
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
    const [standings, homeForm, awayForm, homeGoalie, awayGoalie, homeMPuck, awayMPuck] = await Promise.all([
      fetchStandings(),
      fetchRecentGames(homeAbbr),
      fetchRecentGames(awayAbbr),
      fetchTodayGoalie(homeAbbr),
      fetchTodayGoalie(awayAbbr),
      fetchMoneyPuck(homeAbbr),
      fetchMoneyPuck(awayAbbr),
    ]);

    const homeStats = await fetchTeamStats(homeAbbr, standings);
    const awayStats = await fetchTeamStats(awayAbbr, standings);

    return res.status(200).json({
      success:true,
      home:{
        team:home, abbr:homeAbbr,
        stats:homeStats,
        recentForm:homeForm?.last10,
        recentGames:homeForm?.games,
        probableGoalie:homeGoalie,
        moneyPuck:homeMPuck,
      },
      away:{
        team:away, abbr:awayAbbr,
        stats:awayStats,
        recentForm:awayForm?.last10,
        recentGames:awayForm?.games,
        probableGoalie:awayGoalie,
        moneyPuck:awayMPuck,
      },
      fetchedAt:new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
