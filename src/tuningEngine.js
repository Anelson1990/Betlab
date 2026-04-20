// Self-Learning Tuning Engine for BetLab
// Analyzes graded bets and adjusts sim parameters

const MIN_SAMPLE = 20; // minimum graded picks before tuning
const MAX_ADJUSTMENT = 0.15; // max 15% adjustment per update
const TUNE_INTERVAL = 10; // retune every 10 new graded picks

export function analyzeBetTypePerf(gradedBets) {
  const perf = {
    Moneyline: { wins:0, total:0, profit:0 },
    Spread:    { wins:0, total:0, profit:0 },
    Total:     { wins:0, total:0, profit:0 },
    Parlay:    { wins:0, total:0, profit:0 },
  };
  // Sport+type breakdown
  const bySport = {};
  for (const bet of gradedBets) {
    const type = bet.betType?.includes('Parlay')?'Parlay':
                 bet.betType?.includes('Spread')||bet.betType?.includes('Puck')||bet.betType?.includes('Run')?'Spread':
                 bet.betType?.includes('Over')||bet.betType?.includes('Under')||bet.betType?.includes('Total')?'Total':
                 'Moneyline';
    if (!perf[type]) continue;
    perf[type].total++;
    if (bet.result==='win') {
      perf[type].wins++;
      const dec = bet.odds>0?bet.odds/100+1:100/Math.abs(bet.odds)+1;
      perf[type].profit += (dec-1)*bet.stake;
    } else if (bet.result==='loss') {
      perf[type].profit -= bet.stake;
    }
    // Track by sport+type
    const sport = bet.sport||'Unknown';
    const key = `${sport}_${type}`;
    if (!bySport[key]) bySport[key] = {wins:0, total:0, sport, type};
    bySport[key].total++;
    if (bet.result==='win') bySport[key].wins++;
  }
  perf._bySport = bySport;
  return perf;
}

export function analyzeConfTiers(gradedBets) {
  const tiers = {
    low:  { wins:0, total:0, label:'55-64%' },
    mid:  { wins:0, total:0, label:'65-74%' },
    high: { wins:0, total:0, label:'75%+' },
  };
  for (const bet of gradedBets) {
    const conf = bet.confidence||60;
    const tier = conf>=75?'high':conf>=65?'mid':'low';
    tiers[tier].total++;
    if (bet.result==='win') tiers[tier].wins++;
  }
  return tiers;
}

export function getDynamicConfidenceAdjustment(gradedBets) {
  // Per-sport calibration
  const sports = ['NHL','MLB','NBA','NFL'];
  const sportAdj = {};
  
  for (const sport of sports) {
    const sportBets = gradedBets.filter(b=>b.sport===sport&&b.confidence);
    if (sportBets.length < 10) { sportAdj[sport] = 0; continue; }
    
    // Group into confidence buckets
    const buckets = {};
    sportBets.forEach(b=>{
      const bucket = Math.floor(b.confidence/10)*10;
      if (!buckets[bucket]) buckets[bucket] = {wins:0,total:0,sumConf:0};
      buckets[bucket].total++;
      buckets[bucket].sumConf += b.confidence;
      if (b.result==='win') buckets[bucket].wins++;
    });
    
    // Calculate average drift
    let totalDrift = 0, bucketCount = 0;
    for (const [,b] of Object.entries(buckets)) {
      if (b.total >= 5) {
        const avgConf = b.sumConf/b.total;
        const actualWR = b.wins/b.total*100;
        totalDrift += actualWR - avgConf;
        bucketCount++;
      }
    }
    sportAdj[sport] = bucketCount > 0 ? Math.max(-20, Math.min(20, totalDrift/bucketCount)) : 0;
  }
  
  return sportAdj;
}

