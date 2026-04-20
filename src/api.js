export async function fetchOdds(oddsKey, markets = 'h2h,spreads,totals') {
  const res = await fetch(`/api/odds?sport=${oddsKey}&markets=${markets}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Odds API error ${res.status}`);
  }
  return res.json();
}

export async function callClaude(messages, systemPrompt, useSearch = false) {
  // Try Claude first, fall back to Groq if credits are low
  try {
    const body = {
      model: useSearch ? 'claude-sonnet-4-5' : 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    };
    if (useSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error?.type === 'invalid_request_error' && data.error?.message?.includes('credit')) {
      throw new Error('credits_low');
    }
    if (!res.ok) throw new Error(data.error?.message || `API error ${res.status}`);
    return data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
  } catch(e) {
    if (e.message === 'credits_low' || e.message?.includes('credit')) {
      // Fall back to Groq
      const groqRes = await fetch('/api/analyze?mode=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, system: systemPrompt }),
      });
      const groqData = await groqRes.json();
      if (!groqData.success) throw new Error(groqData.error || 'Groq fallback failed');
      return groqData.content;
    }
    throw e;
  }
}

export function extractJSON(raw) {
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const arrStart = s.indexOf('[');
  const objStart = s.indexOf('{');
  const useArr = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
  const start = useArr ? arrStart : objStart;
  if (start === -1) throw new Error('No JSON structure in response');
  const open = s[start], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end !== -1) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  if (open === '[') {
    const partial = s.slice(start);
    const lastClose = partial.lastIndexOf('}');
    if (lastClose !== -1) {
      try { return JSON.parse(partial.slice(0, lastClose + 1) + ']'); } catch {}
    }
  }
  throw new Error('Could not parse JSON from response');
}

export async function callClaudeJSON(messages, systemPrompt, useSearch = false) {
  const raw = await callClaude(messages, systemPrompt, useSearch);
  return extractJSON(raw);
}
