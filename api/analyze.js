const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a sharp professional sports betting analyst with deep expertise in statistical analysis, Monte Carlo simulation, and sports betting markets.

Analyze ALL provided data including team stats, injuries, rest, recent form, simulation results, and the bettor's historical performance patterns.

Return ONLY a valid JSON object with no markdown, no explanation, no code blocks:
{"verdict":"BET","side":"NRFI or YRFI or team name","confidence":72,"edge_summary":"brief edge description","simulation_read":"what sims show","sharp_factors":"factors supporting bet","risk_factors":"risks","line_value":"line assessment","recommended_units":1.5,"full_analysis":"detailed 3-4 paragraph analysis covering stats, situational factors, sim results, and edge"}

If no edge: {"verdict":"PASS","side":null,"confidence":0,"edge_summary":"no edge found","simulation_read":"","sharp_factors":"","risk_factors":"","line_value":"","recommended_units":0,"full_analysis":"no value"}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { gameData, simulationData, statsContext, appContext, betType, nrfiProb, yrfiProb } = req.body||{};
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
