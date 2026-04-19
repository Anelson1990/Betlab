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

function runSimulation(sport, homeImpliedProb, awayImpliedProb) {
  let homeWins = 0, awayWins = 0, ties = 0;
  const homeScores = [], awayScores = [];
  for (let i = 0; i < SIMULATIONS; i++) {
    const homeLambda = impliedProbToLambda(homeImpliedProb, sport, true);
    const awayLambda = impliedProbToLambda(awayImpliedProb, sport, false);
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
    const homeLambdaPerInning = homeLambda / 9;
    const awayLambdaPerInning = awayLambda / 9;
    for (let i = 0; i < SIMULATIONS; i++) {
      const homeR1 = poissonRandom(homeLambdaPerInning);
      const awayR1 = poissonRandom(awayLambdaPerInning);
      if (homeR1 === 0 && awayR1 === 0) nrfiCount++;
    }
  }
  const topScorelines = Object.entries(scoreDist).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([score,count])=>({score,probability:Math.round(count/SIMULATIONS*1000)/10}));
  return { homeWinProb:Math.round(homeWinProb*1000)/10, awayWinProb:Math.round(awayWinProb*1000)/10, avgHomeScore:Math.round(avgHome*10)/10, avgAwayScore:Math.round(avgAway*10)/10, simulations:SIMULATIONS, topScorelines }, nrfiProb:sport==='MLB'?Math.round(nrfiCount/SIMULATIONS*1000)/10:null, yrfiProb:sport==='MLB'?Math.round((1-nrfiCount/SIMULATIONS)*1000)/10:null };
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

  const { sport, homeTeam, awayTeam, homeOdds, awayOdds } = req.body||{};
  if (!sport||!homeOdds||!awayOdds) return res.status(400).json({error:'Missing fields'});

  const homeImpl = americanToImplied(homeOdds)*100;
  const awayImpl = americanToImplied(awayOdds)*100;
  const total = homeImpl+awayImpl;
  const homeNoVig = homeImpl/total*100;
  const awayNoVig = awayImpl/total*100;

  const sim = runSimulation(sport, homeNoVig/100, awayNoVig/100);
  const homeEdge = sim.homeWinProb - homeNoVig;
  const awayEdge = sim.awayWinProb - awayNoVig;
  const homeEV = calculateEV(sim.homeWinProb, homeOdds);
  const awayEV = calculateEV(sim.awayWinProb, awayOdds);
  const homeKelly = calculateKelly(sim.homeWinProb, homeOdds);
  const awayKelly = calculateKelly(sim.awayWinProb, awayOdds);

  const MIN_EDGE = 3;
  let recommendation = 'PASS', recommendedSide = null, confidence = 0, recommendedUnits = 0;
  if (homeEdge > awayEdge && homeEdge >= MIN_EDGE && homeEV >= MIN_EDGE) {
    recommendation='BET HOME'; recommendedSide=homeTeam;
    confidence=Math.min(99,Math.round(50+homeEdge*3));
    recommendedUnits=homeKelly.halfKelly;
  } else if (awayEdge >= MIN_EDGE && awayEV >= MIN_EDGE) {
    recommendation='BET AWAY'; recommendedSide=awayTeam;
    confidence=Math.min(99,Math.round(50+awayEdge*3));
    recommendedUnits=awayKelly.halfKelly;
  }

  res.status(200).json({ success:true, sport, homeTeam, awayTeam, homeOdds, awayOdds,
    homeImpliedProb:Math.round(homeImpl*10)/10, awayImpliedProb:Math.round(awayImpl*10)/10,
    homeNoVigProb:Math.round(homeNoVig*10)/10, awayNoVigProb:Math.round(awayNoVig*10)/10,
    simulation:sim, analysis:{homeEdge:Math.round(homeEdge*10)/10, awayEdge:Math.round(awayEdge*10)/10, homeEV, awayEV, homeKelly, awayKelly},
    recommendation, recommendedSide, confidence, recommendedUnits });
}