export function analyzeSimTuning(gradedBets, currentTuning) {
  const sports = ['NHL','MLB','NBA','NFL'];
  const tuning = {...currentTuning};
  const log = [];

  for (const sport of sports) {
    const sportBets = gradedBets.filter(b=>b.sport===sport&&b.simConfidence);
    if (sportBets.length < MIN_SAMPLE) {
      log.push({sport, status:'insufficient', count:sportBets.length, needed:MIN_SAMPLE});
      continue;
    }

    const avgSimConf = sportBets.reduce((a,b)=>a+b.simConfidence,0)/sportBets.length;
    const actualWR = sportBets.filter(b=>b.result==='win').length/sportBets.length*100;
    const drift = actualWR - avgSimConf;

    // Calculate adjustment - gentle nudge toward actual performance
    const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, drift/100*0.5));
    const oldMultiplier = tuning[sport]?.lambdaMultiplier||1.0;
    const newMultiplier = Math.max(0.7, Math.min(1.3, oldMultiplier + adjustment));

    tuning[sport] = {
      lambdaMultiplier: Math.round(newMultiplier*1000)/1000,
      sampleSize: sportBets.length,
      lastUpdated: new Date().toISOString(),
      avgSimConf: Math.round(avgSimConf*10)/10,
      actualWR: Math.round(actualWR*10)/10,
      drift: Math.round(drift*10)/10,
    };

    log.push({
      sport,
      status: 'updated',
      oldMultiplier: Math.round(oldMultiplier*1000)/1000,
      newMultiplier: tuning[sport].lambdaMultiplier,
      avgSimConf: tuning[sport].avgSimConf,
      actualWR: tuning[sport].actualWR,
      drift: tuning[sport].drift,
      count: sportBets.length,
    });
  }

  return { tuning, log };
}

export function getBettingInsights(gradedBets, betTypePerf, confTiers) {
  const insights = [];

  // Bet type insights
  for (const [type, perf] of Object.entries(betTypePerf)) {
    if (perf.total < 10) continue;
    const wr = perf.wins/perf.total*100;
    const roi = perf.profit/(perf.total*10)*100; // rough ROI estimate
    if (wr < 48) insights.push({type:'warning', msg:`❌ Avoid ${type} bets — only ${wr.toFixed(0)}% win rate (${perf.total} bets)`});
    else if (wr > 58) insights.push({type:'positive', msg:`✅ Strong edge in ${type} — ${wr.toFixed(0)}% win rate (${perf.total} bets)`});
  }

  // Confidence tier insights
  const highTier = confTiers.high;
  const lowTier = confTiers.low;
  if (highTier.total >= 10) {
    const highWR = highTier.wins/highTier.total*100;
    if (highWR < 52) insights.push({type:'warning', msg:`⚠️ High confidence (75%+) only hitting ${highWR.toFixed(0)}% — reduce stake on these`});
    else insights.push({type:'positive', msg:`✅ High confidence picks hitting ${highWR.toFixed(0)}% — trust these spots`});
  }
  if (lowTier.total >= 10) {
    const lowWR = lowTier.wins/lowTier.total*100;
    if (lowWR > 55) insights.push({type:'positive', msg:`✅ Low confidence picks (55-64%) hitting ${lowWR.toFixed(0)}% — consider sizing up`});
  }

  // Sport insights
  const sports = ['NHL','MLB','NBA','NFL'];
  for (const sport of sports) {
    const sportBets = gradedBets.filter(b=>b.sport===sport);
    if (sportBets.length < 10) continue;
    const wins = sportBets.filter(b=>b.result==='win').length;
    const wr = wins/sportBets.length*100;
    if (wr > 60) insights.push({type:'positive', msg:`🏆 Best sport: ${sport} at ${wr.toFixed(0)}% (${wins}W-${sportBets.length-wins}L)`});
    if (wr < 45) insights.push({type:'warning', msg:`📉 Struggling in ${sport}: ${wr.toFixed(0)}% — consider skipping`});
  }

  return insights;
}

