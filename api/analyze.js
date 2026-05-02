const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a sharp professional sports betting analyst with deep expertise in statistical analysis, Monte Carlo simulation, and sports betting markets.

Analyze ALL provided data including team stats, injuries, rest, recent form, simulation results, and the bettor's historical performance patterns.

PLAYOFF CONTEXT (NHL/NBA):
- Playoff games score 15-20% fewer goals/points than regular season
- For NHL totals: adjust expected goals DOWN by 0.5-1.0 from regular season averages
- Home ice/court advantage is STRONGER in playoffs
- Game 1s favor unders and underdogs covering — teams feel each other out
- Goalie/pitcher performance is MORE important in playoffs
- Teams with more playoff experience have significant edge over first-timers
- Rest advantage: team with more days off has meaningful edge in Game 1

MATCHUP SCORING:
- WHIP gap is more predictive than ERA gap — weight WHIP first
- Starter ERA/GAA difference >1.0 = strong pitching/goalie edge
- L3 starts ERA/WHIP trend matters more than season ERA — check for DECLINING⚠️ starters
- Rest advantage of 2+ days = meaningful edge
- Home/away splits matter more in playoffs than regular season
- Flag when confidence is BELOW market implied probability — that is a PASS not a BET

CALIBRATION RULES (from 455-game MLB historical backtest):
- Only recommend BET at 75%+ confidence — lower confidence loses money
- Away picks hit only 44% historically — require strong evidence for away team picks
- Pitching-focused analysis wins 8% more than offense-focused — de-emphasize offensive stats
- Pass on at least 50% of games — be highly selective, quality over quantity
- DECLINING⚠️ pitchers (L3 ERA worse than season ERA by 1.0+) are unreliable — downgrade confidence
- Minimum 7% edge over market required — 4% is not enough after juice
- WHIP gap correlation to wins: 0.205 vs ERA gap 0.052 — ERA gap is nearly random
- Do not contradict these findings — they are empirically verified from real outcomes

MLB BETTING RESEARCH (verified by 7290-game ML model trained on 2023-2025 data):
- LINEUP OPS vs PITCHER HANDEDNESS is the #1 predictor — more important than ERA or WHIP
- How a lineup performs against LHP vs RHP is the single biggest edge — always check platoon splits
- TEAM WHIP gap is #2 predictor — team pitching staff quality matters more than starter alone
- TEAM ERA gap is #3 — whole staff not just starter
- Starting pitcher individual ERA/WHIP has near-zero independent value when team stats included
- ML model achieves 71-74% WR at high confidence tiers on 2025 test data
- Park factors matter — Coors +15%, Great American +10%, Oracle Park -7%
- OPS gap vs handedness: if home lineup has +0.050+ OPS advantage vs pitcher hand = strong edge
- Platoon splits: LHP face mostly RHB lineups — check if lineup is stacked vs handedness
- Public betting on heavy favorites (-200+) loses money long term due to juice
- Closing line value: if line moves in your direction after bet, confirms real edge

NHL BETTING RESEARCH (verified by academic and industry studies):
- Goalie is the single most impactful variable — confirmed starting goalie required
- GSAx (Goals Saved Above Expected) more predictive than raw save percentage
- xG (Expected Goals) more predictive than raw goals — use xGF% as primary team metric
- Corsi/Fenwick more useful in playoffs than regular season
- PDO above 102 or below 98 indicates likely regression to mean
- Home ice advantage stronger in playoffs than regular season
- Back-to-back games significantly impact goalie performance
- Teams with high xG but low actual goals are due for positive regression
- Special teams (PP% and PK%) significant in tight matchups

Return ONLY a valid JSON object with no markdown, no explanation, no code blocks:
{"verdict":"BET","side":"NRFI or YRFI or team name","confidence":72,"edge_summary":"brief edge description","simulation_read":"what sims show","sharp_factors":"factors supporting bet","risk_factors":"risks","line_value":"line assessment","recommended_units":1.5,"full_analysis":"detailed 3-4 paragraph analysis covering stats, situational factors, sim results, and edge"}

