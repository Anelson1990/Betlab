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

async function fetchNBAInjuries(teamName) {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries');
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

const TOURNAMENT_SURFACES = {
  'Madrid':'Clay','Monte Carlo':'Clay','Rome':'Clay','Roland Garros':'Clay',
  'French Open':'Clay','Barcelona':'Clay','Hamburg':'Clay','Munich':'Clay',
  'Wimbledon':'Grass','Halle':'Grass','Queens':'Grass','Stuttgart':'Grass',
  'Australian Open':'Hard','US Open':'Hard','Indian Wells':'Hard',
  'Miami':'Hard','Cincinnati':'Hard','Toronto':'Hard','Montreal':'Hard',
  'Shanghai':'Hard','Paris':'Hard','Beijing':'Hard',
};
const TE_HEADERS = {'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'};
const SURF_CODE = {'Clay':'2','Hard':'4','Grass':'1'};

function getSurface(name){
  for(const[k,v]of Object.entries(TOURNAMENT_SURFACES))
    if(name.toLowerCase().includes(k.toLowerCase()))return v;
  return 'Hard';
}

async function fetchTennisPlayerStats(slug, surface) {
  try {
    const r = await fetch(`https://www.tennisexplorer.com/player/${slug}/`,{headers:TE_HEADERS});
    if(!r.ok) return null;
    const html = await r.text();
    const sc = SURF_CODE[surface]||'4';
    const cm = html.match(new RegExp(`surface=${sc}">(\d+)/(\d+)<`));
    const rm = html.match(new RegExp(`annual=2026&amp;surface=${sc}"[^>]*>(\d+)/(\d+)<`));
    const om = html.match(/2026"[^>]*class="bold">(\d+)\/(\d+)/);
    return {
      slug, surface,
      careerWins: cm?parseInt(cm[1]):null,
      careerTotal: cm?parseInt(cm[1])+parseInt(cm[2]):null,
      careerWinPct: cm?parseInt(cm[1])/(parseInt(cm[1])+parseInt(cm[2])):null,
      careerRecord: cm?`${cm[1]}W-${cm[2]}L`:null,
      recentWins: rm?parseInt(rm[1]):null,
      recentTotal: rm?parseInt(rm[1])+parseInt(rm[2]):null,
      recentWinPct: rm?parseInt(rm[1])/(parseInt(rm[1])+parseInt(rm[2])):null,
      recentRecord: rm?`${rm[1]}W-${rm[2]}L`:null,
      overall2026: om?`${om[1]}W-${om[2]}L`:null,
    };
  } catch { return null; }
}

async function fetchTennisMatches(tour='atp') {
  try {
    const now = new Date();
    const y=now.getUTCFullYear(),m=String(now.getUTCMonth()+1).padStart(2,'0'),d=String(now.getUTCDate()).padStart(2,'0');
    const r = await fetch(`https://www.tennisexplorer.com/matches/?type=${tour}&year=${y}&month=${m}&day=${d}`,{headers:TE_HEADERS});
    if(!r.ok) return [];
    const html = await r.text();
    const matches=[];
    
    // Split by tournament table - each starts with t-name header
    const tableRegex = /<td class="t-name"[^>]*>.*?<\/table>/gs;
    const tables = html.match(tableRegex)||[];
    
    // Alternative: find tournament names from links
    const tournRegex = /href="\/([a-z-]+)\/2026\/[^"]*">(?:<span[^>]*>[^<]*<\/span>)*([^<]+)<\/a>/g;
    const tourns = [];
    let tm;
    while((tm=tournRegex.exec(html))!==null) tourns.push({slug:tm[1],name:tm[2].trim()});
    
    // Split HTML by tournament table headers
    const sections = html.split(/class="t-name"/);
    let currentTourn = 'Unknown';
    let currentSurface = 'Hard';
    
    for(let i=1; i<sections.length; i++){
      const sec = sections[i];
      // Extract tournament name
      const tnMatch = sec.match(/>(?:<span[^>]*>[^<]*<\/span>)*([A-Z][^<]+)</);
      if(tnMatch) {
        currentTourn = tnMatch[1].trim();
        currentSurface = getSurface(currentTourn);
      }
      // Extract player pairs from this section
      const players=[];
      const re=/href="\/player\/([a-z0-9-]+)\/"[^>]*>([A-Z][^<]{1,30})</g;
      let m2;
      while((m2=re.exec(sec))!==null){
        const name=m2[2].trim();
        if(name.length>2&&!name.includes('Madrid')&&!name.includes('Open'))
          players.push({slug:m2[1],name});
      }
      for(let j=0;j<players.length-1;j+=2){
        if(players[j].slug!==players[j+1].slug)
          matches.push({tournament:currentTourn,surface:currentSurface,p1:players[j],p2:players[j+1]});
      }
    }
    return matches;
  } catch(e) { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  // Tennis mode
  if(req.query.sport==='tennis'){
    const {tour='atp', player, surface='Clay'} = req.query;
    if(player){
      const stats = await fetchTennisPlayerStats(player, surface);
      return res.status(200).json({success:!!stats, stats});
    }
    const matches = await fetchTennisMatches(tour);
    return res.status(200).json({success:true,tour,date:new Date().toISOString().split('T')[0],matches:matches.slice(0,30),total:matches.length});
  }
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
