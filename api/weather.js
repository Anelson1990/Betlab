export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { city, sport } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });

  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'BetLab/1.0' } });
    if (!r.ok) throw new Error(`Weather fetch failed: ${r.status}`);
    const data = await r.json();
    const current = data.current_condition?.[0];
    const temp_f = parseFloat(current?.temp_F || 70);
    const wind_mph = parseFloat(current?.windspeedMiles || 0);
    const humidity = parseFloat(current?.humidity || 50);
    const desc = current?.weatherDesc?.[0]?.value || '';
    const is_rain = /rain|shower|drizzle/i.test(desc);
    const is_snow = /snow|blizzard/i.test(desc);
    const is_dome = ['ATL','DAL','DET','HOU','IND','LV','LAR','LAC','MIN','NO','NYG','NYJ','SEA','ARI'].includes(req.query.team||'');

    let nrfi_adj = 0, total_adj = 0, notes = [];

    if (sport === 'MLB') {
      if (wind_mph > 15) { nrfi_adj -= 0.02; total_adj += 0.3; notes.push(`Wind ${wind_mph}mph — hitter friendly`); }
      if (wind_mph > 20) { nrfi_adj -= 0.01; total_adj += 0.2; notes.push('High wind increases variance'); }
      if (temp_f < 50) { nrfi_adj += 0.01; total_adj -= 0.3; notes.push(`Cold ${temp_f}°F — suppresses offense`); }
      if (temp_f > 85) { total_adj += 0.2; notes.push(`Hot ${temp_f}°F — ball carries`); }
      if (is_rain) { nrfi_adj += 0.02; total_adj -= 0.3; notes.push('Rain — favors pitchers'); }
    }

    if (sport === 'NFL') {
      if (wind_mph > 15 && !is_dome) { total_adj -= 1.5; notes.push(`Wind ${wind_mph}mph — avoid totals, passing game limited`); }
      if (wind_mph > 25 && !is_dome) { total_adj -= 2.5; notes.push('High wind — strong under lean'); }
      if (temp_f < 32 && !is_dome) { total_adj -= 1.0; notes.push(`Freezing ${temp_f}°F — under lean`); }
      if (is_rain && !is_dome) { total_adj -= 1.0; notes.push('Rain — under lean, run game favored'); }
      if (is_snow && !is_dome) { total_adj -= 2.0; notes.push('Snow — strong under lean'); }
      if (is_dome) notes.push('Dome — weather neutral');
    }

    res.status(200).json({
      temp_f, wind_mph, humidity, desc, is_rain, is_snow, is_dome,
      nrfi_adj, total_adj,
      notes, source: 'wttr.in',
      city, sport,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
