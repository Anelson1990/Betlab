const JSONBLOB_URL = 'https://jsonblob.com/api/jsonBlob/019dea3d-883c-7c05-9b2c-1c9324c5d861';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const r = await fetch(JSONBLOB_URL, {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`JSONBlob error: ${r.status}`);
    const data = await r.json();
    return res.status(200).json({ success: true, ...data });
  } catch(err) {
    return res.status(200).json({ success: false, error: err.message, predictions: [] });
  }
}
