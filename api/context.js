// Context Builder - packages stats + app data for AI pick generation
// Called before Claude or Groq makes picks to give full context

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { sport, homeTeam, awayTeam } = req.body||{};
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

    // Build formatted context string for AI
    const context = formatContext(sport, homeTeam, awayTeam, statsData);

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

function formatContext(sport, homeTeam, awayTeam, stats) {
  if (!stats?.success) return `No stats available for ${homeTeam} vs ${awayTeam}`;

  const lines = [`=== ${sport} GAME CONTEXT: ${awayTeam} @ ${homeTeam} ===`];
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
    if (home.recentForm) lines.push(`  Last 10: ${home.recentForm}`);
    if (home.stats?.homeRecord) lines.push(`  Home Record: ${home.stats.homeRecord} | Away: ${home.stats.awayRecord}`);
    if (home.stats?.streak) lines.push(`  Current Streak: ${home.stats.streak}`);
    if (home.moneyPuck) lines.push(`  xG For: ${home.moneyPuck.xGoalsFor} | xG Against: ${home.moneyPuck.xGoalsAgainst} | xGF%: ${home.moneyPuck.xGoalsForPct} | Corsi: ${home.moneyPuck.corsiForPct} | HD Goals For: ${home.moneyPuck.highDangerGoalsFor}`);

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
    if (away.recentForm) lines.push(`  Last 10: ${away.recentForm}`);
    if (away.stats?.homeRecord) lines.push(`  Home Record: ${away.stats.homeRecord} | Away: ${away.stats.awayRecord}`);
    if (away.stats?.streak) lines.push(`  Current Streak: ${away.stats.streak}`);
    if (away.moneyPuck) lines.push(`  xG For: ${away.moneyPuck.xGoalsFor} | xG Against: ${away.moneyPuck.xGoalsAgainst} | xGF%: ${away.moneyPuck.xGoalsForPct} | Corsi: ${away.moneyPuck.corsiForPct} | HD Goals For: ${away.moneyPuck.highDangerGoalsFor}`);
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
      lines.push(`  Probable Pitcher: ${home.probablePitcher.name}`);
      if (home.probablePitcher.era) lines.push(`    ERA: ${home.probablePitcher.era} | WHIP: ${home.probablePitcher.whip} | IP: ${home.probablePitcher.inningsPitched}`);
    }
    if (home.recentForm) lines.push(`  Last 10: ${home.recentForm}`);

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
    }
    if (away.recentForm) lines.push(`  Last 10: ${away.recentForm}`);
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
