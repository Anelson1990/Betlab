const SIMULATIONS = 10000;

const BASELINE_SCORING = {
  NHL: { home: 3.1, away: 2.8 },
  NBA: { home: 113, away: 110 },
  NFL: { home: 23, away: 21 },
  MLB: { home: 4.5, away: 4.2 },
};

const HOME_ADVANTAGE = { NHL: 1.05, NBA: 1.03, NFL: 1.04, MLB: 1.04 };
const USE_POISSON = { NHL: true, MLB: true, NBA: false, NFL: false };

function poissonRandom(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function normalRandom(mean, stdDev) {
  const u1 = Math.random(), u2 = Math.random();
  return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev;
}

function impliedProbToLambda(impliedProb, sport, isHome) {
  const baseline = BASELINE_SCORING[sport];
  const homeAdv = HOME_ADVANTAGE[sport];
  const baseRate = isHome ? baseline.home : baseline.away;
  const adjustment = isHome ? homeAdv : 1 / homeAdv;
  const strengthFactor = 0.5 + (impliedProb - 0.5) * 1.2;
  return baseRate * strengthFactor * adjustment;
}

function statsToLambda(sport, teamStats, isHome, opponentStats) {
  // Calculate lambda from actual team stats instead of market odds
  const baseline = BASELINE_SCORING[sport];
  const homeAdv = HOME_ADVANTAGE[sport];
  
  if (sport === 'NHL') {
    const gfPg = parseFloat(teamStats?.goalsForPerGame) || (isHome ? baseline.home : baseline.away);
    const oppGaPg = parseFloat(opponentStats?.goalsAgainstPerGame) || baseline.home;
    
    // Use MoneyPuck xG data if available - more predictive than raw goals
    const xGF = parseFloat(teamStats?.moneyPuck?.xGoalsFor) || null;
    const oppXGA = parseFloat(opponentStats?.moneyPuck?.xGoalsAgainst) || null;
    const xGFPct = parseFloat(teamStats?.moneyPuck?.xGoalsForPct) || null;
    
    // Goalie quality adjustment using xGoals
    const teamXGF = xGF ? xGF / 82 : gfPg; // per game
    const oppXGA_pg = oppXGA ? oppXGA / 82 : oppGaPg;
    
    // xGF% > 50 means team generates more quality chances than they allow
    const xgStrengthFactor = xGFPct ? (xGFPct / 50) : 1.0;
    
    // Blend xG with raw goals (60% xG, 40% raw) when available
    const offenseBase = xGF ? (teamXGF * 0.6 + gfPg * 0.4) : gfPg;
    const defenseBase = oppXGA ? (oppXGA_pg * 0.6 + oppGaPg * 0.4) : oppGaPg;
    
    const lambda = (offenseBase * 0.6 + defenseBase * 0.4) * xgStrengthFactor * (isHome ? homeAdv : 1/homeAdv);
    return Math.max(0.5, lambda);
  }
  if (sport === 'MLB') {
    const rpg = parseFloat(teamStats?.batting?.runsPerGame) || (isHome ? baseline.home : baseline.away);
    // Use xERA if available (Statcast expected ERA) - more predictive than actual ERA
    const oppXera = parseFloat(opponentStats?.probablePitcher?.xera) || null;
    const oppEra = parseFloat(opponentStats?.probablePitcher?.era) || parseFloat(opponentStats?.pitching?.era) || 4.0;
    const effectiveEra = oppXera ? (oppXera * 0.6 + oppEra * 0.4) : oppEra; // blend xERA with ERA
    // Velocity degradation penalty - if SP velocity trending down, ERA likely to worsen
    const veloTrend = parseFloat(opponentStats?.probablePitcher?.statcast?.veloTrend) || 0;
    const veloFactor = veloTrend <= -1.5 ? 1.1 : veloTrend >= 1.0 ? 0.95 : 1.0;
    // Higher opponent ERA = more runs scored
    const eraFactor = (effectiveEra / 4.0) * veloFactor;
    const lambda = rpg * 0.5 * eraFactor * (isHome ? homeAdv : 1/homeAdv);
    return Math.max(0.5, lambda);
  }
  if (sport === 'NBA') {
    const ppg = parseFloat(teamStats?.pts) || (isHome ? baseline.home : baseline.away);
    const oppPpg = parseFloat(opponentStats?.pts) || baseline.away;
    const lambda = (ppg * 0.6 + oppPpg * 0.4) * (isHome ? homeAdv : 1/homeAdv);
    return Math.max(80, lambda);
  }
  // NFL
  const ppg = parseFloat(teamStats?.pointsPerGame) || (isHome ? baseline.home : baseline.away);
  return Math.max(10, ppg * (isHome ? homeAdv : 1/homeAdv));
}

// Log5 + Pythagorean MLB win probability calculator
function mlbLog5WinProb(homeStats, awayStats) {
  try {
    // Pythagorean win% from runs scored/allowed
    const homeRS = parseFloat(homeStats?.batting?.runsPerGame) || 4.5;
    const homeRA = parseFloat(homeStats?.pitching?.era) || 4.0;
    const awayRS = parseFloat(awayStats?.batting?.runsPerGame) || 4.2;
    const awayRA = parseFloat(awayStats?.pitching?.era) || 4.0;

    // Pythagorean expectation (exponent 1.83 is optimal for MLB per research)
    const exp = 1.83;
    const homePythag = Math.pow(homeRS, exp) / (Math.pow(homeRS, exp) + Math.pow(homeRA, exp));
    const awayPythag = Math.pow(awayRS, exp) / (Math.pow(awayRS, exp) + Math.pow(awayRA, exp));

    // Pitcher adjustment - shift win% based on today's SP vs league avg (4.00 ERA)
    const leagueAvgERA = 4.00;
    const homeSPEra = parseFloat(homeStats?.probablePitcher?.era) || leagueAvgERA;
    const awaySPEra = parseFloat(awayStats?.probablePitcher?.era) || leagueAvgERA;
    const homePitcherAdj = (leagueAvgERA - homeSPEra) * 0.02; // each 1 ERA pt = 2% shift
    const awayPitcherAdj = (leagueAvgERA - awaySPEra) * 0.02;

    const homeAdj = Math.max(0.20, Math.min(0.80, homePythag + homePitcherAdj + 0.02)); // +2% home field
    const awayAdj = Math.max(0.20, Math.min(0.80, awayPythag + awayPitcherAdj));

    // Log5 formula: P(A beats B) = (A - A*B) / (A + B - 2*A*B)
    const log5Home = (homeAdj - homeAdj * awayAdj) / (homeAdj + awayAdj - 2 * homeAdj * awayAdj);
    
    return Math.max(0.25, Math.min(0.75, log5Home));
  } catch { return null; }
}

function runSimulation(sport, homeImpliedProb, awayImpliedProb, homeStatLambda=null, awayStatLambda=null) {
  let homeWins = 0, awayWins = 0, ties = 0;
  const homeScores = [], awayScores = [];
  // Use stats-based lambda if available, otherwise fall back to market-implied
  const basHomeLambda = homeStatLambda || impliedProbToLambda(homeImpliedProb, sport, true);
  const basAwayLambda = awayStatLambda || impliedProbToLambda(awayImpliedProb, sport, false);
  for (let i = 0; i < SIMULATIONS; i++) {
    const homeLambda = basHomeLambda;
    const awayLambda = basAwayLambda;
    let h, a;
    if (USE_POISSON[sport]) {
      h = poissonRandom(homeLambda);
      a = poissonRandom(awayLambda);
    } else {
      const std = sport === 'NBA' ? 12 : 10;
      h = Math.max(0, normalRandom(homeLambda, std));
      a = Math.max(0, normalRandom(awayLambda, std));
    }
    homeScores.push(h); awayScores.push(a);
    if (h > a) homeWins++;
    else if (a > h) awayWins++;
    else ties++;
  }
  const homeWinProb = (homeWins + ties * 0.5) / SIMULATIONS;
  const awayWinProb = (awayWins + ties * 0.5) / SIMULATIONS;
  const avgHome = homeScores.reduce((a,b)=>a+b,0)/SIMULATIONS;
  const avgAway = awayScores.reduce((a,b)=>a+b,0)/SIMULATIONS;
  const scoreDist = {};
  if (USE_POISSON[sport]) {
    for (let i=0;i<homeScores.length;i++) {
      const k = `${homeScores[i]}-${awayScores[i]}`;
      scoreDist[k] = (scoreDist[k]||0)+1;
    }
  }
  // NRFI - first inning simulation for MLB
  let nrfiCount = 0;
  if (sport === 'MLB') {
    // Use stats lambda for NRFI — more accurate than market-derived
    const hLambda = homeStatLambda || impliedProbToLambda(homeImpliedProb, sport, true);
    const aLambda = awayStatLambda || impliedProbToLambda(awayImpliedProb, sport, false);
    for (let n = 0; n < SIMULATIONS; n++) {
      if (poissonRandom(hLambda/9) === 0 && poissonRandom(aLambda/9) === 0) nrfiCount++;
    }
  }

  const topScorelines = Object.entries(scoreDist).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([score,count])=>({score,probability:Math.round(count/SIMULATIONS*1000)/10}));
  return { homeWinProb:Math.round(homeWinProb*1000)/10, awayWinProb:Math.round(awayWinProb*1000)/10, avgHomeScore:Math.round(avgHome*10)/10, avgAwayScore:Math.round(avgAway*10)/10, simulations:SIMULATIONS, topScorelines, nrfiProb:sport==='MLB'?Math.round(nrfiCount/SIMULATIONS*1000)/10:null, yrfiProb:sport==='MLB'?Math.round((1-nrfiCount/SIMULATIONS)*1000)/10:null };
}

