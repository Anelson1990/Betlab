// Merged: Odds API + Tennis Model

const ATP_CSV = 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2024.csv';
const WTA_CSV = 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_2024.csv';

function simulateMatch(p1ServeWin, p2ServeWin, bestOf=3, simulations=5000) {
  let p1Wins = 0;
  for (let s = 0; s < simulations; s++) {
    let p1Sets = 0, p2Sets = 0;
    const setsToWin = Math.ceil(bestOf / 2);
    while (p1Sets < setsToWin && p2Sets < setsToWin) {
      let p1Games = 0, p2Games = 0;
      while (true) {
        if (p1Games >= 6 && p1Games - p2Games >= 2) { p1Sets++; break; }
        if (p2Games >= 6 && p2Games - p1Games >= 2) { p2Sets++; break; }
        if (p1Games === 6 && p2Games === 6) {
          let tb1=0,tb2=0;
          while(!(tb1>=7&&tb1-tb2>=2)&&!(tb2>=7&&tb2-tb1>=2)){
            if(Math.random()<p1ServeWin)tb1++;else tb2++;
          }
          if(tb1>tb2)p1Sets++;else p2Sets++;
          break;
        }
        const p1Serving=(p1Games+p2Games)%2===0;
        const sp=p1Serving?p1ServeWin:p2ServeWin;
        let g1=0,g2=0;
        while(!(g1>=4&&g1-g2>=2)&&!(g2>=4&&g2-g1>=2)){
          if(Math.random()<sp)g1++;else g2++;
        }
        if(g1>g2){if(p1Serving)p1Games++;else p2Games++;}
        else{if(p1Serving)p2Games++;else p1Games++;}
      }
    }
    if(p1Sets>p2Sets)p1Wins++;
  }
  return {
    p1WinProb: Math.round(p1Wins/simulations*1000)/10,
    p2WinProb: Math.round((simulations-p1Wins)/simulations*1000)/10,
  };
}

function calcSurfaceElo(csvText, surface) {
  const elos={};
  for(const line of csvText.split('\n').slice(1)){
    const c=line.split(',');
    if(c.length<20)continue;
    if(surface&&c[2]?.trim()!==surface)continue;
    const w=c[10]?.trim(),l=c[18]?.trim();
    if(!w||!l)continue;
    if(!elos[w])elos[w]=1500;
    if(!elos[l])elos[l]=1500;
    const exp=1/(1+Math.pow(10,(elos[l]-elos[w])/400));
    elos[w]+=32*(1-exp);elos[l]+=32*(0-(1-exp));
  }
  return elos;
}

function parseServeStats(csvText, playerName, surface) {
  let svpt=0,won=0,matches=0;
  for(const line of csvText.split('\n').slice(1)){
    const c=line.split(',');
    if(c.length<40)continue;
    if(surface&&c[2]?.trim()!==surface)continue;
    if(c[10]?.trim()===playerName){const s=parseFloat(c[26])||0,f=parseFloat(c[28])||0,sec=parseFloat(c[29])||0;if(s>0){svpt+=s;won+=f+sec;matches++;}}
    if(c[18]?.trim()===playerName){const s=parseFloat(c[36])||0,f=parseFloat(c[38])||0,sec=parseFloat(c[39])||0;if(s>0){svpt+=s;won+=f+sec;matches++;}}
  }
  return svpt>0?{serveWinPct:won/svpt,matches}:null;
}

function americanToImplied(o){const n=parseInt(o);return isNaN(n)?0.5:n>0?100/(n+100):Math.abs(n)/(Math.abs(n)+100);}
function calcKelly(p,o){const prob=p/100,odds=parseInt(o),b=odds>0?odds/100:100/Math.abs(odds);return Math.round(Math.max(0,(b*prob-(1-prob))/b)/2*1000)/10;}

