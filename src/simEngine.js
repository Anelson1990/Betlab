// Monte Carlo Simulation Engine for BetLab

function poissonRandom(lambda) {
  let L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function normalRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function parseOdds(homeOdds, awayOdds, totalLine) {
  const homeImpl = homeOdds > 0 ? 100/(homeOdds+100) : Math.abs(homeOdds)/(Math.abs(homeOdds)+100);
  const awayImpl = awayOdds > 0 ? 100/(awayOdds+100) : Math.abs(awayOdds)/(Math.abs(awayOdds)+100);
  const sum = homeImpl + awayImpl;
  return { homeProb: homeImpl/sum, awayProb: awayImpl/sum, total: totalLine||6.5 };
}

function simNHL(homeOdds, awayOdds, totalLine, simCount=5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);
  const totalGoals = total||6.0;
  const homeExp = totalGoals*(0.4+homeProb*0.2);
  const awayExp = totalGoals-homeExp;
  let homeWins=0, awayWins=0, overs=0, pushes=0;
  for (let i=0;i<simCount;i++) {
    let h=poissonRandom(homeExp), a=poissonRandom(awayExp);
    if (h===a) { if(Math.random()<homeProb) h++; else a++; }
    if (h>a) homeWins++; else awayWins++;
    const t=h+a;
    if(t>totalLine) overs++;
    else if(t===totalLine) pushes++;
  }
  return { homeWinProb:homeWins/simCount, awayWinProb:awayWins/simCount, overProb:overs/simCount, underProb:(simCount-overs-pushes)/simCount, sport:'NHL' };
}

function simMLB(homeOdds, awayOdds, totalLine, simCount=5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);
  const totalRuns = total||8.5;
  const homeExp = totalRuns*(0.4+homeProb*0.2);
  const awayExp = totalRuns-homeExp;
  let homeWins=0, awayWins=0, overs=0, pushes=0, nrfi=0;
  for (let i=0;i<simCount;i++) {
    let h=poissonRandom(homeExp), a=poissonRandom(awayExp);
    if(h===a){if(Math.random()<homeProb)h++;else a++;}
    if(h>a) homeWins++; else awayWins++;
    const t=h+a;
    if(t>totalLine) overs++;
    else if(t===totalLine) pushes++;
    if(poissonRandom(homeExp/9)===0&&poissonRandom(awayExp/9)===0) nrfi++;
  }
  return { homeWinProb:homeWins/simCount, awayWinProb:awayWins/simCount, overProb:overs/simCount, underProb:(simCount-overs-pushes)/simCount, nrfiProb:nrfi/simCount, sport:'MLB' };
}

function simNBA(homeOdds, awayOdds, totalLine, simCount=5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);
  const totalPts = total||220;
  const homeExp = totalPts*(0.4+homeProb*0.2);
  const awayExp = totalPts-homeExp;
  let homeWins=0, awayWins=0, overs=0, pushes=0;
  for (let i=0;i<simCount;i++) {
    let h=Math.max(60,Math.round(normalRandom(homeExp,12)));
    let a=Math.max(60,Math.round(normalRandom(awayExp,12)));
    if(h===a){if(Math.random()<homeProb)h+=3;else a+=3;}
    if(h>a) homeWins++; else awayWins++;
    const t=h+a;
    if(t>totalLine) overs++;
    else if(t===totalLine) pushes++;
  }
  return { homeWinProb:homeWins/simCount, awayWinProb:awayWins/simCount, overProb:overs/simCount, underProb:(simCount-overs-pushes)/simCount, sport:'NBA' };
}

function simNFL(homeOdds, awayOdds, totalLine, simCount=5000) {
  const { homeProb, total } = parseOdds(homeOdds, awayOdds, totalLine);
  const totalPts = total||44;
  const homeExp = totalPts*(0.4+homeProb*0.2);
  const awayExp = totalPts-homeExp;
  let homeWins=0, awayWins=0, overs=0, pushes=0;
  for (let i=0;i<simCount;i++) {
    let h=Math.max(0,Math.round(normalRandom(homeExp,10)));
    let a=Math.max(0,Math.round(normalRandom(awayExp,10)));
    if(h===a){if(Math.random()<homeProb)h+=3;else a+=3;}
    if(h>a) homeWins++; else awayWins++;
    const t=h+a;
    if(t>totalLine) overs++;
    else if(t===totalLine) pushes++;
  }
  return { homeWinProb:homeWins/simCount, awayWinProb:awayWins/simCount, overProb:overs/simCount, underProb:(simCount-overs-pushes)/simCount, sport:'NFL' };
}

export function runSim(sport, homeOdds, awayOdds, totalLine, simCount=5000) {
  try {
    switch(sport) {
      case 'NHL': return simNHL(homeOdds, awayOdds, totalLine, simCount);
      case 'MLB': return simMLB(homeOdds, awayOdds, totalLine, simCount);
      case 'NBA': return simNBA(homeOdds, awayOdds, totalLine, simCount);
      case 'NFL': return simNFL(homeOdds, awayOdds, totalLine, simCount);
      default: return null;
    }
  } catch(e) { return null; }
}

export function getSimConfidence(simResult, betType, pickedTeam, odds) {
  if (!simResult) return null;
  const pick = (betType+pickedTeam).toUpperCase();
  if (pick.includes('NRFI')) return Math.round(simResult.nrfiProb*100);
  if (pick.includes('YRFI')) return Math.round((1-simResult.nrfiProb)*100);
  if (pick.includes('OVER')) return Math.round(simResult.overProb*100);
  if (pick.includes('UNDER')) return Math.round(simResult.underProb*100);
  if (pick.includes('HOME')) return Math.round(simResult.homeWinProb*100);
  if (pick.includes('AWAY')) return Math.round(simResult.awayWinProb*100);
  return Math.round(Math.max(simResult.homeWinProb,simResult.awayWinProb)*100);
}

export function calcTuningParams(gradedBets) {
  if (!gradedBets||gradedBets.length<20) return { multiplier:1.0 };
  const withSim = gradedBets.filter(b=>b.simConfidence);
  if (!withSim.length) return { multiplier:1.0 };
  const avgSimConf = withSim.reduce((a,b)=>a+b.simConfidence,0)/withSim.length;
  const actualWR = withSim.filter(b=>b.result==='win').length/withSim.length*100;
  const drift = actualWR-avgSimConf;
  return { multiplier:Math.max(0.7,Math.min(1.3,1+(drift/200))), drift };
}
