// Monte Carlo Simulation Engine for BetLab
// Runs 5000 simulations per game to estimate win probabilities

// Poisson random number generator (for NHL/MLB - discrete scoring)
function poissonRandom(lambda) {
  let L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Normal random number generator (for NBA/NFL - continuous scoring)
function normalRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Extract implied total and home win prob from odds
function parseOdds(homeOdds, awayOdds, totalLine) {
  const homeImpl = homeOdds > 0 ? 100/(homeOdds+100) : Math.abs(homeOdds)/(Math.abs(homeOdds)+100);
  const awayImpl = awayOdds > 0 ? 100/(awayOdds+100) : Math.abs(awayOdds)/(Math.abs(awayOdds)+100);
  const total = totalLine || 6.5; // default
  // Remove vig
  const sum = homeImpl + awayImpl;
  const homeProb = homeImpl / sum;
  return { homeProb, awayProb: 1 - homeProb, total };
}

// NHL Monte Carlo Simulation
// Uses Poisson distribution - goals are rare independent events
function simNHL(homeOdds, awayOdds, totalLine, simCount = 5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);

  // Derive expected goals using total and win probability
  // Higher win prob = team scores more goals relative to opponent
  const totalGoals = total || 6.0;
  // Split total based on win probability (stronger team scores more)
  const homeExpected = totalGoals * (0.4 + homeProb * 0.2);  // range ~0.4-0.6 of total
  const awayExpected = totalGoals - homeExpected;

  let homeWins = 0, awayWins = 0, overs = 0, pushes = 0;
  const results = [];

  for (let i = 0; i < simCount; i++) {
    let homeGoals = poissonRandom(homeExpected);
    let awayGoals = poissonRandom(awayExpected);

    // 20% chance of OT if tied (NHL-specific)
    if (homeGoals === awayGoals) {
      if (Math.random() < 0.20) {
        // OT: sudden death, each team has ~50/50 adjusted for strength
        if (Math.random() < homeProb) homeGoals++;
        else awayGoals++;
      } else {
        // Game stays tied - SO (coin flip for winner)
        if (Math.random() < homeProb) homeGoals++;
        else awayGoals++;
      }
    }

    if (homeGoals > awayGoals) homeWins++;
    else awayWins++;

    const totalScored = homeGoals + awayGoals;
    if (totalScored > totalLine) overs++;
    else if (totalScored === totalLine) pushes++;

    results.push({ home: homeGoals, away: awayGoals });
  }

  return {
    homeWinProb: homeWins / simCount,
    awayWinProb: awayWins / simCount,
    overProb: overs / simCount,
    underProb: (simCount - overs - pushes) / simCount,
    avgTotal: results.reduce((a, r) => a + r.home + r.away, 0) / simCount,
    simCount,
    sport: 'NHL',
  };
}

// MLB Monte Carlo Simulation  
// Uses Poisson distribution - runs are rare independent events
function simMLB(homeOdds, awayOdds, totalLine, simCount = 5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);

  const totalRuns = total || 8.5;
  const homeExpected = totalRuns * (0.4 + homeProb * 0.2);
  const awayExpected = totalRuns - homeExpected;

  let homeWins = 0, awayWins = 0, overs = 0, pushes = 0;
  let nrfiCount = 0; // no run first inning

  for (let i = 0; i < simCount; i++) {
    // Simulate full game
    let homeRuns = poissonRandom(homeExpected);
    let awayRuns = poissonRandom(awayExpected);

    // Extra innings if tied
    let extras = 0;
    while (homeRuns === awayRuns && extras < 3) {
      if (Math.random() < homeProb) homeRuns += poissonRandom(0.5);
      else awayRuns += poissonRandom(0.5);
      extras++;
    }
    if (homeRuns === awayRuns) homeRuns++; // force winner

    if (homeRuns > awayRuns) homeWins++;
    else awayWins++;

    const totalScored = homeRuns + awayRuns;
    if (totalScored > totalLine) overs++;
    else if (totalScored === totalLine) pushes++;

    // NRFI simulation - first inning uses ~1/9 of expected runs each
    const homeR1 = poissonRandom(homeExpected / 9);
    const awayR1 = poissonRandom(awayExpected / 9);
    if (homeR1 === 0 && awayR1 === 0) nrfiCount++;
  }

  return {
    homeWinProb: homeWins / simCount,
    awayWinProb: awayWins / simCount,
    overProb: overs / simCount,
    underProb: (simCount - overs - pushes) / simCount,
    nrfiProb: nrfiCount / simCount,
    avgTotal: 0,
    simCount,
    sport: 'MLB',
  };
}

