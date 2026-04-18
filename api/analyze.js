const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a sharp sports betting analyst. Analyze the data and return ONLY a JSON object with no markdown, no explanation, no code blocks.

Required format:
{"verdict":"BET","side":"team name","confidence":72,"edge_summary":"brief edge description","simulation_read":"what sims show","sharp_factors":"factors supporting bet","risk_factors":"risks","line_value":"line assessment","recommended_units":1.5,"full_analysis":"detailed analysis paragraph"}

If no edge: {"verdict":"PASS","side":null,"confidence":0,"edge_summary":"no edge found","simulation_read":"","sharp_factors":"","risk_factors":"","line_value":"","recommended_units":0,"full_analysis":"no value"}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { gameData, simulationData } = req.body||{};
  if (!gameData||!simulationData) return res.status(400).json({error:'Missing data'});

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({error:'GROQ_API_KEY not set'});

  const prompt = `Analyze: ${gameData.awayTeam} @ ${gameData.homeTeam} (${gameData.sport})
Odds: Home ${gameData.homeOdds} (${gameData.homeImpliedProb}% implied) | Away ${gameData.awayOdds} (${gameData.awayImpliedProb}% implied)
Simulation (${simulationData.simulation?.simulations||10000} runs): Home ${simulationData.simulation?.homeWinProb}% | Away ${simulationData.simulation?.awayWinProb}%
Edge: Home ${simulationData.analysis?.homeEdge}% | Away ${simulationData.analysis?.awayEdge}%
EV: Home ${simulationData.analysis?.homeEV}% | Away ${simulationData.analysis?.awayEV}%
Model says: ${simulationData.recommendation} ${simulationData.recommendedSide||''}

Return ONLY the JSON object, nothing else.`;

  try {
    const r = await fetch(GROQ_API, {
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile',
        max_tokens:1000,
        temperature:0.1,
        messages:[
          {role:'system',content:SYSTEM_PROMPT},
          {role:'user',content:prompt}
        ],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({error:`Groq error: ${err}`});
    }

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content||'';

    // Try multiple parse strategies
    let analysis;
    try {
      // Direct parse
      analysis = JSON.parse(raw.trim());
    } catch {
      try {
        // Strip markdown
        const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
        analysis = JSON.parse(cleaned);
      } catch {
        try {
          // Extract JSON object
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) analysis = JSON.parse(match[0]);
        } catch {
          // Return raw for debugging
          return res.status(200).json({success:false, raw, error:'Parse failed'});
        }
      }
    }

    return res.status(200).json({success:true, analysis});
  } catch(err) {
    return res.status(500).json({success:false, error:err.message});
  }
}