async function handleTennis(req, res) {
  const tour = req.query.tour||'atp';
  const espnLeague = tour==='wta'?'wta':'atp';
  try {
    const [scoreboardRes, csvRes] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${espnLeague}/scoreboard`),
      fetch(tour==='wta'?WTA_CSV:ATP_CSV),
    ]);
    const scoreboardData = await scoreboardRes.json();
    const csvText = await csvRes.text();

    const matches=[];
    for(const event of scoreboardData.events||[]){
      const tournamentName=event.name||'Unknown';
      for(const grouping of event.groupings||[]){
        for(const comp of grouping.competitions||[]){
          if(comp.status?.type?.state!=='pre')continue;
          const players=comp.competitors||[];
          if(players.length<2)continue;
          const courtName=comp.venue?.fullName||'';
          const surface=courtName.includes('Clay')?'Clay':courtName.includes('Grass')?'Grass':'Hard';
          matches.push({
            id:comp.id,tournament:tournamentName,surface,
            bestOf:comp.format?.regulation?.periods||3,
            date:comp.date,court:comp.venue?.court||'',
            p1:{id:players[0]?.id,name:players[0]?.athlete?.displayName||'Unknown',seed:players[0]?.seeding||null},
            p2:{id:players[1]?.id,name:players[1]?.athlete?.displayName||'Unknown',seed:players[1]?.seeding||null},
          });
        }
      }
    }

    if(!matches.length) return res.status(200).json({success:true,tour,matches:[],message:'No upcoming matches'});

    const surfaceElos={};
    for(const surf of['Hard','Clay','Grass']) surfaceElos[surf]=calcSurfaceElo(csvText,surf);
    const surfDefaults={Hard:tour==='wta'?0.575:0.635,Clay:tour==='wta'?0.555:0.615,Grass:tour==='wta'?0.595:0.665};

    const results=[];
    for(const match of matches.slice(0,15)){
      const surf=match.surface;
      const elos=surfaceElos[surf]||surfaceElos['Hard'];
      const p1Elo=elos[match.p1.name]||1500;
      const p2Elo=elos[match.p2.name]||1500;
      const p1Serve=parseServeStats(csvText,match.p1.name,surf);
      const p2Serve=parseServeStats(csvText,match.p2.name,surf);
      // Elo-based win probability (logistic)
      const eloWinProb=1/(1+Math.pow(10,(p2Elo-p1Elo)/400));
      // Adjust serve win % based on relative strength
      const p1EloFactor=Math.min(0.08,Math.max(-0.08,(p1Elo-1500)/500*0.08));
      const p2EloFactor=Math.min(0.08,Math.max(-0.08,(p2Elo-1500)/500*0.08));
      const surfDefault=surfDefaults[surf]||0.635;
      const p1HasData=(p1Serve?.matches||0)>=10;
      const p2HasData=(p2Serve?.matches||0)>=10;
      const p1SW=Math.min(0.74,Math.max(0.50,p1HasData?p1Serve.serveWinPct:surfDefault+p1EloFactor));
      const p2SW=Math.min(0.74,Math.max(0.50,p2HasData?p2Serve.serveWinPct:surfDefault+p2EloFactor));
      const sim=simulateMatch(p1SW,p2SW,match.bestOf);

      let p1Odds=null,p2Odds=null;
      try{
        const or=await fetch(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/${espnLeague}/events/${match.id}/competitions/${match.id}/odds`);
        const od=await or.json();
        const item=od.items?.[0];
        if(item){p1Odds=item.homeTeamOdds?.moneyLine||null;p2Odds=item.awayTeamOdds?.moneyLine||null;}
      }catch{}
      // If no ESPN odds, estimate from sim output (more accurate than raw Elo)
      if(!p1Odds){
        const sp1 = sim.p1WinProb/100;
        const sp2 = sim.p2WinProb/100;
        p1Odds = sp1 > 0.5 ? -Math.round(sp1/(1-sp1)*100) : Math.round(sp2/sp1*100);
        p2Odds = sp2 > 0.5 ? -Math.round(sp2/(1-sp2)*100) : Math.round(sp1/sp2*100);
      }

      const p1Imp=p1Odds?americanToImplied(p1Odds)*100:50;
      const p2Imp=p2Odds?americanToImplied(p2Odds)*100:50;
      const p1Edge=sim.p1WinProb-p1Imp;
      const p2Edge=sim.p2WinProb-p2Imp;
      let recPlayer=null,recOdds=null,recEdge=0,rating='SKIP';
      if(p1Edge>p2Edge&&p1Edge>=5&&p1Odds){recPlayer=match.p1.name;recOdds=p1Odds;recEdge=p1Edge;rating=p1Edge>=10?'STRONG BET':'VALUE BET';}
      else if(p2Edge>=5&&p2Odds){recPlayer=match.p2.name;recOdds=p2Odds;recEdge=p2Edge;rating=p2Edge>=10?'STRONG BET':'VALUE BET';}
      const kelly=recOdds?calcKelly(recPlayer===match.p1.name?sim.p1WinProb:sim.p2WinProb,recOdds):0;

      results.push({
        tournament:match.tournament,surface:match.surface,court:match.court,date:match.date,
        p1:match.p1.name,p2:match.p2.name,p1Seed:match.p1.seed,p2Seed:match.p2.seed,
        p1Elo:Math.round(p1Elo),p2Elo:Math.round(p2Elo),
        p1ServeWin:Math.round(p1SW*100),p2ServeWin:Math.round(p2SW*100),
        p1WinProb:sim.p1WinProb,p2WinProb:sim.p2WinProb,
        p1Odds,p2Odds,p1Implied:Math.round(p1Imp*10)/10,p2Implied:Math.round(p2Imp*10)/10,
        p1Edge:Math.round(p1Edge*10)/10,p2Edge:Math.round(p2Edge*10)/10,
        recPlayer,recOdds,recEdge:Math.round(recEdge*10)/10,rating,kelly,
        bestOf:match.bestOf,
        p1DataMatches:p1Serve?.matches||0,p2DataMatches:p2Serve?.matches||0,
      });
    }
    results.sort((a,b)=>Math.abs(b.recEdge)-Math.abs(a.recEdge));
    return res.status(200).json({success:true,tour:tour.toUpperCase(),date:new Date().toISOString().split('T')[0],totalMatches:matches.length,analyzed:results.length,bets:results.filter(r=>r.recPlayer),allMatches:results});
  } catch(err){return res.status(500).json({success:false,error:err.message});}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();

  // Route tennis requests
  if(req.query.mode==='tennis') return handleTennis(req,res);

  // Original odds API
  const{sport='americanfootball_nfl',markets='h2h'}=req.query;
  const key=process.env.ODDS_API_KEY;
  if(!key)return res.status(500).json({error:'ODDS_API_KEY not set'});
  const url=`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=us&markets=${markets}&oddsFormat=american&dateFormat=iso`;
  try{const u=await fetch(url);const d=await u.json();if(!u.ok)return res.status(u.status).json(d);res.status(200).json(d);}
  catch(err){res.status(502).json({error:err.message});}
}