function americanToImplied(odds) {
  const n = parseInt(odds);
  return n > 0 ? 100/(n+100) : Math.abs(n)/(Math.abs(n)+100);
}

function calculateEV(trueProb, americanOdds) {
  const prob = trueProb/100;
  const odds = parseInt(americanOdds);
  const profit = odds > 0 ? odds/100 : 100/Math.abs(odds);
  return Math.round((prob*profit-(1-prob)*1)*1000)/10;
}

function calculateKelly(trueProb, americanOdds) {
  const prob = trueProb/100;
  const odds = parseInt(americanOdds);
  const b = odds > 0 ? odds/100 : 100/Math.abs(odds);
  const kelly = (b*prob-(1-prob))/b;
  return { fullKelly:Math.round(Math.max(0,kelly)*1000)/10, halfKelly:Math.round(Math.max(0,kelly/2)*1000)/10 };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { sport, homeTeam, awayTeam, homeOdds, awayOdds, homeStats, awayStats } = req.body||{};
  if (!sport||!homeOdds||!awayOdds) return res.status(400).json({error:'Missing fields'});

  const homeImpl = americanToImplied(homeOdds)*100;
  const awayImpl = americanToImplied(awayOdds)*100;
  const total = homeImpl+awayImpl;
  const homeNoVig = homeImpl/total*100;
  const awayNoVig = awayImpl/total*100;

  // Use stats-based lambdas if available — breaks circular dependency
  let homeStatLambda = null, awayStatLambda = null;
  if (homeStats && awayStats) {
    homeStatLambda = statsToLambda(sport, homeStats, true, awayStats);
    awayStatLambda = statsToLambda(sport, awayStats, false, homeStats);
  }

  const sim = runSimulation(sport, homeNoVig/100, awayNoVig/100, homeStatLambda, awayStatLambda);
  
  // Log5 + Pythagorean for MLB (independent method)
  let log5 = null;
  if (sport === 'MLB' && homeStats && awayStats) {
    const log5HomeProb = mlbLog5WinProb(homeStats, awayStats);
    if (log5HomeProb) {
      log5 = {
        homeWinProb: Math.round(log5HomeProb * 1000) / 10,
        awayWinProb: Math.round((1 - log5HomeProb) * 1000) / 10,
      };
    }
  }

  // Consensus: blend MC sim and Log5 when both available
  const mcHomeProb = sim.homeWinProb;
  const consensusHomeProb = log5 ? (mcHomeProb * 0.5 + log5.homeWinProb * 0.5) : mcHomeProb;
  const consensusAwayProb = 100 - consensusHomeProb;

  // Edge = consensus prob vs market implied prob
  const homeEdge = consensusHomeProb - homeNoVig;
  const awayEdge = consensusAwayProb - awayNoVig;
  const homeEV = calculateEV(consensusHomeProb, homeOdds);
  const awayEV = calculateEV(consensusAwayProb, awayOdds);
  const homeKelly = calculateKelly(consensusHomeProb, homeOdds);
  const awayKelly = calculateKelly(consensusAwayProb, awayOdds);

  // Check if both methods agree (within 5%)
  const methodsAgree = log5 ? Math.abs(mcHomeProb - log5.homeWinProb) <= 5 : true;

  const MIN_EDGE = 7; // raised from 3% to 7% per backtest research
  let recommendation = 'PASS', recommendedSide = null, confidence = 0, recommendedUnits = 0;
  if (homeEdge > awayEdge && homeEdge >= MIN_EDGE && homeEV >= MIN_EDGE) {
    recommendation='BET HOME'; recommendedSide=homeTeam;
    confidence=Math.min(99,Math.round(50+homeEdge*3));
    if (log5 && !methodsAgree) confidence = Math.round(confidence * 0.85); // reduce if methods disagree
    recommendedUnits=homeKelly.halfKelly;
  } else if (awayEdge >= MIN_EDGE && awayEV >= MIN_EDGE) {
    recommendation='BET AWAY'; recommendedSide=awayTeam;
    confidence=Math.min(99,Math.round(50+awayEdge*3));
    if (log5 && !methodsAgree) confidence = Math.round(confidence * 0.85);
    recommendedUnits=awayKelly.halfKelly;
  }

  res.status(200).json({ success:true, sport, homeTeam, awayTeam, homeOdds, awayOdds,
    homeImpliedProb:Math.round(homeImpl*10)/10, awayImpliedProb:Math.round(awayImpl*10)/10,
    homeNoVigProb:Math.round(homeNoVig*10)/10, awayNoVigProb:Math.round(awayNoVig*10)/10,
    simulation:sim, log5, consensusProb:{home:Math.round(consensusHomeProb*10)/10, away:Math.round(consensusAwayProb*10)/10}, methodsAgree,
    analysis:{homeEdge:Math.round(homeEdge*10)/10, awayEdge:Math.round(awayEdge*10)/10, homeEV, awayEV, homeKelly, awayKelly},
    recommendation, recommendedSide, confidence, recommendedUnits });
}