// NBA Monte Carlo Simulation
// Uses Normal distribution - points scored in 2s and 3s, not Poisson
function simNBA(homeOdds, awayOdds, totalLine, simCount = 5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);

  const totalPoints = total || 220;
  const homeExpected = totalPoints * (0.4 + homeProb * 0.2);
  const awayExpected = totalPoints - homeExpected;
  const stdDev = 12; // typical NBA game std dev ~12 points per team

  let homeWins = 0, awayWins = 0, overs = 0, pushes = 0;

  for (let i = 0; i < simCount; i++) {
    let homePoints = Math.max(60, Math.round(normalRandom(homeExpected, stdDev)));
    let awayPoints = Math.max(60, Math.round(normalRandom(awayExpected, stdDev)));

    // OT if within 2 (rare but happens)
    if (Math.abs(homePoints - awayPoints) <= 2 && Math.random() < 0.15) {
      const otPoints = Math.round(normalRandom(5, 2));
      if (Math.random() < homeProb) homePoints += otPoints;
      else awayPoints += otPoints;
    }

    if (homePoints > awayPoints) homeWins++;
    else awayWins++;

    const totalScored = homePoints + awayPoints;
    if (totalScored > totalLine) overs++;
    else if (totalScored === totalLine) pushes++;
  }

  return {
    homeWinProb: homeWins / simCount,
    awayWinProb: awayWins / simCount,
    overProb: overs / simCount,
    underProb: (simCount - overs - pushes) / simCount,
    avgTotal: 0,
    simCount,
    sport: 'NBA',
  };
}

// NFL Monte Carlo Simulation
// Uses Normal distribution with situational adjustments
function simNFL(homeOdds, awayOdds, totalLine, simCount = 5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);

  const totalPoints = total || 44;
  const homeExpected = totalPoints * (0.4 + homeProb * 0.2);
  const awayExpected = totalPoints - homeExpected;
  const stdDev = 10; // typical NFL game std dev

  let homeWins = 0, awayWins = 0, overs = 0, pushes = 0;

  for (let i = 0; i < simCount; i++) {
    let homePoints = Math.max(0, Math.round(normalRandom(homeExpected, stdDev)));
    let awayPoints = Math.max(0, Math.round(normalRandom(awayExpected, stdDev)));

    // OT if tied
    if (homePoints === awayPoints) {
      if (Math.random() < homeProb) homePoints += 3;
      else awayPoints += 3;
    }

    if (homePoints > awayPoints) homeWins++;
    else awayWins++;

    const totalScored = homePoints + awayPoints;
    if (totalScored > totalLine) overs++;
    else if (totalScored === totalLine) pushes++;
  }

  return {
    homeWinProb: homeWins / simCount,
    awayWinProb: awayWins / simCount,
    overProb: overs / simCount,
    underProb: (simCount - overs - pushes) / simCount,
    avgTotal: 0,
    simCount,
    sport: 'NFL',
  };
}

// Main simulation function - routes to correct sport engine
export function runSim(sport, homeOdds, awayOdds, totalLine, simCount = 5000) {
  try {
    switch(sport) {
      case 'NHL': return simNHL(homeOdds, awayOdds, totalLine, simCount);
      case 'MLB': return simMLB(homeOdds, awayOdds, totalLine, simCount);
      case 'NBA': return simNBA(homeOdds, awayOdds, totalLine, simCount);
      case 'NFL': return simNFL(homeOdds, awayOdds, totalLine, simCount);
      default: return null;
    }
  } catch(e) {
    console.error('Sim error:', e);
    return null;
  }
}

// Get sim confidence for a specific bet type
export function getSimConfidence(simResult, betType, pickedTeam, odds) {
  if (!simResult) return null;
  const pick = (betType + pickedTeam).toUpperCase();

  if (pick.includes('NRFI')) return Math.round(simResult.nrfiProb * 100);
  if (pick.includes('YRFI')) return Math.round((1 - simResult.nrfiProb) * 100);
  if (pick.includes('OVER')) return Math.round(simResult.overProb * 100);
  if (pick.includes('UNDER')) return Math.round(simResult.underProb * 100);
  if (pick.includes('HOME') || pick.includes('ML')) return Math.round(simResult.homeWinProb * 100);
  if (pick.includes('AWAY')) return Math.round(simResult.awayWinProb * 100);

  // Default: use implied probability from odds
  const dec = odds > 0 ? odds/100+1 : 100/Math.abs(odds)+1;
  const impl = 1/dec;
  // Compare to relevant sim output
  if (simResult.homeWinProb > impl + 0.05) return Math.round(simResult.homeWinProb * 100);
  if (simResult.awayWinProb > impl + 0.05) return Math.round(simResult.awayWinProb * 100);
  return null;
}

// Auto-tune: adjust lambda multipliers based on graded results
export function calcTuningParams(gradedBets) {
  if (!gradedBets || gradedBets.length < 20) return { multiplier: 1.0 };
  const withSim = gradedBets.filter(b => b.simConfidence);
  if (!withSim.length) return { multiplier: 1.0 };

  // Compare sim confidence to actual win rate
  const avgSimConf = withSim.reduce((a, b) => a + b.simConfidence, 0) / withSim.length;
  const actualWR = withSim.filter(b => b.result === 'win').length / withSim.length * 100;
  const drift = actualWR - avgSimConf;

  // Adjust multiplier: if sim is overconfident, reduce; underconfident, increase
  const multiplier = 1 + (drift / 200); // gentle adjustment
  return { multiplier: Math.max(0.7, Math.min(1.3, multiplier)), drift };
}
