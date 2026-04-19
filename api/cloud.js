const JSONBIN_KEY = '$2a$10$OgNCQZvgTz/DoMEzXLkBRu8m.1M0fsZT55WDrZxc5dnYU8WE/EV3u';
const JSONBIN_URL = 'https://api.jsonbin.io/v3/b';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { action, binId } = req.query;

  try {
    if (action==='save') {
      const data = req.body;
      let r;
      if (binId) {
        r = await fetch(`${JSONBIN_URL}/${binId}`, {
          method:'PUT',
          headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY},
          body:JSON.stringify(data),
        });
      } else {
        r = await fetch(JSONBIN_URL, {
          method:'POST',
          headers:{'Content-Type':'application/json','X-Master-Key':JSONBIN_KEY,'X-Bin-Name':'betlab-data'},
          body:JSON.stringify(data),
        });
      }
      const result = await r.json();
      return res.status(200).json({success:r.ok, ...result});
    }

    if (action==='load' && binId) {
      const r = await fetch(`${JSONBIN_URL}/${binId}/latest`, {
        headers:{'X-Master-Key':JSONBIN_KEY},
      });
      const result = await r.json();
      return res.status(200).json({success:r.ok, ...result});
    }

    return res.status(400).json({error:'Invalid action'});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
}
