// Context Builder - packages stats + app data for AI pick generation
// Called before Claude or Groq makes picks to give full context

async function fetchESPNGameSummary(sport, gameId) {
  if (!gameId) return null;
  const sportMap = {
    NHL: 'hockey/nhl', MLB: 'baseball/mlb',
    NBA: 'basketball/nba', NFL: 'football/nfl'
  };
  const path = sportMap[sport];
  if (!path) return null;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${gameId}`);
    if (!r.ok) return null;
    const d = await r.json();
    return {
      seasonSeries: d.seasonseries?.[0]?.summary || null,
      ats: d.againstTheSpread?.map(t=>({
        team: t.team?.abbreviation,
        record: t.stats?.find(s=>s.name==='ats')?.displayValue
      }))||[],
      news: d.news?.headlines?.slice(0,2).map(n=>n.title)||[],
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  // Route cloud sync requests
  if (req.query.action==='save'||req.query.action==='load') return handleCloud(req,res);

  const { sport, homeTeam, awayTeam, gameId } = req.body||{};
  if (!sport||!homeTeam||!awayTeam) return res.status(400).json({error:'Missing fields'});

  const base = `https://${req.headers.host}`;
  const sportLower = sport.toLowerCase();

  try {
    // Fetch stats based on sport
    let statsData = null;
    try {
      const statsRes = await fetch(`${base}/api/stats/${sportLower}?home=${encodeURIComponent(homeTeam)}&away=${encodeURIComponent(awayTeam)}`);
      if (statsRes.ok) statsData = await statsRes.json();
    } catch(e) { console.error('Stats fetch error:', e.message); }

    // Fetch ESPN game summary for head to head and ATS
    let gameSummary = null;
    if (gameId) {
      try { gameSummary = await fetchESPNGameSummary(sport, gameId); } catch {}
    }

    // Build formatted context string for AI
    const context = formatContext(sport, homeTeam, awayTeam, statsData, gameSummary);

    return res.status(200).json({
      success: true,
      sport,
      homeTeam,
      awayTeam,
      statsData,
      context,
    });
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}

function formatContext(sport, homeTeam, awayTeam, stats, gameSummary) {
  // Add game summary to top of context
  const summaryLines = [];
  if (gameSummary?.seasonSeries) summaryLines.push(`Season Series: ${gameSummary.seasonSeries}`);
  if (gameSummary?.ats?.length) summaryLines.push(`ATS Records: ${gameSummary.ats.map(t=>`${t.team} ${t.record}`).join(' | ')}`);
  if (gameSummary?.news?.length) summaryLines.push(`Recent News: ${gameSummary.news.join(' | ')}`);
  if (!stats?.success) return `No stats available for ${homeTeam} vs ${awayTeam}`;

  const lines = [`=== ${sport} GAME CONTEXT: ${awayTeam} @ ${homeTeam} ===`];
  if (summaryLines.length) lines.push(...summaryLines);
  const { home, away } = stats;

  if (sport==='NHL') {
    lines.push(`\nHOME: ${homeTeam}`);
    if (home.stats) {
      lines.push(`  Record: ${home.stats.wins}-${home.stats.losses}-${home.stats.otLosses}`);
      lines.push(`  Goals For/Game: ${home.stats.goalsForPerGame} | Goals Against/Game: ${home.stats.goalsAgainstPerGame}`);
      if(home.stats.goalDifferential) lines.push(`  Goal Differential: ${home.stats.goalDifferential>0?'+':''}${home.stats.goalDifferential} | Regulation Wins: ${home.stats.regulationWins}`);
    }
    if (home.probableGoalie) {
      const g = home.probableGoalie;
      const goalieStr = typeof g==='object' ? 
        `${g.name}${g.gaa?` (GAA:${g.gaa} SV%:${g.savePct} W:${g.wins}-${g.losses})`:''}` : g;
      lines.push(`  Probable Goalie: ${goalieStr}`);
    }
    if (home.recentForm) lines.push(`  Last 10: ${home.recentForm} | L5: ${home.last5||'?'} | L3: ${home.last3||'?'}`);
    if (home.avgGF_L5) lines.push(`  L5 Avg: ${home.avgGF_L5} GF/game | ${home.avgGA_L5} GA/game`);
    if (home.recentGames?.length) {
      const lastGame = home.recentGames[home.recentGames.length-1];
      const daysSince = Math.floor((new Date()-new Date(lastGame.date))/(1000*60*60*24));
      lines.push(`  Days rest: ${daysSince} (last game: ${lastGame.date} vs ${lastGame.opponent} ${lastGame.score})`);
    }
    if (home.stats?.homeRecord) lines.push(`  Home Record: ${home.stats.homeRecord} | Away: ${home.stats.awayRecord}`);
    if (home.stats?.streak) lines.push(`  Current Streak: ${home.stats.streak}`);
    if (home.moneyPuck) lines.push(`  xG For: ${home.moneyPuck.xGoalsFor} | xG Against: ${home.moneyPuck.xGoalsAgainst} | xGF%: ${home.moneyPuck.xGoalsForPct} | Corsi: ${home.moneyPuck.corsiForPct} | HD Goals For: ${home.moneyPuck.highDangerGoalsFor}`);
    if (home.stats?.powerPlayPct) lines.push(`  PP%: ${home.stats.powerPlayPct} | PK%: ${home.stats.penaltyKillPct}`);
    if (home.injuries?.length) lines.push(`  Injuries: ${home.injuries.map(i=>`${i.player}(${i.status})`).join(', ')}`);
    // Opponent defensive weakness - how well does home team score vs away team's GA rate
    if (home.stats?.goalsForPerGame && away.stats?.goalsAgainstPerGame) {
      const offEdge = (parseFloat(home.stats.goalsForPerGame) - parseFloat(away.stats.goalsAgainstPerGame)).toFixed(2);
      lines.push(`  Offensive matchup vs opp defense: ${offEdge>0?'+':''}${offEdge} (home GF/g vs away GA/g)`);
    }

    lines.push(`\nAWAY: ${awayTeam}`);
    if (away.stats) {
      lines.push(`  Record: ${away.stats.wins}-${away.stats.losses}-${away.stats.otLosses}`);
      lines.push(`  Goals For/Game: ${away.stats.goalsForPerGame} | Goals Against/Game: ${away.stats.goalsAgainstPerGame}`);
      if(away.stats.goalDifferential) lines.push(`  Goal Differential: ${away.stats.goalDifferential>0?'+':''}${away.stats.goalDifferential} | Regulation Wins: ${away.stats.regulationWins}`);
    }
    if (away.probableGoalie) {
      const g = away.probableGoalie;
      const goalieStr = typeof g==='object' ?
        `${g.name}${g.gaa?` (GAA:${g.gaa} SV%:${g.savePct} W:${g.wins}-${g.losses})`:''}` : g;
      lines.push(`  Probable Goalie: ${goalieStr}`);
    }
    if (away.recentForm) lines.push(`  Last 10: ${away.recentForm} | L5: ${away.last5||'?'} | L3: ${away.last3||'?'}`);
    if (away.avgGF_L5) lines.push(`  L5 Avg: ${away.avgGF_L5} GF/game | ${away.avgGA_L5} GA/game`);
    if (away.recentGames?.length) {
      const lastGame = away.recentGames[away.recentGames.length-1];
      const daysSince = Math.floor((new Date()-new Date(lastGame.date))/(1000*60*60*24));
      lines.push(`  Days rest: ${daysSince} (last game: ${lastGame.date} vs ${lastGame.opponent} ${lastGame.score})`);
    }
    if (away.stats?.homeRecord) lines.push(`  Home Record: ${away.stats.homeRecord} | Away: ${away.stats.awayRecord}`);
    if (away.stats?.streak) lines.push(`  Current Streak: ${away.stats.streak}`);
    if (away.moneyPuck) lines.push(`  xG For: ${away.moneyPuck.xGoalsFor} | xG Against: ${away.moneyPuck.xGoalsAgainst} | xGF%: ${away.moneyPuck.xGoalsForPct} | Corsi: ${away.moneyPuck.corsiForPct} | HD Goals For: ${away.moneyPuck.highDangerGoalsFor}`);
    if (away.injuries?.length) lines.push(`  Injuries: ${away.injuries.map(i=>`${i.player}(${i.status})`).join(', ')}`);
    if (away.stats?.pitching && home.stats?.batting) lines.push(`  Offensive matchup: Home OPS ${home.stats.batting?.ops} vs Away ERA ${away.stats.pitching?.era} | Away OPS ${away.stats.batting?.ops} vs Home ERA ${home.stats.pitching?.era}`);
    // Opponent defensive weakness
    if (away.stats?.goalsForPerGame && home.stats?.goalsAgainstPerGame) {
      const offEdge = (parseFloat(away.stats.goalsForPerGame) - parseFloat(home.stats.goalsAgainstPerGame)).toFixed(2);
      lines.push(`  Offensive matchup vs opp defense: ${offEdge>0?'+':''}${offEdge} (away GF/g vs home GA/g)`);
    }
  }

  if (sport==='MLB') {
    lines.push(`\nHOME: ${homeTeam}`);
    if (home.stats?.batting) {
      lines.push(`  Batting: AVG ${home.stats.batting.avg} | OPS ${home.stats.batting.ops} | R/G ${home.stats.batting.runsPerGame}`);
    }
    if (home.stats?.pitching) {
      lines.push(`  Pitching: ERA ${home.stats.pitching.era} | WHIP ${home.stats.pitching.whip} | K/G ${home.stats.pitching.strikeoutsPerGame}`);
    }
    if (home.probablePitcher?.name) {
      lines.push(`  Probable Pitcher: ${home.probablePitcher.name}${home.probablePitcher.throws?` (${home.probablePitcher.throws}HP)`:''}`);
      if (home.probablePitcher.era) lines.push(`    ERA: ${home.probablePitcher.era} | WHIP: ${home.probablePitcher.whip} | IP: ${home.probablePitcher.inningsPitched}`);
      if (home.probablePitcher.last3) lines.push(`    L3 Starts: ERA ${home.probablePitcher.last3.era} | WHIP ${home.probablePitcher.last3.whip} | ${home.probablePitcher.last3.trend||''}`);
    }
    if (home.bullpen) lines.push(`  Bullpen: ${home.bullpen.status}${home.bullpen.closerUsed?' — closer used':''}`); 
    if (home.lineup?.length) lines.push(`  Today's Lineup (1-6): ${home.lineup.map(p=>`${p.order}.${p.name}(${p.position})`).join(', ')}`);
    if (home.daysRest!=null) lines.push(`  Rest: ${home.daysRest} day(s)${home.daysRest===0?' ⚠️ NO REST':home.daysRest>=2?' ✅ Well rested':''}`);
    if (home.platoon) lines.push(`  Platoon: ${home.platoon.note}`);
    if (home.recentForm) lines.push(`  Last 10: ${home.recentForm}`);
    if (home.homeRecord) lines.push(`  Home: ${home.homeRecord} | Away: ${home.awayRecord}`);
    if (home.streak) lines.push(`  Streak: ${home.streak}`);
    if (home.injuries?.length) lines.push(`  Injuries: ${home.injuries.map(i=>i.player+'('+i.status+')').join(', ')}`);

    lines.push(`\nAWAY: ${awayTeam}`);
    if (away.stats?.batting) {
      lines.push(`  Batting: AVG ${away.stats.batting.avg} | OPS ${away.stats.batting.ops} | R/G ${away.stats.batting.runsPerGame}`);
    }
    if (away.stats?.pitching) {
      lines.push(`  Pitching: ERA ${away.stats.pitching.era} | WHIP ${away.stats.pitching.whip} | K/G ${away.stats.pitching.strikeoutsPerGame}`);
    }
    if (away.probablePitcher?.name) {
      lines.push(`  Probable Pitcher: ${away.probablePitcher.name}`);
      if (away.probablePitcher.era) lines.push(`    ERA: ${away.probablePitcher.era} | WHIP: ${away.probablePitcher.whip} | IP: ${away.probablePitcher.inningsPitched}`);
      if (away.probablePitcher.last3) lines.push(`    L3 Starts: ERA ${away.probablePitcher.last3.era} | WHIP ${away.probablePitcher.last3.whip} | ${away.probablePitcher.last3.trend||''}`);
    }
    if (away.bullpen) lines.push(`  Bullpen: ${away.bullpen.status}${away.bullpen.closerUsed?' — closer used':''}`); 
    if (away.lineup?.length) lines.push(`  Today's Lineup (1-6): ${away.lineup.map(p=>`${p.order}.${p.name}(${p.position})`).join(', ')}`);
    if (away.daysRest!=null) lines.push(`  Rest: ${away.daysRest} day(s)${away.daysRest===0?' ⚠️ NO REST':away.daysRest>=2?' ✅ Well rested':''}`);
    if (away.platoon) lines.push(`  Platoon: ${away.platoon.note}`);
    if (away.recentForm) lines.push(`  Last 10: ${away.recentForm}`);
    if (away.homeRecord) lines.push(`  Home: ${away.homeRecord} | Away: ${away.awayRecord}`);
    if (away.streak) lines.push(`  Streak: ${away.streak}`);
    if (away.injuries?.length) lines.push(`  Injuries: ${away.injuries.map(i=>i.player+'('+i.status+')').join(', ')}`);
    if (stats.espnOdds) {
      const o = stats.espnOdds;
      lines.push(`  DraftKings: Home ML ${o.homeMl>0?'+':''}${o.homeMl} | Away ML ${o.awayMl>0?'+':''}${o.awayMl} | O/U ${o.overUnder} (O:${o.overOdds} U:${o.underOdds})`);
    }
    if (stats.espnWinProb) lines.push(`  ESPN Win Prob: Home ${(stats.espnWinProb.homeWinPct*100).toFixed(1)}% | Away ${(stats.espnWinProb.awayWinPct*100).toFixed(1)}%`);
    
    // Park factors
    const PARK_FACTORS = {
      'Colorado Rockies': '⚠️ COORS FIELD - runs +20%, HR +25%',
      'Cincinnati Reds': 'Great American - slight hitter park',
      'Boston Red Sox': 'Fenway - LF wall benefits RHH',
      'Chicago Cubs': 'Wrigley - wind dependent, check direction',
      'New York Yankees': 'Yankee Stadium - HR friendly',
      'Houston Astros': 'Minute Maid - retractable roof',
      'Texas Rangers': 'Globe Life - extreme heat affects late innings',
    };
    const homePark = PARK_FACTORS[homeTeam];
    if (homePark) lines.push(`  Park Factor: ${homePark}`);
    
    // Pitcher ERA comparison
    if (home.probablePitcher?.era && away.probablePitcher?.era) {
      const homeEra = parseFloat(home.probablePitcher.era);
      const awayEra = parseFloat(away.probablePitcher.era);
      const eraGap = (awayEra - homeEra).toFixed(2);
      const eraFavor = eraGap > 0.5 ? 'favor HOME pitcher' : eraGap < -0.5 ? 'favor AWAY pitcher' : 'even matchup';
      lines.push(`  ERA Gap: Home SP ${home.probablePitcher.era} vs Away SP ${away.probablePitcher.era} (${eraGap>0?'+':''}${eraGap} — ${eraFavor})`);
      const homeWhip = parseFloat(home.probablePitcher.whip);
      const awayWhip = parseFloat(away.probablePitcher.whip);
      const whipGap = (awayWhip - homeWhip).toFixed(2);
      const whipFavor = whipGap > 0.1 ? 'WHIP favors HOME' : whipGap < -0.1 ? 'WHIP favors AWAY' : 'WHIP even';
      lines.push(`  WHIP Gap: Home SP ${home.probablePitcher.whip} vs Away SP ${away.probablePitcher.whip} (${whipFavor})`);
      // OPS gap vs pitcher handedness - #1 ML predictor
      if (home.platoon?.ops) lines.push(`  Home Lineup vs ${away.probablePitcher.throws||'R'}HP: OPS ${home.platoon.ops} | OBP ${home.platoon.obp} | SLG ${home.platoon.slg}`);
      if (away.platoon?.ops) lines.push(`  Away Lineup vs ${home.probablePitcher.throws||'R'}HP: OPS ${away.platoon.ops} | OBP ${away.platoon.obp} | SLG ${away.platoon.slg}`);
      if (stats.opsGap!=null) {
        const opsEdge = stats.opsGap > 0.020 ? '⭐ HOME lineup advantage' : stats.opsGap < -0.020 ? '⭐ AWAY lineup advantage' : 'Even matchup';
        lines.push(`  OPS Gap (home - away vs pitcher hand): ${stats.opsGap > 0 ? '+' : ''}${stats.opsGap} — ${opsEdge}`);
      }
    }
    
    // L3/L5 rolling form
    if (home.stats?.batting?.l5Avg) lines.push(`  Home L5 AVG: ${home.stats.batting.l5Avg} | L3: ${home.stats.batting.l3Avg||'?'}`);
    if (away.stats?.batting?.l5Avg) lines.push(`  Away L5 AVG: ${away.stats.batting.l5Avg} | L3: ${away.stats.batting.l3Avg||'?'}`);
  }

  if (sport==='NBA') {
    lines.push(`\nHOME: ${homeTeam}`);
    if (home.stats) {
      lines.push(`  PPG: ${home.stats.pts} | RPG: ${home.stats.reb} | APG: ${home.stats.ast}`);
      lines.push(`  FG%: ${home.stats.fg_pct} | 3P%: ${home.stats.fg3_pct} | TO: ${home.stats.turnover}`);
    }
    if (home.record) lines.push(`  Record: ${home.record}`);
    if (home.isBackToBack) lines.push(`  ⚠️ BACK TO BACK`);
    if (home.restDays) lines.push(`  Rest: ${home.restDays} days`);
    if (home.recentForm) lines.push(`  Last 10: ${home.recentForm}`);
    if (home.injuries?.length) lines.push(`  Injuries: ${home.injuries.map(i=>`${i.player}(${i.status})`).join(', ')}`);
    // Opponent defensive weakness - how well does home team score vs away team's GA rate
    if (home.stats?.goalsForPerGame && away.stats?.goalsAgainstPerGame) {
      const offEdge = (parseFloat(home.stats.goalsForPerGame) - parseFloat(away.stats.goalsAgainstPerGame)).toFixed(2);
      lines.push(`  Offensive matchup vs opp defense: ${offEdge>0?'+':''}${offEdge} (home GF/g vs away GA/g)`);
    }

    lines.push(`\nAWAY: ${awayTeam}`);
    if (away.stats) {
      lines.push(`  PPG: ${away.stats.pts} | RPG: ${away.stats.reb} | APG: ${away.stats.ast}`);
      lines.push(`  FG%: ${away.stats.fg_pct} | 3P%: ${away.stats.fg3_pct} | TO: ${away.stats.turnover}`);
    }
    if (away.record) lines.push(`  Record: ${away.record}`);
    if (away.isBackToBack) lines.push(`  ⚠️ BACK TO BACK`);
    if (away.restDays) lines.push(`  Rest: ${away.restDays} days`);
    if (away.recentForm) lines.push(`  Last 10: ${away.recentForm}`);
    if (away.injuries?.length) lines.push(`  Injuries: ${away.injuries.map(i=>`${i.player}(${i.status})`).join(', ')}`);
    // Opponent defensive weakness
    if (away.stats?.goalsForPerGame && home.stats?.goalsAgainstPerGame) {
      const offEdge = (parseFloat(away.stats.goalsForPerGame) - parseFloat(home.stats.goalsAgainstPerGame)).toFixed(2);
      lines.push(`  Offensive matchup vs opp defense: ${offEdge>0?'+':''}${offEdge} (away GF/g vs home GA/g)`);
    }
  }

  if (sport==='NFL') {
    lines.push(`\nHOME: ${homeTeam}`);
    if (home.stats) {
      lines.push(`  PPG: ${home.stats.ppg} | PAPG: ${home.stats.papg}`);
    }
    if (home.recentForm) lines.push(`  Last 5: ${home.recentForm}`);
    if (home.restDays) lines.push(`  Rest: ${home.restDays} days`);
    if (home.venue) lines.push(`  Venue: ${home.venue.name} (${home.venue.indoor?'Indoor':'Outdoor'}${home.venue.grass?', Grass':''})`);
    if (home.injuries?.length) lines.push(`  Key Injuries: ${home.injuries.slice(0,4).map(i=>`${i.player} ${i.position}(${i.status})`).join(', ')}`);

    lines.push(`\nAWAY: ${awayTeam}`);
    if (away.stats) {
      lines.push(`  PPG: ${away.stats.ppg} | PAPG: ${away.stats.papg}`);
    }
    if (away.recentForm) lines.push(`  Last 5: ${away.recentForm}`);
    if (away.restDays) lines.push(`  Rest: ${away.restDays} days`);
    if (away.injuries?.length) lines.push(`  Key Injuries: ${away.injuries.slice(0,4).map(i=>`${i.player} ${i.position}(${i.status})`).join(', ')}`);

    if (stats.weather) {
      lines.push(`\nWEATHER: ${stats.weather.desc}, ${stats.weather.tempF}°F, Wind ${stats.weather.windMph}mph ${stats.weather.windDir}`);
    }
  }

  return lines.join('\n');
}

// Cloud sync handler - merged to stay under Vercel 12 function limit
async function handleCloud(req, res) {
  const JSONBIN_KEY = '$2a$10$OgNCQZvgTz/DoMEzXLkBRu8m.1M0fsZT55WDrZxc5dnYU8WE/EV3u';
  const JSONBIN_URL = 'https://api.jsonbin.io/v3/b';
  const { action, binId } = req.query;

  if (action==='save') {
    const r = binId
      ? await fetch(`${JSONBIN_URL}/${binId}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY},body:JSON.stringify(req.body)})
      : await fetch(JSONBIN_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY,'X-Bin-Name':'betlab-data'},body:JSON.stringify(req.body)});
    const data = await r.json();
    return res.status(200).json({success:r.ok,...data});
  }
  if (action==='load' && binId) {
    const r = await fetch(`${JSONBIN_URL}/${binId}/latest`,{headers:{'X-Master-Key':JSONBIN_KEY}});
    const data = await r.json();
    return res.status(200).json({success:r.ok,...data});
  }
  return res.status(400).json({error:'Invalid action'});
}
