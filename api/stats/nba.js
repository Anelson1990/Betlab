// NBA Stats API - balldontlie.io (free, no key needed for basic)
// Fetches team stats, recent form, rest days, back-to-backs

const BDL_API = 'https://api.balldontlie.io/v1';
const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

const TEAM_MAP = {
  'Atlanta Hawks':'ATL','Boston Celtics':'BOS','Brooklyn Nets':'BKN',
  'Charlotte Hornets':'CHA','Chicago Bulls':'CHI','Cleveland Cavaliers':'CLE',
  'Dallas Mavericks':'DAL','Denver Nuggets':'DEN','Detroit Pistons':'DET',
  'Golden State Warriors':'GSW','Houston Rockets':'HOU','Indiana Pacers':'IND',
  'Los Angeles Clippers':'LAC','Los Angeles Lakers':'LAL','Memphis Grizzlies':'MEM',
  'Miami Heat':'MIA','Milwaukee Bucks':'MIL','Minnesota Timberwolves':'MIN',
  'New Orleans Pelicans':'NOP','New York Knicks':'NYK','Oklahoma City Thunder':'OKC',
  'Orlando Magic':'ORL','Philadelphia 76ers':'PHI','Phoenix Suns':'PHX',
  'Portland Trail Blazers':'POR','Sacramento Kings':'SAC','San Antonio Spurs':'SAS',
  'Toronto Raptors':'TOR','Utah Jazz':'UTA','Washington Wizards':'WAS',
};

const BDL_TEAM_IDS = {
  'ATL':1,'BOS':2,'BKN':3,'CHA':4,'CHI':5,'CLE':6,'DAL':7,'DEN':8,
  'DET':9,'GSW':10,'HOU':11,'IND':12,'LAC':13,'LAL':14,'MEM':15,
  'MIA':16,'MIL':17,'MIN':18,'NOP':19,'NYK':20,'OKC':21,'ORL':22,
  'PHI':23,'PHX':24,'POR':25,'SAC':26,'SAS':27,'TOR':28,'UTA':29,'WAS':30,
};

function getAbbr(teamName) {
  if (!teamName) return null;
  if (TEAM_MAP[teamName]) return TEAM_MAP[teamName];
  for (const [name, abbr] of Object.entries(TEAM_MAP)) {
    if (teamName.includes(name.split(' ').pop()) || name.includes(teamName)) return abbr;
  }
  return null;
}

async function fetchTeamStats(abbr) {
  try {
    const teamId = BDL_TEAM_IDS[abbr];
    if (!teamId) return null;
    const r = await fetch(`${BDL_API}/season_averages?season=2024&team_ids[]=${teamId}`);
    if (!r.ok) return null;
    const data = await r.json();
    const stats = data.data?.[0];
    if (!stats) return null;
    return {
      pts: stats.pts,
      reb: stats.reb,
      ast: stats.ast,
      fg_pct: stats.fg_pct,
      fg3_pct: stats.fg3_pct,
      ft_pct: stats.ft_pct,
      turnover: stats.turnover,
    };
  } catch { return null; }
}

async function fetchESPNTeamData(abbr) {
  try {
    const r = await fetch(`${ESPN_API}/teams/${abbr}?enable=roster,stats`);
    if (!r.ok) return null;
    const data = await r.json();
    const team = data.team;
    return {
      record: team?.record?.items?.[0]?.summary,
      standing: team?.standingSummary,
    };
  } catch { return null; }
}

async function fetchRecentForm(abbr) {
  try {
    const teamId = BDL_TEAM_IDS[abbr];
    if (!teamId) return null;
    const r = await fetch(`${BDL_API}/games?seasons[]=2024&team_ids[]=${teamId}&per_page=10&sort=date&order=desc`);
    if (!r.ok) return null;
    const data = await r.json();
    const games = data.data||[];
    let wins = 0;
    const results = games.map(g=>{
      const isHome = g.home_team?.abbreviation===abbr;
      const teamScore = isHome?g.home_team_score:g.visitor_team_score;
      const oppScore = isHome?g.visitor_team_score:g.home_team_score;
      const win = teamScore>oppScore;
      if(win) wins++;
      return { win, score:`${teamScore}-${oppScore}`, date:g.date, homeAway:isHome?'home':'away' };
    });
    // Check back-to-back
    const sortedDates = games.map(g=>new Date(g.date)).sort((a,b)=>b-a);
    const isBackToBack = sortedDates.length>=2 &&
      (sortedDates[0]-sortedDates[1])/(1000*60*60*24) <= 1;
    const restDays = sortedDates.length>=1 ?
      Math.floor((new Date()-sortedDates[0])/(1000*60*60*24)) : null;
    return {
      last10: `${wins}-${results.length-wins}`,
      isBackToBack,
      restDays,
      games: results.slice(0,5),
    };
  } catch { return null; }
}

async function fetchInjuries(abbr) {
  try {
    const r = await fetch(`${ESPN_API}/teams/${abbr}/injuries`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.injuries||[]).slice(0,5).map(i=>({
      player: i.athlete?.displayName,
      status: i.status,
      detail: i.details?.detail,
    }));
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET');

  const { home, away } = req.query;
  if (!home||!away) return res.status(400).json({error:'Missing home/away'});

  const homeAbbr = getAbbr(home);
  const awayAbbr = getAbbr(away);
  if (!homeAbbr||!awayAbbr) return res.status(400).json({error:`Team not found: ${!homeAbbr?home:away}`});

  try {
    const [homeStats, awayStats, homeForm, awayForm, homeESPN, awayESPN, homeInjuries, awayInjuries] = await Promise.all([
      fetchTeamStats(homeAbbr),
      fetchTeamStats(awayAbbr),
      fetchRecentForm(homeAbbr),
      fetchRecentForm(awayAbbr),
      fetchESPNTeamData(homeAbbr),
      fetchESPNTeamData(awayAbbr),
      fetchInjuries(homeAbbr),
      fetchInjuries(awayAbbr),
    ]);

    return res.status(200).json({
      success:true,
      home:{
        team:home, abbr:homeAbbr,
        stats:homeStats,
        recentForm:homeForm?.last10,
        isBackToBack:homeForm?.isBackToBack,
        restDays:homeForm?.restDays,
        record:homeESPN?.record,
        injuries:homeInjuries,
        recentGames:homeForm?.games,
      },
      away:{
        team:away, abbr:awayAbbr,
        stats:awayStats,
        recentForm:awayForm?.last10,
        isBackToBack:awayForm?.isBackToBack,
        restDays:awayForm?.restDays,
        record:awayESPN?.record,
        injuries:awayInjuries,
        recentGames:awayForm?.games,
      },
      fetchedAt:new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false,error:err.message});
  }
}