export function getCalibrationFilter(gradedBets) {
  // Calculate actual win rates by confidence tier
  const tiers = {
    low:  { min:55, max:64, wins:0, total:0 },
    mid:  { min:65, max:74, wins:0, total:0 },
    high: { min:75, max:100, wins:0, total:0 },
  };
  
  gradedBets.forEach(b => {
    const conf = b.confidence||60;
    const tier = conf>=75?'high':conf>=65?'mid':'low';
    tiers[tier].total++;
    if (b.result==='win') tiers[tier].wins++;
  });

  const BREAKEVEN = 52.4; // break-even at -110
  const MIN_SAMPLE = 15; // need 15 picks before filtering

  const filter = {};
  for (const [name, t] of Object.entries(tiers)) {
    const actualWR = t.total>=MIN_SAMPLE ? (t.wins/t.total*100) : null;
    const expectedWR = name==='low'?59.5:name==='mid'?69.5:80;
    const drift = actualWR !== null ? actualWR - expectedWR : 0;
    
    filter[name] = {
      actualWR,
      expectedWR,
      drift: drift.toFixed(1),
      sampleSize: t.total,
      status: actualWR===null ? 'insufficient_data' :
              actualWR < BREAKEVEN ? 'block' :      // below break-even
              actualWR < expectedWR - 10 ? 'warn' : // significantly underperforming
              'pass',
      adjustment: actualWR !== null ? Math.max(-15, Math.min(15, drift)) : 0,
    };
  }
  return filter;
}

export function applyCalibrationToConfidence(confidence, calibrationFilter) {
  const tier = confidence>=75?'high':confidence>=65?'mid':'low';
  const f = calibrationFilter[tier];
  if (!f || f.status==='insufficient_data') return { confidence, blocked:false, warning:null };
  
  // Adjust confidence down if underperforming
  const adjustedConf = Math.max(55, confidence + parseFloat(f.adjustment||0));
  
  return {
    confidence: Math.round(adjustedConf),
    blocked: f.status==='block',
    warning: f.status==='warn' ? `⚠️ ${tier} confidence tier hitting ${f.actualWR?.toFixed(0)}% (expected ${f.expectedWR}%)` : null,
    originalConf: confidence,
  };
}

export function shouldRetune(gradedBets, lastTuneCount) {
  return gradedBets.length >= MIN_SAMPLE && 
         (gradedBets.length - lastTuneCount) >= TUNE_INTERVAL;
}

export function buildTuningPrompt(simTuning, betTypePerf, confTiers, insights) {
  const lines = ['SELF-LEARNING MODEL STATUS:'];
  
  // Sim tuning status
  for (const [sport, t] of Object.entries(simTuning)) {
    if (t.sampleSize > 0) {
      lines.push(`${sport} sim: ${t.lambdaMultiplier}x multiplier (sim avg ${t.avgSimConf}% vs actual ${t.actualWR}% on ${t.sampleSize} picks)`);
    }
  }

  // Bet type performance
  const goodTypes = [], badTypes = [];
  for (const [type, p] of Object.entries(betTypePerf)) {
    if (p.total >= 10) {
      const wr = p.wins/p.total*100;
      if (wr > 55) goodTypes.push(`${type}(${wr.toFixed(0)}%)`);
      if (wr < 48) badTypes.push(`${type}(${wr.toFixed(0)}%)`);
    }
  }
  if (goodTypes.length) lines.push(`Strong bet types: ${goodTypes.join(', ')}`);
  if (badTypes.length) lines.push(`Avoid bet types: ${badTypes.join(', ')} — below break-even`);
  // Sport+type breakdown
  if (betTypePerf._bySport) {
    const sportBreakdown = Object.values(betTypePerf._bySport)
      .filter(s=>s.total>=5)
      .sort((a,b)=>(b.wins/b.total)-(a.wins/a.total))
      .map(s=>`${s.sport} ${s.type}: ${(s.wins/s.total*100).toFixed(0)}% (${s.total})`)
      .join(', ');
    if (sportBreakdown) lines.push(`By sport+type: ${sportBreakdown}`);
  }

  // Confidence tiers
  for (const [tier, t] of Object.entries(confTiers)) {
    if (t.total >= 10) {
      const wr = t.wins/t.total*100;
      const label = tier==='high'?'75%+':tier==='mid'?'65-74%':'55-64%';
      lines.push(`Conf ${label}: ${wr.toFixed(0)}% actual win rate (${t.total} picks)`);
    }
  }

  return lines.join('\n');
}
