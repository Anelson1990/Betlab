// NFL Stats API - ESPN API (free, no key needed)
// Fetches team stats, injuries, recent form, rest days, weather

const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

const TEAM_MAP = {
  'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL',
  'Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI',
  'Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL',
  'Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB',
  'Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX',
  'Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC',
  'Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN',
  'New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG',
  'New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT',
  'San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB',
  'Tennessee Titans':'TEN','Washington Commanders':'WSH',
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
    const r = await fetch(`${ESPN_NFL}/teams/${abbr}/statistics`);
    if (!r.ok) return null;
    const data = await r.json();
    const stats = data.results?.stats?.categories||data.stats||[];

    // Extract key stats
    let ppg=null, papg=null, ypg=null, yapg=null, turnovers=null;
    for (const cat of stats) {
      if (cat.name==='scoring') {
        ppg = cat.stats?.find(s=>s.name==='avgPointsPerGame')?.value;
        papg = cat.stats?.find(s=>s.name==='avgPointsAllowedPerGame')?.value;
      }
      if (cat.name==='general') {
        turnovers = cat.stats?.find(s=>s.name==='turnovers')?.value;
      }
    }
    return { ppg, papg, ypg, yapg, turnovers };
  } catch { return null; }
}

async function fetchRecentForm(abbr) {
  try {
    const r = await fetch(`${ESPN_NFL}/teams/${abbr}/schedule`);
    if (!r.ok) return null;
    const data = await r.json();
    const events = (data.events||[]).filter(e=>e.competitions?.[0]?.status?.type?.completed);
    const last5 = events.slice(-5).map(e=>{
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c=>c.homeAway==='home');
      const away = comp?.competitors?.find(c=>c.homeAway==='away');
      const isHome = home?.team?.abbreviation===abbr;
      const teamScore = isHome?parseInt(home?.score):parseInt(away?.score);
      const oppScore = isHome?parseInt(away?.score):parseInt(home?.score);
      return {
        win: teamScore>oppScore,
        score:`${teamScore}-${oppScore}`,
        opponent: isHome?away?.team?.abbreviation:home?.team?.abbreviation,
        homeAway: isHome?'home':'away',
        date: e.date,
      };
    });
    const wins = last5.filter(g=>g.win).length;

    // Rest days
    const lastGame = events[events.length-1];
    const restDays = lastGame ? Math.floor((new Date()-new Date(lastGame.date))/(1000*60*60*24)) : null;

    return { last5:`${wins}-${last5.length-wins}`, restDays, games:last5 };
  } catch { return null; }
}

async function fetchInjuries(abbr) {
  try {
    const r = await fetch(`${ESPN_NFL}/teams/${abbr}/injuries`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.injuries||[])
      .filter(i=>i.status==='Out'||i.status==='Doubtful'||i.status==='Questionable')
      .slice(0,8)
      .map(i=>({
        player: i.athlete?.displayName,
        position: i.athlete?.position?.abbreviation,
        status: i.status,
        detail: i.details?.detail||i.shortComment,
      }));
  } catch { return []; }
}

async function fetchWeather(venue) {
  try {
    if (!venue?.city) return null;
    const r = await fetch(`https://wttr.in/${encodeURIComponent(venue.city)}?format=j1`);
    if (!r.ok) return null;
    const data = await r.json();
    const current = data.current_condition?.[0];
    return {
      tempF: current?.temp_F,
      windMph: current?.windspeedMiles,
      windDir: current?.winddir16Point,
      desc: current?.weatherDesc?.[0]?.value,
      precipitation: current?.precipMM,
    };
  } catch { return null; }
}

async function fetchVenue(abbr) {
  try {
    const r = await fetch(`${ESPN_NFL}/teams/${abbr}`);
    if (!r.ok) return null;
    const data = await r.json();
    const venue = data.team?.venue;
    return venue ? {
      name: venue.fullName,
      city: venue.address?.city,
      indoor: venue.indoor,
      grass: venue.grass,
    } : null;
  } catch { return null; }
}

async function fetchNFLInjuries(teamName) {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
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

  const { home, away } = req.query;
  if (!home||!away) return res.status(400).json({error:'Missing home/away'});

  const homeAbbr = getAbbr(home);
  const awayAbbr = getAbbr(away);
  if (!homeAbbr||!awayAbbr) return res.status(400).json({error:`Team not found: ${!homeAbbr?home:away}`});

  try {
    const [homeStats,awayStats,homeForm,awayForm,homeInjuries,awayInjuries,homeVenue] = await Promise.all([
      fetchTeamStats(homeAbbr),
      fetchTeamStats(awayAbbr),
      fetchRecentForm(homeAbbr),
      fetchRecentForm(awayAbbr),
      fetchInjuries(homeAbbr),
      fetchInjuries(awayAbbr),
      fetchVenue(homeAbbr),
    ]);

    // Weather only for outdoor stadiums
    const weather = homeVenue&&!homeVenue.indoor ? await fetchWeather(homeVenue) : null;

    return res.status(200).json({
      success:true,
      home:{
        team:home, abbr:homeAbbr,
        stats:homeStats,
        recentForm:homeForm?.last5,
        restDays:homeForm?.restDays,
        injuries:homeInjuries,
        venue:homeVenue,
        recentGames:homeForm?.games,
      },
      away:{
        team:away, abbr:awayAbbr,
        stats:awayStats,
        recentForm:awayForm?.last5,
        restDays:awayForm?.restDays,
        injuries:awayInjuries,
        recentGames:awayForm?.games,
      },
      weather,
      fetchedAt:new Date().toISOString(),
    });
  } catch(err) {
    return res.status(500).json({success:false,error:err.message});
  }
}
