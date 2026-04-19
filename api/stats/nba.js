// NBA Stats - ESPN API (free, no key needed)
const ESPN_NBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';

const TEAM_MAP = {
  'Atlanta Hawks':'atl','Boston Celtics':'bos','Brooklyn Nets':'bkn',
  'Charlotte Hornets':'cha','Chicago Bulls':'chi','Cleveland Cavaliers':'cle',
  'Dallas Mavericks':'dal','Denver Nuggets':'den','Detroit Pistons':'det',
  'Golden State Warriors':'gs','Houston Rockets':'hou','Indiana Pacers':'ind',
  'Los Angeles Clippers':'lac','Los Angeles Lakers':'lal','Memphis Grizzlies':'mem',
  'Miami Heat':'mia','Milwaukee Bucks':'mil','Minnesota Timberwolves':'min',
  'New Orleans Pelicans':'no','New York Knicks':'ny','Oklahoma City Thunder':'okc',
  'Orlando Magic':'orl','Philadelphia 76ers':'phi','Phoenix Suns':'phx',
  'Portland Trail Blazers':'por','Sacramento Kings':'sac','San Antonio Spurs':'sa',
  'Toronto Raptors':'tor','Utah Jazz':'utah','Washington Wizards':'wsh',
};

function getAbbr(teamName) {
  if (!teamName) return null;
  if (TEAM_MAP[teamName]) return TEAM_MAP[teamName];
  for (const [name, abbr] of Object.entries(TEAM_MAP)) {
    if (teamName.toLowerCase().includes(name.split(' ').pop().toLowerCase())) return abbr;
  }
  return null;
}

async function fetchTeamData(abbr) {
  try {
    const r = await fetch(`${ESPN_NBA}/teams/${abbr}`);
    if (!r.ok) return null;
    const data = await r.json();
    const team = data.team;
    return {
      record: team?.record?.items?.[0]?.summary,
      standing: team?.standingSummary,
    };
  } catch { return null; }
}

async function fetchTeamStats(abbr) {
  try {
    const r = await fetch(`${ESPN_NBA}/teams/${abbr}/statistics`);
    if (!r.ok) return null;
    const data = await r.json();
    const cats = data.results?.stats?.categories || data.splits?.categories || [];
    
    let ppg=null, rpg=null, apg=null, fgPct=null, fg3Pct=null, tov=null, offRtg=null, defRtg=null;
    
    for (const cat of cats) {
      for (const stat of (cat.stats||cat.athletes||[])) {
        const n = stat.name||stat.shortDisplayName;
        const v = stat.value||stat.displayValue;
        if (n==='avgPoints'||n==='PTS') ppg=v;
        if (n==='avgRebounds'||n==='REB') rpg=v;
        if (n==='avgAssists'||n==='AST') apg=v;
        if (n==='avgFieldGoalPct'||n==='FG%') fgPct=v;
        if (n==='avg3PointFieldGoalPct'||n==='3P%') fg3Pct=v;
        if (n==='avgTurnovers'||n==='TO') tov=v;
        if (n==='offensiveRating'||n==='OffRtg') offRtg=v;
        if (n==='defensiveRating'||n==='DefRtg') defRtg=v;
      }
    }
    return { ppg, rpg, apg, fgPct, fg3Pct, tov, offRtg, defRtg };
  } catch { return null; }
}

async function fetchRecentForm(abbr) {
  try {
    const r = await fetch(`${ESPN_NBA}/teams/${abbr}/schedule?season=2025`);
    if (!r.ok) return null;
    const data = await r.json();
    const completed = (data.events||[]).filter(e=>e.competitions?.[0]?.status?.type?.completed);
    const last10 = completed.slice(-10).map(e=>{
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c=>c.homeAway==='home');
      const away = comp?.competitors?.find(c=>c.homeAway==='away');
      const isHome = home?.team?.slug===abbr||home?.team?.abbreviation?.toLowerCase()===abbr;
      const teamScore = parseInt(isHome?home?.score:away?.score)||0;
      const oppScore = parseInt(isHome?away?.score:home?.score)||0;
      return {
        win: teamScore>oppScore,
        score:`${teamScore}-${oppScore}`,
        opponent: isHome?away?.team?.abbreviation:home?.team?.abbreviation,
        homeAway: isHome?'home':'away',
        date: e.date,
      };
    });
    const wins = last10.filter(g=>g.win).length;
    
    // Rest days
    const lastGame = completed[completed.length-1];
    const restDays = lastGame ? Math.floor((new Date()-new Date(lastGame.date))/(1000*60*60*24)) : null;
    
    // Back to back
    const dates = completed.slice(-2).map(e=>new Date(e.date));
    const isB2B = dates.length>=2 && (dates[1]-dates[0])/(1000*60*60*24)<=1;
    
    return { last10:`${wins}-${last10.length-wins}`, restDays, isBackToBack:isB2B, games:last10.slice(-5) };
  } catch { return null; }
}

async function fetchInjuries(abbr) {
  try {
    const r = await fetch(`${ESPN_NBA}/teams/${abbr}/injuries`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.injuries||[]).slice(0,5).map(i=>({
      player: i.athlete?.displayName,
      status: i.status,
      detail: i.details?.detail||i.shortComment,
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
    const [homeData,awayData,homeStats,awayStats,homeForm,awayForm,homeInj,awayInj] = await Promise.all([
      fetchTeamData(homeAbbr),
      fetchTeamData(awayAbbr),
      fetchTeamStats(homeAbbr),
      fetchTeamStats(awayAbbr),
      fetchRecentForm(homeAbbr),
      fetchRecentForm(awayAbbr),
      fetchInjuries(homeAbbr),
      fetchInjuries(awayAbbr),
    ]);

    return res.status(200).json({
      success:true,
      home:{
        team:home, abbr:homeAbbr,
        record:homeData?.record,
        stats:homeStats,
        recentForm:homeForm?.last10,
        restDays:homeForm?.restDays,
        isBackToBack:homeForm?.isBackToBack,
        injuries:homeInj,
        recentGames:homeForm?.games,
      },
      away:{
        team:away, abbr:awayAbbr,
        record:awayData?.record,
        stats:awayStats,
        recentForm:awayForm?.last10,
        restDays:awayForm?.restDays,
        isBackToBack:awayForm?.isBackToBack,
        injuries:awayInj,
        recentGames:awayForm?.games,
      },
      fetchedAt:new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false,error:err.message});
  }
}
