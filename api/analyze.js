const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a sharp professional sports betting analyst. Analyze Monte Carlo simulation data and give a data-driven betting recommendation.

Return ONLY valid JSON with this exact format:
{
  "verdict": "BET" or "PASS",
  "side": "team name or null",
  "confidence": number 1-100,
  "edge_summary": "1-2 sentence summary of the edge",
  "simulation_read": "what the Monte Carlo numbers tell us",
  "sharp_factors": "situational factors supporting the bet",
  "risk_factors": "what could go wrong",
  "line_value": "assessment of current line price",
  "recommended_units": number 0-3,
  "full_analysis": "3-4 paragraph detailed analysis"
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { gameData, simulationData } = req.body||{};
  if (!gameData||!simulationData) return res.status(400).json({error:'Missing data'});

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({error:'GROQ_API_KEY not set'});

  const prompt = `Analyze this betting opportunity:

GAME: ${gameData.awayTeam} @ ${gameData.homeTeam}
SPORT: ${gameData.sport}

MARKET ODDS:
- ${gameData.homeTeam}: ${gameData.homeOdds} (implied ${gameData.homeImpliedProb}%)
- ${gameData.awayTeam}: ${gameData.awayOdds} (implied ${gameData.awayImpliedProb}%)

MONTE CARLO (${simulationData.simulation?.simulations?.toLocaleString()} runs):
- ${gameData.homeTeam} win prob: ${simulationData.simulation?.homeWinProb}%
- ${gameData.awayTeam} win prob: ${simulationData.simulation?.awayWinProb}%
- Avg score: ${gameData.homeTeam} ${simulationData.simulation?.avgHomeScore} - ${gameData.awayTeam} ${simulationData.simulation?.avgAwayScore}
${simulationData.simulation?.topScorelines?.length?`- Top scorelines: ${simulationData.simulation.topScorelines.map(s=>`${s.score}(${s.probability}%)`).join(', ')}`:''}

EDGE:
- ${gameData.homeTeam}: ${simulationData.analysis?.homeEdge>0?'+':''}${simulationData.analysis?.homeEdge}% edge, EV ${simulationData.analysis?.homeEV>0?'+':''}${simulationData.analysis?.homeEV}%
- ${gameData.awayTeam}: ${simulationData.analysis?.awayEdge>0?'+':''}${simulationData.analysis?.awayEdge}% edge, EV ${simulationData.analysis?.awayEV>0?'+':''}${simulationData.analysis?.awayEV}%

KELLY: ${gameData.homeTeam} half=${simulationData.analysis?.homeKelly?.halfKelly}% | ${gameData.awayTeam} half=${simulationData.analysis?.awayKelly?.halfKelly}%

MODEL SAYS: ${simulationData.recommendation} ${simulationData.recommendedSide?`(${simulationData.recommendedSide})`:''}

Provide sharp analysis. Return ONLY valid JSON.`;

  try {
    const r = await fetch(GROQ_API, {
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile',
        max_tokens:2000,
        temperature:0.3,
        messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}],
      }),
    });
    if (!r.ok) return res.status(500).json({error:`Groq error: ${await r.text()}`});
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content||'';
    let analysis;
    try {
      analysis = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());
    } catch {
      analysis = {full_analysis:raw,verdict:'PARSE_ERROR'};
    }
    res.status(200).json({success:true,analysis,tokensUsed:data.usage?.total_tokens});
  } catch(err) {
    res.status(500).json({success:false,error:err.message});
  }
}
