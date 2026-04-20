const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({error:'GROQ_API_KEY not set'});

  const { messages, system, max_tokens=2000 } = req.body||{};
  if (!messages) return res.status(400).json({error:'Missing messages'});

  try {
    const r = await fetch(GROQ_API, {
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'llama-3.3-70b-versatile',
        max_tokens,
        messages:[
          ...(system?[{role:'system',content:system}]:[]),
          ...messages,
        ],
      }),
    });
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content||'';
    return res.status(200).json({success:true, content:text});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
}
