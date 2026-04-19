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

const TEAM_NAMES_TO_ABBR = {
  'carolina':' CAR','hurricanes':'CAR','ottawa':'OTT','senators':'OTT',
  'minnesota':'MIN','wild':'MIN','dallas':'DAL','stars':'DAL',
  'philadelphia':'PHI','flyers':'PHI','pittsburgh':'PIT','penguins':'PIT',
  'los angeles':'LAK','kings':'LAK','colorado':'COL','avalanche':'COL',
  'montreal':'MTL','canadiens':'MTL','tampa bay':'TBL','lightning':'TBL',
  'boston':'BOS','bruins':'BOS','buffalo':'BUF','sabres':'BUF',
  'utah':'UTA','mammoth':'UTA','vegas':'VGK','golden knights':'VGK',
  'anaheim':'ANA','ducks':'ANA','edmonton':'EDM','oilers':'EDM',
  'florida':'FLA','panthers':'FLA','toronto':'TOR','maple leafs':'TOR',
  'vancouver':'VAN','canucks':'VAN','winnipeg':'WPG','jets':'WPG',
  'new york rangers':'NYR','rangers':'NYR','new york islanders':'NYI','islanders':'NYI',
  'new jersey':'NJD','devils':'NJD','seattle':'SEA','kraken':'SEA',
  'chicago':'CHI','blackhawks':'CHI','detroit':'DET','red wings':'DET',
  'nashville':'NSH','predators':'NSH','san jose':'SJS','sharks':'SJS',
  'washington':'WSH','capitals':'WSH','st. louis':'STL','blues':'STL',
  'columbus':'CBJ','blue jackets':'CBJ','calgary':'CGY','flames':'CGY',
  'new jersey':'NJD','devils':'NJD',
};

function getAbbr(teamName) {
  if (!teamName) return null;
  if (TEAM_MAP[teamName]) return TEAM_MAP[teamName];
  const lower = teamName.toLowerCase();
  for (const [key, abbr] of Object.entries(TEAM_NAMES_TO_ABBR)) {
    if (lower.includes(key)) return abbr.trim();
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
      homeRecord:`${team.homeWins}-${team.homeLosses}-${team.homeOtLosses}`,
      awayRecord:`${team.roadWins}-${team.roadLosses}-${team.roadOtLosses}`,
      last10:`${team.l10Wins}-${team.l10Losses}-${team.l10OtLosses}`,
      streak:team.streakCode,
      gamesPlayed:team.gamesPlayed,
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
          opponent:isHome?g.awayTeam?.abbrev:g.homeTeam?.abbrev,
          homeAway:isHome?'home':'away',
          win:teamScore>oppScore,
          score:`${teamScore}-${oppScore}`,
          date:g.gameDate,
        };
      });
    const wins = games.filter(g=>g.win).length;
    return { last10:`${wins}-${games.length-wins}`, games:games.slice(-5) };
  } catch { return null; }
}

async function fetchDailyFaceoffGoalies(homeAbbr, awayAbbr) {
  try {
    const r = await fetch('https://www.dailyfaceoff.com/starting-goalies', {
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml',
        'Accept-Language':'en-US,en;q=0.9',
      }
    });
    if (!r.ok) return {};
    const html = await r.text();

    const goalies = {};

    // Extract goalie names - pattern confirmed working
    const goalieMatches = [...html.matchAll(/text-lg xl:text-2xl[^>]*>([A-Z][a-z]+\s+[A-Z][a-zA-Z-]+)</g)];

    // Extract game matchups
    const gameMatches = [...html.matchAll(/text-3xl text-white[^>]*>([^<]+?)<!--[^>]*-->\s*at\s*<!--[^>]*-->([^<]+?)</g)];

    gameMatches.forEach((game, idx) => {
      const awayTeamName = game[1].trim();
      const homeTeamName = game[2].trim();
      const awayGoalie = goalieMatches[idx*2]?.[1]?.trim();
      const homeGoalie = goalieMatches[idx*2+1]?.[1]?.trim();
      const awayAb = getAbbr(awayTeamName);
      const homeAb = getAbbr(homeTeamName);
      if (awayAb && awayGoalie) goalies[awayAb] = awayGoalie;
      if (homeAb && homeGoalie) goalies[homeAb] = homeGoalie;
    });

    return goalies;
  } catch(e) {
    console.error('DFO error:', e.message);
    return {};
  }
}

async function fetchGoalieStats(goalieName) {
  try {
    const r = await fetch(`${NHL_API}/player-search?queryString=${encodeURIComponent(goalieName)}&culture=en-us`);
    if (!r.ok) return { name: goalieName };
    const data = await r.json();
    const player = data.players?.find(p=>p.positionCode==='G');
    if (!player) return { name: goalieName };

    const statsR = await fetch(`${NHL_API}/player/${player.playerId}/landing`);
    if (!statsR.ok) return { name: goalieName };
    const statsData = await statsR.json();
    const season = statsData.seasonTotals?.find(s=>s.season===20242025&&s.gameTypeId===2)
      || statsData.seasonTotals?.[0];

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
      fetchDailyFaceoffGoalies(homeAbbr, awayAbbr),
      fetchMoneyPuck(homeAbbr),
      fetchMoneyPuck(awayAbbr),
    ]);

    const homeStats = await fetchTeamStats(homeAbbr, standings);
    const awayStats = await fetchTeamStats(awayAbbr, standings);

    const homeGoalieName = dfoGoalies[homeAbbr]||null;
    const awayGoalieName = dfoGoalies[awayAbbr]||null;

    const [homeGoalie, awayGoalie] = await Promise.all([
      homeGoalieName ? fetchGoalieStats(homeGoalieName) : Promise.resolve(null),
      awayGoalieName ? fetchGoalieStats(awayGoalieName) : Promise.resolve(null),
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
      allDFOGoalies:dfoGoalies,
      fetchedAt:new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false,error:err.message});
  }
}
