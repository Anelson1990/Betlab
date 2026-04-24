const SURFACE_MAP = { '2':'Clay', '4':'Hard', '1':'Grass', '3':'Grass' };
const SURFACE_TO_CODE = { 'Clay':'2', 'Hard':'4', 'Grass':'1' };
const TOURNAMENT_SURFACES = {
  'Madrid':'Clay','Monte Carlo':'Clay','Rome':'Clay','Roland Garros':'Clay',
  'French Open':'Clay','Barcelona':'Clay','Hamburg':'Clay','Munich':'Clay',
  'Wimbledon':'Grass','Halle':'Grass','Queens':'Grass','Stuttgart':'Grass',
  'Australian Open':'Hard','US Open':'Hard','Indian Wells':'Hard',
  'Miami':'Hard','Cincinnati':'Hard','Toronto':'Hard','Montreal':'Hard',
  'Shanghai':'Hard','Vienna':'Hard','Paris':'Hard','Beijing':'Hard',
};
const HEADERS = {'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'};

function getSurface(tournamentName) {
  for(const [key,surf] of Object.entries(TOURNAMENT_SURFACES)){
    if(tournamentName.toLowerCase().includes(key.toLowerCase())) return surf;
  }
  return 'Hard'; // default
}

async function fetchPlayerStats(playerSlug, surface) {
  try {
    const r = await fetch(`https://www.tennisexplorer.com/player/${playerSlug}/`, {headers:HEADERS});
    if(!r.ok) return null;
    const html = await r.text();
    
    const surfCode = SURFACE_TO_CODE[surface]||'4';
    
    // Career surface win rate
    const careerRegex = new RegExp(`surface=${surfCode}">(\\d+)/(\\d+)<`);
    const careerMatch = html.match(careerRegex);
    const careerWins = careerMatch ? parseInt(careerMatch[1]) : null;
    const careerTotal = careerMatch ? parseInt(careerMatch[1]) + parseInt(careerMatch[2]) : null;
    const careerWinPct = careerTotal ? careerWins/careerTotal : null;
    
    // 2026 surface form
    const year2026Regex = new RegExp(`annual=2026&amp;surface=${surfCode}"[^>]*>(\\d+)/(\\d+)<`);
    const year2026Match = html.match(year2026Regex);
    const recentWins = year2026Match ? parseInt(year2026Match[1]) : null;
    const recentTotal = year2026Match ? parseInt(year2026Match[1]) + parseInt(year2026Match[2]) : null;
    const recentWinPct = recentTotal ? recentWins/recentTotal : null;
    
    // Overall 2026 record
    const overall2026 = html.match(/2026"[^>]*>(\d+)\/(\d+)<\/td>/);
    
    // Ranking
    const rankMatch = html.match(/ranking.*?(\d+)/i);
    
    return {
      slug: playerSlug,
      surface,
      careerWinPct,
      careerRecord: careerMatch ? `${careerMatch[1]}W-${careerMatch[2]}L` : null,
      recentWinPct,
      recentRecord: year2026Match ? `${year2026Match[1]}W-${year2026Match[2]}L` : null,
      overall2026: overall2026 ? `${overall2026[1]}W-${overall2026[2]}L` : null,
    };
  } catch { return null; }
}

async function fetchTodayMatches(tour='atp') {
  try {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth()+1).padStart(2,'0');
    const d = String(today.getUTCDate()).padStart(2,'0');
    const r = await fetch(
      `https://www.tennisexplorer.com/matches/?type=${tour}&year=${y}&month=${m}&day=${d}`,
      {headers:HEADERS}
    );
    if(!r.ok) return [];
    const html = await r.text();
    
    // Extract matches with player slugs
    const matches = [];
    // Find tournament sections
    const tournRegex = /<h3[^>]*>(.*?)<\/h3>/g;
    const rowRegex = /<tr[^>]*class="[^"]*(?:one|two)[^"]*"[^>]*>(.*?)<\/tr>/gs;
    const playerRegex = /href="\/player\/([^"]+)\/"[^>]*>([^<]+)</g;
    
    let tournMatch;
    let currentTourn = '';
    const lines = html.split('\n');
    
    // Simpler approach - find all player links and pair them
    const allPlayers = [];
    const playerLinkRegex = /href="\/player\/([a-z0-9-]+)\/"[^>]*>([A-Z][^<]+)</g;
    let pm;
    while((pm = playerLinkRegex.exec(html)) !== null) {
      allPlayers.push({slug: pm[1], name: pm[2].trim()});
    }
    
    // Find tournament context
    const tournSections = html.split(/<h3/i);
    for(const section of tournSections.slice(1)) {
      const tournName = section.match(/>(.*?)</)?.[1]||'Unknown';
      const surface = getSurface(tournName);
      const sectionPlayers = [];
      const spRegex = /href="\/player\/([a-z0-9-]+)\/"[^>]*>([A-Z][^<]+)</g;
      let sp;
      while((sp = spRegex.exec(section)) !== null) {
        sectionPlayers.push({slug:sp[1], name:sp[2].trim()});
      }
      // Pair players into matches (every 2)
      for(let i=0; i<sectionPlayers.length-1; i+=2) {
        if(sectionPlayers[i].slug !== sectionPlayers[i+1].slug) {
          matches.push({
            tournament: tournName.replace(/<[^>]+>/g,'').trim(),
            surface,
            p1: sectionPlayers[i],
            p2: sectionPlayers[i+1],
          });
        }
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
  
  const {tour='atp', player, surface='Clay'} = req.query;
  
  // Single player stats lookup
  if(player) {
    const stats = await fetchPlayerStats(player, surface);
    return res.status(200).json({success:!!stats, stats});
  }
  
  // Today's matches
  try {
    const matches = await fetchTodayMatches(tour);
    return res.status(200).json({
      success:true, tour, 
      date:new Date().toISOString().split('T')[0],
      matches: matches.slice(0,30),
      total: matches.length,
    });
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
