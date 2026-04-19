import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchOdds, callClaude } from './api.js';
import { SPORT_CONFIG, SPORTS, formatOddsForClaude } from './sportsMap.js';
import { loadState, persist, uid, americanToDecimal, impliedProb, formatMoney, formatOdds, EMPTY_STATE } from './state.js';

function StatBox({ label, value, color = '#e2e8f0' }) {
  return (
    <div style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid #1e293b', borderRadius: 10, padding: '14px 18px', textAlign: 'center', flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 22, fontFamily: "'Orbitron',sans-serif", color, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>{label}</div>
    </div>
  );
}

const RC = { pending: '#f59e0b', win: '#22c55e', loss: '#ef4444', push: '#94a3b8' };

function BetCard({ bet, onGrade, onTeach, teaching }) {
  const profit = bet.result === 'win' ? (americanToDecimal(bet.odds) - 1) * bet.stake : bet.result === 'loss' ? -bet.stake : 0;
  const col = RC[bet.result] || '#334155';
  return (
    <div style={{ background: 'rgba(10,18,35,0.9)', border: `1px solid ${col}44`, borderLeft: `3px solid ${col}`, borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 13, color: '#f1f5f9', fontWeight: 700 }}>{bet.pick}</span>
            <span style={{ fontSize: 9, background: '#1e293b', color: '#64748b', padding: '2px 6px', borderRadius: 20, textTransform: 'uppercase' }}>{bet.sport}</span>
            <span style={{ fontSize: 9, background: '#1e293b', color: '#64748b', padding: '2px 6px', borderRadius: 20 }}>{bet.betType}</span>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{bet.reasoning}</div>
          {bet.keyFactors?.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {bet.keyFactors.map((f, i) => (
                <span key={i} style={{ fontSize: 9, background: 'rgba(59,130,246,0.15)', color: '#60a5fa', padding: '2px 7px', borderRadius: 20, border: '1px solid rgba(59,130,246,0.2)' }}>{f}</span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>Confidence {bet.confidence}% · Implied {impliedProb(bet.odds).toFixed(1)}% · {new Date(bet.date).toLocaleDateString()}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 20, color: '#e2e8f0' }}>{formatOdds(bet.odds)}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>${bet.stake} stake</div>
          {bet.result !== 'pending' && <div style={{ fontSize: 14, fontWeight: 700, color: col, marginTop: 4 }}>{bet.result === 'push' ? 'PUSH' : formatMoney(profit)}</div>}
          {bet.result === 'pending' && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>PENDING</div>}
        </div>
      </div>
      {bet.result === 'pending' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {['win', 'loss', 'push'].map(r => (
            <button key={r} onClick={() => onGrade(bet.id, r)} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer', background: r === 'win' ? '#14532d' : r === 'loss' ? '#7f1d1d' : '#1e293b', color: r === 'win' ? '#86efac' : r === 'loss' ? '#fca5a5' : '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{r}</button>
          ))}
        </div>
      )}
      {bet.result !== 'pending' && !bet.lesson && (
        <button onClick={() => onTeach(bet.id)} disabled={teaching} style={{ marginTop: 10, width: '100%', padding: '7px 0', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: teaching ? '#334155' : '#60a5fa', fontSize: 11, fontWeight: 700, cursor: teaching ? 'not-allowed' : 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>
          {teaching ? 'Analyzing...' : '🎓 Analyze This Bet'}
        </button>
      )}
      {bet.lesson && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(30,41,59,0.6)', borderRadius: 8, border: '1px solid #1e40af44' }}>
          <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>🎓 AI LESSON</div>
          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>{bet.lesson}</div>
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson }) {
  return (
    <div style={{ background: 'rgba(10,18,35,0.9)', border: '1px solid #1e40af44', borderLeft: '3px solid #3b82f6', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{lesson.category}</span>
        <span style={{ fontSize: 10, color: '#475569' }}>{new Date(lesson.date).toLocaleDateString()}</span>
      </div>
      <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 12, color: '#e2e8f0', marginBottom: 6 }}>{lesson.title}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{lesson.body}</div>
      {lesson.takeaway && <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24', fontStyle: 'italic' }}>💡 {lesson.takeaway}</div>}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [pickSport, setPickSport] = useState('NHL');
  const [pickContext, setPickContext] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const [sportFilter, setSportFilter] = useState('All');
  const [editingBankroll, setEditingBankroll] = useState(false);
  const [bankrollInput, setBankrollInput] = useState('');
  const logEndRef = useRef(null);

  useEffect(() => { persist(state); }, [state]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [state.sessionLog]);

  const graded = state.bets.filter(b => b.result !== 'pending');
  const pending = state.bets.filter(b => b.result === 'pending');
  const wins = graded.filter(b => b.result === 'win');
  const totalStaked = graded.reduce((a, b) => a + b.stake, 0);
  const totalProfit = graded.reduce((acc, b) => {
    if (b.result === 'win') return acc + (americanToDecimal(b.odds) - 1) * b.stake;
    if (b.result === 'loss') return acc - b.stake;
    return acc;
  }, 0);
  const roi = totalStaked ? (totalProfit / totalStaked * 100) : 0;
  const winRate = graded.length ? (wins.length / graded.length * 100) : 0;

  function addLog(msg) {
    setState(s => ({ ...s, sessionLog: [...s.sessionLog.slice(-99), { id: uid(), msg, time: Date.now() }] }));
  }

  function saveBankroll() {
    const val = parseFloat(bankrollInput);
    if (!isNaN(val) && val > 0) {
      const r = parseFloat(val.toFixed(2));
      setState(s => ({ ...s, bankroll: r, startingBankroll: r }));
      addLog(`💰 Bankroll set to $${r.toFixed(2)}`);
    }
    setEditingBankroll(false);
  }

  const generatePicks = useCallback(async () => {
    setLoading(true);
    setError('');
    const cfg = SPORT_CONFIG[pickSport];
    addLog(`🔍 Fetching live ${pickSport} odds...`);
    setLoadingMsg('📡 Pulling live odds...');
    let oddsText = '';
    try {
      const games = await fetchOdds(cfg.oddsKey, cfg.markets);
      oddsText = formatOddsForClaude(games);
      addLog(`✅ Got odds for ${games.length} games`);
    } catch (err) {
      oddsText = 'Live odds unavailable — use your knowledge of today\'s games.';
      addLog(`⚠️ Odds fetch failed: ${err.message}`);
    }
    const stakeAmount = Math.max(10, Math.round(state.bankroll * 0.03 / 5) * 5);
    const systemPrompt = `You are a sharp sports bettor. You have real live odds below. Find 1-3 value bets where true probability beats implied odds. Use web search for injury/news context. Respond ONLY with a JSON array, no markdown. Each object must have: pick, sport, betType, odds (integer), reasoning, keyFactors (array), confidence (integer 55-80), edge. If no value exists return []. LIVE ODDS:\n${oddsText}\n${pickContext ? `Focus: ${pickContext}` : ''}`;
    setLoadingMsg('🧠 Finding value in the lines...');
    try {
      const raw = await callClaude(
        [{ role: 'user', content: `Today is ${new Date().toLocaleDateString()}. Review the live ${pickSport} odds, search for injury reports, return your best value bets as a JSON array.` }],
        systemPrompt, true
      );
      let picks = [];
      try {
        const s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const start = s.indexOf('[');
        if (start !== -1) {
          let depth = 0, inStr = false, esc = false, end = -1;
          for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (esc) { esc = false; continue; }
            if (c === '\\' && inStr) { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '[') depth++;
            else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end !== -1) picks = JSON.parse(s.slice(start, end + 1));
          else {
            const partial = s.slice(start);
            const lastClose = partial.lastIndexOf('}');
            if (lastClose !== -1) picks = JSON.parse(partial.slice(0, lastClose + 1) + ']');
          }
        }
      } catch (e) { throw new Error('Could not parse AI response: ' + e.message); }
      if (!Array.isArray(picks) || picks.length === 0) {
        addLog('No strong value found today. Try a different sport.');
        setLoadingMsg(''); setLoading(false); return;
      }
      const newBets = picks.map(p => ({
        id: uid(), pick: String(p.pick || 'Unknown'), sport: pickSport,
        betType: String(p.betType || 'Moneyline'), odds: parseInt(p.odds) || -110,
        stake: stakeAmount, result: 'pending', date: new Date().toISOString(),
        reasoning: String(p.reasoning || ''), keyFactors: Array.isArray(p.keyFactors) ? p.keyFactors.map(String) : [],
        confidence: parseInt(p.confidence) || 60, edge: String(p.edge || ''), lesson: null,
      }));
      const totalStake = newBets.reduce((a, b) => a + b.stake, 0);
      setState(s => ({ ...s, bankroll: parseFloat((s.bankroll - totalStake).toFixed(2)), bets: [...newBets, ...s.bets] }));
      addLog(`✅ Placed ${newBets.length} bet(s): ${newBets.map(b => b.pick).join(', ')}`);
      setTab('bets');
    } catch (err) { setError('Pick generation failed: ' + err.message); addLog('❌ ' + err.message); }
    setLoadingMsg(''); setLoading(false);
  }, [pickSport, pickContext, state.bankroll]);

  const gradeBet = useCallback((id, result) => {
    const bet = state.bets.find(b => b.id === id);
    if (!bet) return;
    const payout = result === 'win' ? americanToDecimal(bet.odds) * bet.stake : result === 'push' ? bet.stake : 0;
    const pl = result === 'win' ? (americanToDecimal(bet.odds) - 1) * bet.stake : result === 'loss' ? -bet.stake : 0;
    setState(s => ({ ...s, bankroll: parseFloat((s.bankroll + payout).toFixed(2)), bets: s.bets.map(b => b.id === id ? { ...b, result } : b) }));
    addLog(`Graded: ${bet.pick} → ${result.toUpperCase()} (${formatMoney(pl)})`);
  }, [state.bets]);

  const teachLesson = useCallback(async (betId) => {
    const bet = state.bets.find(b => b.id === betId);
    if (!bet) return;
    setTeaching(true);
    setLoadingMsg('🎓 Generating lesson...');
    const pl = bet.result === 'win' ? (americanToDecimal(bet.odds) - 1) * bet.stake : -bet.stake;
    try {
      const lesson = await callClaude(
        [{ role: 'user', content: `Analyze this ${bet.result} bet and teach me:\nPick: ${bet.pick} (${bet.sport}, ${bet.betType})\nOdds: ${formatOdds(bet.odds)} (implied ${impliedProb(bet.odds).toFixed(1)}%)\nReasoning: ${bet.reasoning}\nFactors: ${bet.keyFactors?.join(', ')}\nConfidence: ${bet.confidence}%\nResult: ${bet.result} (${formatMoney(pl)})\nWas the reasoning sound? What should a sharper bettor do differently? 3-4 sentences, be specific.` }],
        'You are a sharp sports betting coach. Be direct and educational. Plain text only.', false
      );
      const card = { id: uid(), date: new Date().toISOString(), title: `${bet.result === 'win' ? '✅' : '❌'} ${bet.pick}`, category: bet.sport, body: lesson, takeaway: null, betId };
      setState(s => ({ ...s, bets: s.bets.map(b => b.id === betId ? { ...b, lesson } : b), lessons: [card, ...s.lessons] }));
      addLog(`📘 Lesson generated for ${bet.pick}`);
    } catch (err) { setError('Lesson failed: ' + err.message); }
    setTeaching(false); setLoadingMsg('');
  }, [state.bets]);

  const runReview = useCallback(async () => {
    if (graded.length < 3) { setError('Need at least 3 graded bets.'); return; }
    setLoading(true); setLoadingMsg('📊 Running review...');
    const summary = graded.slice(0, 20).map(b => ({ pick: b.pick, sport: b.sport, odds: b.odds, confidence: b.confidence, result: b.result }));
    try {
      const raw = await callClaude(
        [{ role: 'user', content: `Review my ${graded.length} graded bets:\n${JSON.stringify(summary)}\nStats: WR ${winRate.toFixed(1)}%, ROI ${roi.toFixed(1)}%, Net ${formatMoney(totalProfit)}\nReturn ONLY this JSON: {"title":"...","category":"Performance Review","body":"3-4 sentence analysis","takeaway":"single most important improvement"}` }],
        'You are a professional betting analyst. Respond ONLY with a JSON object, no markdown.', false
      );
      let review = {};
      try {
        const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
        if (s !== -1 && e !== -1) review = JSON.parse(clean.slice(s, e + 1));
      } catch {}
      setState(s => ({ ...s, lessons: [{ id: uid(), date: new Date().toISOString(), title: review.title || 'Performance Review', category: review.category || 'Review', body: review.body || raw, takeaway: review.takeaway || null }, ...s.lessons] }));
      addLog('📊 Review complete — check Lessons'); setTab('lessons');
    } catch (err) { setError('Review failed: ' + err.message); }
    setLoading(false); setLoadingMsg('');
  }, [graded, winRate, roi, totalProfit]);

  const filteredBets = state.bets.filter(b => (sportFilter === 'All' || b.sport === sportFilter) && (resultFilter === 'all' || b.result === resultFilter));
  const resetAll = () => { if (!confirm('Reset ALL data?')) return; setState({ ...EMPTY_STATE }); };
  const TABS = ['dashboard', 'bets', 'lessons', 'log'];
  const TLABELS = { dashboard: '📊 Dashboard', bets: `🎯 Bets (${state.bets.length})`, lessons: `🎓 Lessons (${state.lessons.length})`, log: '📋 Log' };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#050810;font-family:'Rajdhani',sans-serif;color:#e2e8f0}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e40af;border-radius:4px}input,select,textarea,button{outline:none;font-family:'Rajdhani',sans-serif}@keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
      <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at top,#0a0f1e 0%,#050810 70%)', position: 'relative' }}>
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(30,64,175,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(30,64,175,.04) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px 60px' }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div style={{ fontSize: 10, color: '#1d4ed8', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 4 }}>AI Paper Betting Lab</div>
            <h1 style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 30, fontWeight: 900, color: '#f1f5f9', letterSpacing: 2 }}>BET<span style={{ color: '#1d4ed8' }}>LAB</span></h1>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>Real odds · AI picks · Real lessons</div>
          </div>
          <div style={{ background: 'rgba(10,18,35,0.95)', border: '1px solid #1e293b', borderRadius: 14, padding: '14px 20px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#475569', letterSpacing: 2, textTransform: 'uppercase' }}>Bankroll</div>
              {editingBankroll ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <input autoFocus type="number" value={bankrollInput} onChange={e => setBankrollInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveBankroll(); if (e.key === 'Escape') setEditingBankroll(false); }} style={{ width: 120, background: '#0f172a', border: '1px solid #1d4ed8', borderRadius: 6, color: '#f1f5f9', padding: '6px 10px', fontSize: 18, fontFamily: "'Orbitron',sans-serif" }} />
                  <button onClick={saveBankroll} style={{ background: '#1d4ed8', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>SET</button>
                  <button onClick={() => setEditingBankroll(false)} style={{ background: '#1e293b', border: 'none', borderRadius: 6, color: '#64748b', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 28, color: state.bankroll >= state.startingBankroll ? '#22c55e' : '#ef4444', fontWeight: 700 }}>${state.bankroll.toFixed(2)}</div>
                  <button onClick={() => { setBankrollInput(state.bankroll.toFixed(2)); setEditingBankroll(true); }} style={{ background: 'rgba(29,78,216,.15)', border: '1px solid #1d4ed844', borderRadius: 6, color: '#60a5fa', padding: '4px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>EDIT</button>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#475569' }}>started ${state.startingBankroll.toFixed(2)}</div>
              <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 18, color: totalProfit >= 0 ? '#22c55e' : '#ef4444' }}>{formatMoney(totalProfit)}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>ROI {roi.toFixed(1)}%</div>
            </div>
          </div>
          {error && <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#fca5a5', display: 'flex', justifyContent: 'space-between' }}>{error}<button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14 }}>✕</button></div>}
          {(loading || teaching) && <div style={{ background: 'rgba(10,18,35,0.95)', border: '1px solid #1d4ed8', borderRadius: 10, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#60a5fa', animation: 'pulse 1.5s infinite', display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: '50%', flexShrink: 0 }} />{loadingMsg || 'Working...'}</div>}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'rgba(10,18,35,0.8)', padding: 4, borderRadius: 10, border: '1px solid #1e293b' }}>
            {TABS.map(t => <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', background: tab === t ? '#1d4ed8' : 'transparent', color: tab === t ? '#fff' : '#64748b', fontSize: 11, fontWeight: 700, transition: 'all .2s' }}>{TLABELS[t]}</button>)}
          </div>
          {tab === 'dashboard' && (
            <div style={{ animation: 'slideIn .3s ease' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <StatBox label="Win Rate" value={graded.length ? winRate.toFixed(0) + '%' : '—'} color={winRate >= 52 ? '#22c55e' : winRate > 0 ? '#f59e0b' : '#64748b'} />
                <StatBox label="Graded" value={graded.length} />
                <StatBox label="Pending" value={pending.length} color="#f59e0b" />
                <StatBox label="Lessons" value={state.lessons.length} color="#60a5fa" />
              </div>
              <div style={{ background: 'rgba(10,18,35,0.95)', border: '1px solid #1e293b', borderRadius: 14, padding: 18, marginBottom: 14 }}>
                <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 11, color: '#1d4ed8', letterSpacing: 2, marginBottom: 14, textTransform: 'uppercase' }}>🎯 Generate AI Picks</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <select value={pickSport} onChange={e => setPickSport(e.target.value)} style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 13, cursor: 'pointer' }}>
                    {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={generatePicks} disabled={loading} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', background: loading ? '#1e293b' : 'linear-gradient(135deg,#1d4ed8,#2563eb)', color: loading ? '#475569' : '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Orbitron',sans-serif", letterSpacing: 1 }}>{loading ? 'WORKING...' : 'FIND VALUE'}</button>
                </div>
                <textarea value={pickContext} onChange={e => setPickContext(e.target.value)} placeholder="Optional focus: e.g. 'NHL road underdogs', 'NRFI picks'" style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, color: '#94a3b8', padding: '10px 12px', fontSize: 12, resize: 'none', height: 56, lineHeight: 1.5 }} />
                <div style={{ marginTop: 8, fontSize: 10, color: '#334155' }}>📡 Live odds from The Odds API · 🔍 Injuries via web search</div>
              </div>
              <button onClick={runReview} disabled={loading || graded.length < 3} style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: '1px solid #1e40af44', background: 'rgba(29,78,216,.1)', color: graded.length >= 3 ? '#60a5fa' : '#475569', fontSize: 12, fontWeight: 700, cursor: loading || graded.length < 3 ? 'not-allowed' : 'pointer', fontFamily: "'Orbitron',sans-serif", letterSpacing: 1, marginBottom: 14 }}>
                📊 PERFORMANCE REVIEW {graded.length < 3 ? `(${3 - graded.length} more bets needed)` : ''}
              </button>
              <div style={{ background: 'rgba(10,18,35,0.8)', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 10, color: '#334155', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>How Data Flows</div>
                {[['📡','The Odds API','Fetches real moneylines, spreads and totals'],['🔍','Web Search','Claude finds injury reports and lineup news'],['🧠','Claude AI','Finds spots where true probability beats implied odds'],['📊','You Grade','Mark results Win/Loss/Push after games'],['🎓','AI Teaches','Analyzes what it got right or wrong and why']].map(([icon,title,desc]) => (
                  <div key={title} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 16, flexShrink: 0 }}>{icon}</div>
                    <div><div style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 700 }}>{title}</div><div style={{ fontSize: 11, color: '#475569', lineHeight: 1.4 }}>{desc}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === 'bets' && (
            <div style={{ animation: 'slideIn .3s ease' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                <select value={resultFilter} onChange={e => setResultFilter(e.target.value)} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '7px 10px', fontSize: 11, cursor: 'pointer' }}>
                  {['all','pending','win','loss','push'].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
                </select>
                <select value={sportFilter} onChange={e => setSportFilter(e.target.value)} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '7px 10px', fontSize: 11, cursor: 'pointer' }}>
                  <option value="All">All Sports</option>
                  {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ marginLeft: 'auto', fontSize: 11, color: '#475569', alignSelf: 'center' }}>{filteredBets.length} bets</div>
              </div>
              {filteredBets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🎯</div>
                  <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 12, letterSpacing: 2 }}>NO BETS YET</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>Go to Dashboard → Find Value</div>
                </div>
              ) : filteredBets.map(bet => <BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} teaching={teaching} />)}
            </div>
          )}
          {tab === 'lessons' && (
            <div style={{ animation: 'slideIn .3s ease' }}>
              {state.lessons.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🎓</div>
                  <div style={{ fontFamily: "'Orbitron',sans-serif", fontSize: 12, letterSpacing: 2 }}>NO LESSONS YET</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>Grade bets → click Analyze This Bet</div>
                </div>
              ) : state.lessons.map(l => <LessonCard key={l.id} lesson={l} />)}
            </div>
          )}
          {tab === 'log' && (
            <div style={{ animation: 'slideIn .3s ease' }}>
              <div style={{ background: 'rgba(5,8,16,0.95)', border: '1px solid #1e293b', borderRadius: 12, padding: 14, fontFamily: 'monospace', fontSize: 11, color: '#64748b', maxHeight: 420, overflowY: 'auto' }}>
                {state.sessionLog.length === 0 ? <div style={{ color: '#334155', textAlign: 'center', padding: 20 }}>No activity yet.</div> : state.sessionLog.map(l => (
                  <div key={l.id} style={{ marginBottom: 4, color: l.msg.startsWith('✅') ? '#22c55e' : l.msg.startsWith('❌') ? '#ef4444' : l.msg.startsWith('⚠️') ? '#f59e0b' : '#64748b' }}>
                    <span style={{ color: '#1e40af' }}>[{new Date(l.time).toLocaleTimeString()}]</span> {l.msg}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
              <button onClick={resetAll} style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 8, background: 'transparent', border: '1px solid #7f1d1d', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>🗑 Reset All Data</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