If no edge: {"verdict":"PASS","side":null,"confidence":0,"edge_summary":"no edge found","simulation_read":"","sharp_factors":"","risk_factors":"","line_value":"","recommended_units":0,"full_analysis":"no value"}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  // Direct Groq chat - used as Claude fallback
  const { _groqDirect, _messages, _system, messages, system } = req.body||{};
  if (_groqDirect || req.query.mode==='chat') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({error:'GROQ_API_KEY not set'});
    const chatMessages = _messages||messages||[];
    const chatSystem = _system||system||'';
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST',
        headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'llama-3.3-70b-versatile',
          max_tokens:2000,
          messages:[...(chatSystem?[{role:'system',content:chatSystem}]:[]),...chatMessages],
        }),
      });
      const data = await r.json();
      return res.status(200).json({success:true, content:data.choices?.[0]?.message?.content||''});
    } catch(e) { return res.status(500).json({error:e.message}); }
  }

  const { gameData, simulationData, statsContext, appContext, betType, nrfiProb, yrfiProb, backtestContext } = req.body||{};
  if (!gameData||!simulationData) return res.status(400).json({error:'Missing data'});

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({error:'GROQ_API_KEY not set'});

  const prompt = `Analyze this betting opportunity:

GAME: ${gameData.awayTeam} @ ${gameData.homeTeam} (${gameData.sport})
ODDS: Home ${gameData.homeOdds} (${gameData.homeImpliedProb}% implied) | Away ${gameData.awayOdds} (${gameData.awayImpliedProb}% implied)

MONTE CARLO SIMULATION (${simulationData.simulation?.simulations?.toLocaleString()||'10,000'} runs):
- ${gameData.homeTeam} win prob: ${simulationData.simulation?.homeWinProb}%
- ${gameData.awayTeam} win prob: ${simulationData.simulation?.awayWinProb}%
- Avg score: ${gameData.homeTeam} ${simulationData.simulation?.avgHomeScore} - ${gameData.awayTeam} ${simulationData.simulation?.avgAwayScore}
${simulationData.simulation?.topScorelines?.length?`- Top scorelines: ${simulationData.simulation.topScorelines.map(s=>`${s.score}(${s.probability}%)`).join(', ')}`:''}

EDGE ANALYSIS:
- ${gameData.homeTeam}: ${simulationData.analysis?.homeEdge>0?'+':''}${simulationData.analysis?.homeEdge}% edge | EV ${simulationData.analysis?.homeEV>0?'+':''}${simulationData.analysis?.homeEV}%
- ${gameData.awayTeam}: ${simulationData.analysis?.awayEdge>0?'+':''}${simulationData.analysis?.awayEdge}% edge | EV ${simulationData.analysis?.awayEV>0?'+':''}${simulationData.analysis?.awayEV}%
- Kelly: ${gameData.homeTeam} ${simulationData.analysis?.homeKelly?.halfKelly}% | ${gameData.awayTeam} ${simulationData.analysis?.awayKelly?.halfKelly}%

MODEL RECOMMENDATION: ${simulationData.recommendation} ${simulationData.recommendedSide||''}
${betType==='NRFI'&&nrfiProb?`
NRFI/YRFI ANALYSIS (focus on this):
- No Run First Inning probability: ${nrfiProb}%
- Yes Run First Inning probability: ${yrfiProb}%
- Starting pitchers are the KEY factor for NRFI
- Analyze: pitcher ERA, WHIP, first inning tendencies, lineup quality batting 1-3
- Recommend NRFI if prob >58% at -110 or better odds
- Recommend YRFI if prob >58% at -110 or better odds
- This is the PRIMARY bet to analyze, not the moneyline`:''}
${statsContext?'\nTEAM STATS & SITUATIONAL DATA:\n'+statsContext:''}
${appContext?'\nBETTOR PERFORMANCE PATTERNS:\n'+appContext:''}
${backtestContext?'\nBACKTEST RULES (must follow):\n'+backtestContext:''}

Return ONLY the JSON object.`;

  try {
    const r = await fetch(GROQ_API, {
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile',
        max_tokens:1500,
        temperature:0.1,
        messages:[
          {role:'system',content:SYSTEM_PROMPT},
          {role:'user',content:prompt}
        ],
      }),
    });

    if (!r.ok) return res.status(500).json({error:`Groq error: ${await r.text()}`});

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content||'';

    let analysis;
    try {
      analysis = JSON.parse(raw.trim());
    } catch {
      try {
        const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
        analysis = JSON.parse(cleaned);
      } catch {
        try {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) analysis = JSON.parse(match[0]);
        } catch {
          return res.status(200).json({success:false, raw, error:'Parse failed'});
        }
      }
    }

    return res.status(200).json({success:true, analysis, tokensUsed:data.usage?.total_tokens});
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
