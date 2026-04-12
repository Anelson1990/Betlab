export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sport = 'americanfootball_nfl', markets = 'h2h' } = req.query;
  const key = process.env.ODDS_API_KEY;

  if (!key) return res.status(500).json({ error: 'ODDS_API_KEY not set' });

  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=us&markets=${markets}&oddsFormat=american&dateFormat=iso`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
