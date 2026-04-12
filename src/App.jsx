// src/App.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchOdds, callClaude } from './api.js';
import { SPORT_CONFIG, SPORTS, formatOddsForClaude } from './sportsMap.js';
import {
  loadState, persist, uid,
  americanToDecimal, impliedProb, formatMoney, formatOdds,
  EMPTY_STATE,
} from './state.js';

const RC = { pending:'#f59e0b', win:'#22c55e', loss:'#ef4444', push:'#94a3b8' };

const SPORT_COLORS = {
  NHL:{ accent:'#38bdf8', dim:'rgba(56,189,248,0.1)',  border:'rgba(56,189,248,0.25)' },
  MLB:{ accent:'#f97316', dim:'rgba(249,115,22,0.1)',  border:'rgba(249,115,22,0.25)' },
  NBA:{ accent:'#a78bfa', dim:'rgba(167,139,250,0.1)', border:'rgba(167,139,250,0.25)' },
  NFL:{ accent:'#22c55e', dim:'rgba(34,197,94,0.1)',   border:'rgba(34,197,94,0.25)'  },
};

const SPORT_HINTS = {
  NHL:'Paste your nhl_v11.py terminal output here — predictions, edge tiers, Kelly sizing...',
  MLB:'Paste your mlb_nrfi_v7.py terminal output here — NRFI%, ratings, top plays...',
  NBA:'Paste any NBA model output here — picks, odds, edge, reasoning...',
  NFL:'Paste any NFL model output here — picks, odds, edge, reasoning...',
};

function StatBox({ label, value, color='#e2e8f0' }) {
  return (
    <div style={{background:'rgba(15,23,42,0.8)',border:'1px solid #1e293b',borderRadius:10,padding:'14px 18px',textAlign:'center',flex:1,minWidth:80}}>
      <div style={{fontSize:22,fontFamily:"'Orbitron',sans-serif",color,fontWeight:700}}>{value}</div>
      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:1,marginTop:2}}>{label}</div>
    </div>
  );
}

function BetCard({ bet, onGrade, onTeach, teaching }) {
  const profit = bet.result==='win'?(americanToDecimal(bet.odds)-1)*bet.stake:bet.result==='loss'?-bet.stake:0;
  const col = RC[bet.result]||'#334155';
  return (
    <div style={{background:'rgba(10,18,35,0.9)',border:`1px solid ${col}44`,borderLeft:`3px solid ${col}`,borderRadius:10,padding:'14px 16px',marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:4}}>
            <span style={{fontFamily:"'Orbitron',sans-serif",fontSize:13,color:'#f1f5f9',fontWeight:700}}>{bet.pick}</span>
            <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20,textTransform:'uppercase'}}>{bet.sport}</span>
            <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20}}>{bet.betType}</span>
          </div>
          <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.5}}>{bet.reasoning}</div>
          {bet.keyFactors?.length>0&&(
            <div style={{marginTop:6,display:'flex',gap:4,flexWrap:'wrap'}}>
              {bet.keyFactors.map((f,i)=><span key={i} style={{fontSize:9,background:'rgba(59,130,246,0.15)',color:'#60a5fa',padding:'2px 7px',borderRadius:20,border:'1px solid rgba(59,130,246,0.2)'}}>{f}</span>)}
            </div>
          )}
          <div style={{fontSize:10,color:'#475569',marginTop:6}}>
            Conf {bet.confidence}% · Implied {impliedProb(bet.odds).toFixed(1)}% · {new Date(bet.date).toLocaleDateString()}
            {bet.modelProb?` · Model: ${bet.modelProb}%`:''}
          </div>
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:'#e2e8f0'}}>{formatOdds(bet.odds)}</div>
          <div style={{fontSize:11,color:'#64748b'}}>${bet.stake} stake</div>
          {bet.result!=='pending'&&<div style={{fontSize:14,fontWeight:700,color:col,marginTop:4}}>{bet.result==='push'?'PUSH':formatMoney(profit)}</div>}
          {bet.result==='pending'&&<div style={{fontSize:10,color:'#f59e0b',marginTop:4}}>PENDING</div>}
        </div>
      </div>
      {bet.result==='pending'&&(
        <div style={{display:'flex',gap:6,marginTop:10}}>
          {['win','loss','push'].map(r=>(
            <button key={r} onClick={()=>onGrade(bet.id,r)} style={{flex:1,padding:'7px 0',borderRadius:6,border:'none',cursor:'pointer',background:r==='win'?'#14532d':r==='loss'?'#7f1d1d':'#1e293b',color:r==='win'?'#86efac':r==='loss'?'#fca5a5':'#94a3b8',fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>{r}</button>
          ))}
        </div>
      )}
      {bet.result!=='pending'&&!bet.lesson&&bet.source==='ai'&&(
        <button onClick={()=>onTeach(bet.id)} disabled={teaching} style={{marginTop:10,width:'100%',padding:'7px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:teaching?'#334155':'#60a5fa',fontSize:11,fontWeight:700,cursor:teaching?'not-allowed':'pointer',letterSpacing:1,textTransform:'uppercase'}}>
          🎓 {teaching?'Analyzing...':'Analyze This Bet'}
        </button>
      )}
      {bet.lesson&&(
        <div style={{marginTop:10,padding:'10px 12px',background:'rgba(30,41,59,0.6)',borderRadius:8,border:'1px solid #1e40af44'}}>
          <div style={{fontSize:10,color:'#3b82f6',fontWeight:700,letterSpacing:1,marginBottom:4}}>🎓 AI LESSON</div>
          <div style={{fontSize:12,color:'#cbd5e1',lineHeight:1.6}}>{bet.lesson}</div>
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson }) {
  return (
    <div style={{background:'rgba(10,18,35,0.9)',border:'1px solid #1e40af44',borderLeft:'3px solid #3b82f6',borderRadius:10,padding:'14px 16px',marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
        <span style={{fontSize:10,color:'#3b82f6',fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>{lesson.category}</span>
        <span style={{fontSize:10,color:'#475569'}}>{new Date(lesson.date).toLocaleDateString()}</span>
      </div>
      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,color:'#e2e8f0',marginBottom:6}}>{lesson.title}</div>
      <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6}}>{lesson.body}</div>
      {lesson.takeaway&&<div style={{marginTop:8,fontSize:12,color:'#fbbf24',fontStyle:'italic'}}>💡 {lesson.takeaway}</div>}
    </div>
  );
}

function ROIComparison({ bets, bankroll, startingBankroll, myBankroll, myStartingBankroll }) {
  const aiBets=bets.filter(b=>b.source==='ai'&&b.result!=='pending');
  const myBets=bets.filter(b=>b.source==='paste'&&b.result!=='pending');
  function calcStats(s) {
    if (!s.length) return null;
    const wins=s.filter(b=>b.result==='win').length;
    const staked=s.reduce((a,b)=>a+b.stake,0);
    const profit=s.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
    return {wins,total:s.length,wr:wins/s.length*100,roi:staked?profit/staked*100:0};
  }
  const ai=calcStats(aiBets),my=calcStats(myBets);
  const roiC=v=>v>5?'#22c55e':v>0?'#86efac':v>-5?'#fbbf24':'#f87171';
  const aiPnL=bankroll-startingBankroll, myPnL=myBankroll-myStartingBankroll;
  return (
    <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#1d4ed8',letterSpacing:2,marginBottom:14,textTransform:'uppercase'}}>📊 Head to Head</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={{borderRight:'1px solid #1e293b',paddingRight:12}}>
          <div style={{fontSize:10,color:'#60a5fa',letterSpacing:2,marginBottom:6,fontWeight:700}}>🤖 AI PAPER BETS</div>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:24,color:aiPnL>=0?'#22c55e':'#ef4444',fontWeight:700}}>{aiPnL>=0?'+':''}{formatMoney(Math.abs(aiPnL))}</div>
          <div style={{fontSize:10,color:'#475569',marginBottom:6}}>vs ${startingBankroll.toFixed(0)} start</div>
          {ai?<><div style={{fontSize:12,color:roiC(ai.roi),fontWeight:700}}>ROI {ai.roi>=0?'+':''}{ai.roi.toFixed(1)}%</div><div style={{fontSize:11,color:'#64748b'}}>{ai.wins}W-{ai.total-ai.wins}L · {ai.wr.toFixed(0)}% WR</div></>:<div style={{fontSize:11,color:'#334155'}}>No graded picks yet</div>}
        </div>
        <div style={{paddingLeft:12}}>
          <div style={{fontSize:10,color:'#f97316',letterSpacing:2,marginBottom:6,fontWeight:700}}>📋 MY SCRIPTS</div>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:24,color:myPnL>=0?'#22c55e':'#ef4444',fontWeight:700}}>{myPnL>=0?'+':''}{formatMoney(Math.abs(myPnL))}</div>
          <div style={{fontSize:10,color:'#475569',marginBottom:6}}>vs ${myStartingBankroll.toFixed(0)} start</div>
          {my?<><div style={{fontSize:12,color:roiC(my.roi),fontWeight:700}}>ROI {my.roi>=0?'+':''}{my.roi.toFixed(1)}%</div><div style={{fontSize:11,color:'#64748b'}}>{my.wins}W-{my.total-my.wins}L · {my.wr.toFixed(0)}% WR</div></>:<div style={{fontSize:11,color:'#334155'}}>No graded picks yet</div>}
        </div>
      </div>
      {ai&&my&&(
        <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #1e293b',fontSize:12,fontWeight:700,textAlign:'center',color:ai.roi>my.roi?'#60a5fa':my.roi>ai.roi?'#f97316':'#64748b'}}>
          {ai.roi>my.roi?`🤖 AI leading by ${(ai.roi-my.roi).toFixed(1)}% ROI`:my.roi>ai.roi?`📋 Your scripts leading by ${(my.roi-ai.roi).toFixed(1)}% ROI`:'⚖️ Dead even'}
        </div>
      )}
    </div>
  );
}

function PasteTab({ onConfirmPicks, callClaude: claudeFn }) {
  const [activeSport, setActiveSport] = useState('NHL');
  const [pastes, setPastes] = useState({ NHL:'', MLB:'', NBA:'', NFL:'' });
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [stake, setStake] = useState(25);
  const sc = SPORT_COLORS[activeSport];

  const parse = async () => {
    const text = pastes[activeSport].trim();
    if (!text) { setError('Paste your model output first.'); return; }
    setParsing(true); setError(''); setPreview(null);
    const systemPrompt = `You are parsing raw terminal output from a sports prediction model.
Extract every distinct bet recommendation and return a JSON array.
Each object must have exactly:
  pick       - string: short description e.g. "NYY @ BOS — NRFI" or "BOS ML"
  betType    - string: "NRFI","YRFI","Moneyline","Spread","Total","Player Prop"
  odds       - integer: American odds. If not stated use -110.
  modelProb  - number: model probability as percentage e.g. 57.3. null if not found.
  confidence - integer 55-85: strength of model signal
  reasoning  - string: 1-2 sentences from the output explaining why
  keyFactors - array of 3-5 short strings: stats, edge tier, pitcher info etc
  rating     - string: model rating label if present e.g. "STRONG NRFI", "T1_STRONG"
Rules:
- Only include bets the model explicitly recommends — no SKIPs, no NO EDGE
- Prioritize TOP PLAYS section if present
- Return [] if no actionable picks
- Respond ONLY with a JSON array, no markdown`;
    try {
      const raw = await claudeFn(
        [{role:'user',content:`Sport: ${activeSport}\n\nModel output:\n${text.slice(0,8000)}`}],
        systemPrompt, false
      );
      let picks=[];
      const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const start=clean.indexOf('['),end=clean.lastIndexOf(']');
      if (start!==-1&&end!==-1) picks=JSON.parse(clean.slice(start,end+1));
      if (!Array.isArray(picks)||picks.length===0) {
        setError('No actionable picks found. Make sure you pasted the full output including TOP PLAYS or recommendations.');
      } else {
        setPreview({sport:activeSport,picks});
      }
    } catch(e) { setError('Parse failed: '+e.message); }
    setParsing(false);
  };

  const confirm = () => {
    if (!preview) return;
    onConfirmPicks(preview.picks, preview.sport, stake);
    setPreview(null);
    setPastes(p=>({...p,[activeSport]:''}));
  };

  const inp = extra=>({background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13,fontFamily:"'Rajdhani',sans-serif",...extra});
  const lbl = {fontSize:10,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4};

  return (
    <div style={{animation:'slideIn .3s ease'}}>
      <div style={{display:'flex',gap:4,marginBottom:14,background:'rgba(10,18,35,0.8)',padding:4,borderRadius:10,border:'1px solid #1e293b'}}>
        {['NHL','MLB','NBA','NFL'].map(s=>{
          const c=SPORT_COLORS[s];
          return (
            <button key={s} onClick={()=>{setActiveSport(s);setPreview(null);setError('');}} style={{flex:1,padding:'8px 0',borderRadius:7,border:'none',cursor:'pointer',background:activeSport===s?c.dim:'transparent',color:activeSport===s?c.accent:'#64748b',fontSize:12,fontWeight:700,letterSpacing:1,transition:'all .2s',boxShadow:activeSport===s?`inset 0 0 0 1px ${c.border}`:'none'}}>{s}</button>
          );
        })}
      </div>

      <div style={{background:'rgba(10,18,35,0.95)',border:`1px solid ${sc.border}`,borderRadius:14,padding:18,marginBottom:14}}>
        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:sc.accent,letterSpacing:2,marginBottom:12}}>
          PASTE {activeSport} MODEL OUTPUT
        </div>
        <textarea
          value={pastes[activeSport]}
          onChange={e=>setPastes(p=>({...p,[activeSport]:e.target.value}))}
          placeholder={SPORT_HINTS[activeSport]}
          style={{...inp({width:'100%',resize:'vertical',minHeight:180,lineHeight:1.6,fontSize:12,color:'#64748b'})}}
        />
        <div style={{display:'flex',gap:8,marginTop:12,alignItems:'flex-end'}}>
          <div style={{flex:1}}>
            <div style={lbl}>DEFAULT STAKE $</div>
            <input type="number" value={stake} onChange={e=>setStake(+e.target.value)} style={{...inp({width:'100%'})}}/>
          </div>
          <button onClick={parse} disabled={parsing||!pastes[activeSport].trim()} style={{flex:2,padding:'12px 0',borderRadius:8,border:'none',cursor:parsing||!pastes[activeSport].trim()?'not-allowed':'pointer',background:parsing||!pastes[activeSport].trim()?'#1e293b':`linear-gradient(135deg,${sc.accent}cc,${sc.accent})`,color:parsing||!pastes[activeSport].trim()?'#475569':'#000',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
            {parsing?'PARSING...':'🧠 PARSE OUTPUT'}
          </button>
        </div>
        {error&&<div style={{marginTop:10,padding:'10px 12px',background:'rgba(127,29,29,0.4)',borderRadius:8,border:'1px solid #ef444444',fontSize:12,color:'#fca5a5'}}>{error}</div>}
      </div>

      {preview&&(
        <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#22c55e',letterSpacing:2,marginBottom:14}}>
            ✅ {preview.picks.length} PICK{preview.picks.length!==1?'S':''} FOUND — REVIEW & CONFIRM
          </div>
          {preview.picks.map((pick,i)=>(
            <div key={i} style={{background:'rgba(5,8,16,0.8)',border:`1px solid ${SPORT_COLORS[preview.sport].border}`,borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
                <div>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:13,color:'#f1f5f9',fontWeight:700,marginBottom:4}}>{pick.pick}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20}}>{pick.betType}</span>
                    {pick.rating&&<span style={{fontSize:9,background:'rgba(34,197,94,0.15)',color:'#22c55e',padding:'2px 6px',borderRadius:20,border:'1px solid rgba(34,197,94,0.25)'}}>{pick.rating}</span>}
                  </div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#e2e8f0'}}>{pick.odds>0?'+':''}{pick.odds}</div>
                  {pick.modelProb&&<div style={{fontSize:11,color:SPORT_COLORS[preview.sport].accent}}>Model: {pick.modelProb}%</div>}
                  <div style={{fontSize:11,color:'#475569'}}>Conf: {pick.confidence}%</div>
                </div>
              </div>
              <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.5,marginBottom:8}}>{pick.reasoning}</div>
              {pick.keyFactors?.length>0&&(
                <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                  {pick.keyFactors.map((f,j)=><span key={j} style={{fontSize:9,background:'rgba(59,130,246,0.15)',color:'#60a5fa',padding:'2px 7px',borderRadius:20,border:'1px solid rgba(59,130,246,0.2)'}}>{f}</span>)}
                </div>
              )}
              <div style={{marginTop:8,fontSize:10,color:'#334155'}}>Stake: ${stake} · logs to MY SCRIPTS bankroll</div>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={confirm} style={{flex:2,padding:'12px 0',borderRadius:8,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#000',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
              ✅ LOG TO MY SCRIPTS TRACKER
            </button>
            <button onClick={()=>setPreview(null)} style={{flex:1,padding:'12px 0',borderRadius:8,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:12,fontWeight:700,cursor:'pointer'}}>DISCARD</button>
          </div>
        </div>
      )}

      {!preview&&(
        <div style={{background:'rgba(10,18,35,0.8)',border:'1px solid #1e293b',borderRadius:12,padding:'16px 18px'}}>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:10,color:'#334155',letterSpacing:2,marginBottom:12,textTransform:'uppercase'}}>How It Works</div>
          {[
            ['1','Run your Python script in Termux','python mlb_nrfi_v7.py  or  python nhl_v11.py'],
            ['2','Copy the full terminal output','Long-press → Select All → Copy'],
            ['3','Pick the sport tab above','NHL · MLB · NBA · NFL'],
            ['4','Paste and hit Parse','AI extracts picks with odds, confidence & reasoning'],
            ['5','Review then confirm','Picks log into YOUR SCRIPTS bankroll'],
            ['6','Check Dashboard','See your scripts vs AI head to head'],
          ].map(([n,title,desc])=>(
            <div key={n} style={{display:'flex',gap:12,marginBottom:10,alignItems:'flex-start'}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'rgba(249,115,22,0.15)',border:'1px solid rgba(249,115,22,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#f97316',fontWeight:700,flexShrink:0}}>{n}</div>
              <div>
                <div style={{fontSize:12,color:'#e2e8f0',fontWeight:700}}>{title}</div>
                <div style={{fontSize:11,color:'#475569',fontFamily:'monospace',marginTop:2}}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
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
  const [aiFilter, setAiFilter] = useState('all');
  const [myFilter, setMyFilter] = useState('all');
  const [editingBankroll, setEditingBankroll] = useState(false);
  const [bankrollInput, setBankrollInput] = useState('');
  const [editingMyBankroll, setEditingMyBankroll] = useState(false);
  const [myBankrollInput, setMyBankrollInput] = useState('');
  const logEndRef = useRef(null);

  useEffect(()=>{ persist(state); },[state]);
  useEffect(()=>{ logEndRef.current?.scrollIntoView({behavior:'smooth'}); },[state.sessionLog]);

  const aiBets   = state.bets.filter(b=>b.source==='ai');
  const myBets   = state.bets.filter(b=>b.source==='paste');
  const aiGraded = aiBets.filter(b=>b.result!=='pending');
  const myGraded = myBets.filter(b=>b.result!=='pending');

  const calcROI = (graded) => {
    const wins=graded.filter(b=>b.result==='win');
    const staked=graded.reduce((a,b)=>a+b.stake,0);
    const profit=graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
    return { wins:wins.length, total:graded.length, staked, profit, roi:staked?profit/staked*100:0, wr:graded.length?wins.length/graded.length*100:0 };
  };
  const aiStats = calcROI(aiGraded);
  const myStats = calcROI(myGraded);

  function addLog(msg) {
    setState(s=>({...s,sessionLog:[...s.sessionLog.slice(-99),{id:uid(),msg,time:Date.now()}]}));
  }

  function saveBankroll() {
    const val=parseFloat(bankrollInput);
    if (!isNaN(val)&&val>0) {
      const r=parseFloat(val.toFixed(2));
      setState(s=>({...s,bankroll:r,startingBankroll:r}));
      addLog(`💰 AI bankroll set to $${r.toFixed(2)}`);
    }
    setEditingBankroll(false);
  }
  function saveMyBankroll() {
    const val=parseFloat(myBankrollInput);
    if (!isNaN(val)&&val>0) {
      const r=parseFloat(val.toFixed(2));
      setState(s=>({...s,myBankroll:r,myStartingBankroll:r}));
      addLog(`💰 My bankroll set to $${r.toFixed(2)}`);
    }
    setEditingMyBankroll(false);
  }

  const addAIPick = useCallback((pickData) => {
    const bet={
      id:uid(), pick:pickData.pick||'Unknown', sport:pickData.sport||'NHL',
      betType:pickData.betType||'Moneyline', odds:parseInt(pickData.odds)||-110,
      stake:pickData.stake||25, result:'pending', date:new Date().toISOString(),
      reasoning:pickData.reasoning||'', keyFactors:pickData.keyFactors||[],
      confidence:pickData.confidence||60, edge:pickData.edge||'',
      modelProb:pickData.modelProb||null, lesson:null, source:'ai',
    };
    setState(s=>({...s,bankroll:parseFloat((s.bankroll-bet.stake).toFixed(2)),bets:[bet,...s.bets]}));
    addLog(`🤖 AI pick: ${bet.pick}`);
  },[]);

  const addMyPick = useCallback((pickData) => {
    const bet={
      id:uid(), pick:pickData.pick||'Unknown', sport:pickData.sport||'NHL',
      betType:pickData.betType||'Moneyline', odds:parseInt(pickData.odds)||-110,
      stake:pickData.stake||25, result:'pending', date:new Date().toISOString(),
      reasoning:pickData.reasoning||'', keyFactors:pickData.keyFactors||[],
      confidence:pickData.confidence||60, modelProb:pickData.modelProb||null,
      rating:pickData.rating||'', lesson:null, source:'paste',
    };
    setState(s=>({...s,myBankroll:parseFloat((s.myBankroll-bet.stake).toFixed(2)),bets:[bet,...s.bets]}));
    addLog(`📋 My pick: ${bet.pick}`);
  },[]);

  const confirmPicks = useCallback((picks, sport, stake) => {
    picks.forEach(p=>addMyPick({
      pick:p.pick, sport, betType:p.betType||'Moneyline',
      odds:parseInt(p.odds)||-110, stake,
      confidence:p.confidence||60, reasoning:p.reasoning||'',
      keyFactors:p.keyFactors||[], modelProb:p.modelProb||null, rating:p.rating||'',
    }));
    addLog(`📋 Logged ${picks.length} ${sport} pick(s) from script output`);
    setTab('mine');
  },[addMyPick]);

  const generatePicks = useCallback(async () => {
    setLoading(true); setError('');
    const cfg=SPORT_CONFIG[pickSport];
    addLog(`🔍 Fetching live ${pickSport} odds...`);
    setLoadingMsg('📡 Pulling live odds...');
    let oddsText='';
    try {
      const games=await fetchOdds(cfg.oddsKey,cfg.markets);
      oddsText=formatOddsForClaude(games);
      addLog(`✅ Got odds for ${games.length} games`);
    } catch(err) {
      oddsText="Live odds unavailable — use your knowledge of today's games.";
      addLog(`⚠️ Odds fetch failed: ${err.message}`);
    }
    const stakeAmount=Math.max(10,Math.round(state.bankroll*0.03/5)*5);
    const systemPrompt=`You are a sharp sports bettor finding value bets from live odds.
LIVE ODDS DATA:\n${oddsText}\n
Rules:
- Only bet games listed. Use EXACT odds shown.
- Respond ONLY with a JSON array, no markdown.
- Each object: { "pick", "sport", "betType", "odds"(integer), "reasoning", "keyFactors"(3-5 strings), "confidence"(55-80), "edge" }
- Return [] if no value found today.
${pickContext?`Focus: ${pickContext}`:''}`;
    setLoadingMsg('🧠 Finding value...');
    try {
      const raw=await callClaude(
        [{role:'user',content:`Today is ${new Date().toLocaleDateString()}. Review live ${pickSport} odds, search for injury/news, return best value bets as JSON array.`}],
        systemPrompt,true
      );
      let picks=[];
      const s=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const start=s.indexOf('[');
      if (start!==-1) {
        let depth=0,inStr=false,esc=false,end=-1;
        for (let i=start;i<s.length;i++) {
          const c=s[i];
          if (esc){esc=false;continue;}
          if (c==='\\'&&inStr){esc=true;continue;}
          if (c==='"'){inStr=!inStr;continue;}
          if (inStr) continue;
          if (c==='[') depth++;
          else if (c===']'){depth--;if(depth===0){end=i;break;}}
        }
        if (end!==-1) picks=JSON.parse(s.slice(start,end+1));
      }
      if (!Array.isArray(picks)||picks.length===0) {
        addLog('No strong value found today.');
        setLoadingMsg('');setLoading(false);return;
      }
      picks.forEach(p=>addAIPick({...p,sport:pickSport,stake:stakeAmount,source:'ai'}));
      addLog(`✅ AI placed ${picks.length} pick(s)`);
      setTab('ai');
    } catch(err) {
      setError('Failed: '+err.message);
      addLog('❌ '+err.message);
    }
    setLoadingMsg('');setLoading(false);
  },[pickSport,pickContext,state.bankroll,addAIPick]);

  const gradeBet = useCallback((id,result)=>{
    const bet=state.bets.find(b=>b.id===id);
    if (!bet) return;
    const payout=result==='win'?americanToDecimal(bet.odds)*bet.stake:result==='push'?bet.stake:0;
    const pl=result==='win'?(americanToDecimal(bet.odds)-1)*bet.stake:result==='loss'?-bet.stake:0;
    const key=bet.source==='paste'?'myBankroll':'bankroll';
    setState(s=>({...s,[key]:parseFloat((s[key]+payout).toFixed(2)),bets:s.bets.map(b=>b.id===id?{...b,result}:b)}));
    addLog(`Graded: ${bet.pick} → ${result.toUpperCase()} (${formatMoney(pl)})`);
  },[state.bets]);

  const teachLesson = useCallback(async (betId)=>{
    const bet=state.bets.find(b=>b.id===betId);
    if (!bet) return;
    setTeaching(true);setLoadingMsg('🎓 Generating lesson...');
    const pl=bet.result==='win'?(americanToDecimal(bet.odds)-1)*bet.stake:-bet.stake;
    try {
      const lesson=await callClaude(
        [{role:'user',content:`Analyze this ${bet.result} bet:\nPick: ${bet.pick} (${bet.sport}, ${bet.betType})\nOdds: ${formatOdds(bet.odds)} (implied ${impliedProb(bet.odds).toFixed(1)}%)\nReasoning: ${bet.reasoning}\nResult: ${bet.result} (${formatMoney(pl)})\n\nWas the reasoning sound? What should a sharper bettor do differently? 3-4 sentences.`}],
        'You are a sharp sports betting coach. Be direct and specific. Plain text only.',false
      );
      const card={id:uid(),date:new Date().toISOString(),title:`${bet.result==='win'?'✅':'❌'} ${bet.pick}`,category:bet.sport,body:lesson,takeaway:null,betId};
      setState(s=>({...s,bets:s.bets.map(b=>b.id===betId?{...b,lesson}:b),lessons:[card,...s.lessons]}));
      addLog(`📘 Lesson for ${bet.pick}`);
    } catch(err){setError('Lesson failed: '+err.message);}
    setTeaching(false);setLoadingMsg('');
  },[state.bets]);

  const runReview = useCallback(async ()=>{
    if (aiGraded.length<3){setError('Need at least 3 graded AI bets.');return;}
    setLoading(true);setLoadingMsg('📊 Running review...');
    const summary=aiGraded.slice(0,20).map(b=>({pick:b.pick,sport:b.sport,odds:b.odds,confidence:b.confidence,result:b.result}));
    try {
      const raw=await callClaude(
        [{role:'user',content:`Review ${aiGraded.length} AI bets:\n${JSON.stringify(summary)}\nStats: WR ${aiStats.wr.toFixed(1)}%, ROI ${aiStats.roi.toFixed(1)}%, Net ${formatMoney(aiStats.profit)}\nReturn ONLY: {"title":"...","category":"AI Review","body":"3-4 sentences","takeaway":"key improvement"}`}],
        'You are a professional betting analyst. Respond ONLY with JSON, no markdown.',false
      );
      let review={};
      try{const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();const s=clean.indexOf('{'),e=clean.lastIndexOf('}');if(s!==-1&&e!==-1)review=JSON.parse(clean.slice(s,e+1));}catch{}
      setState(s=>({...s,lessons:[{id:uid(),date:new Date().toISOString(),title:review.title||'AI Review',category:'AI Review',body:review.body||raw,takeaway:review.takeaway||null},...s.lessons]}));
      addLog('📊 Review done');setTab('lessons');
    } catch(err){setError('Review failed: '+err.message);}
    setLoading(false);setLoadingMsg('');
  },[aiGraded,aiStats]);

  const resetAll=()=>{
    if (!confirm('Reset ALL data?')) return;
    setState({...EMPTY_STATE});
  };

  const inp=extra=>({background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13,fontFamily:"'Rajdhani',sans-serif",...extra});

  const TABS=['dashboard','ai','paste','mine','lessons','log'];
  const TLABELS={
    dashboard:'📊 Dash',
    ai:'🤖 AI Bets',
    paste:'📋 Paste',
    mine:'📈 My Scripts',
    lessons:`🎓 (${state.lessons.length})`,
    log:'🪵 Log',
  };

  const filterBar = (filter, setFilter) => (
    <div style={{display:'flex',gap:6,marginBottom:12}}>
      {['all','pending','win','loss','push'].map(r=>(
        <button key={r} onClick={()=>setFilter(r)} style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',background:filter===r?'#1d4ed8':'#1e293b',color:filter===r?'#fff':'#64748b',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5}}>{r}</button>
      ))}
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#050810;font-family:'Rajdhani',sans-serif;color:#e2e8f0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a0f1e}::-webkit-scrollbar-thumb{background:#1e40af;border-radius:4px}
        input,select,textarea,button{outline:none;font-family:'Rajdhani',sans-serif}
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
      `}</style>
      <div style={{minHeight:'100vh',background:'radial-gradient(ellipse at top,#0a0f1e 0%,#050810 70%)'}}>
        <div style={{position:'fixed',inset:0,pointerEvents:'none',backgroundImage:'linear-gradient(rgba(30,64,175,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(30,64,175,.04) 1px,transparent 1px)',backgroundSize:'40px 40px'}}/>
        <div style={{maxWidth:680,margin:'0 auto',padding:'20px 16px 80px'}}>

          <div style={{textAlign:'center',marginBottom:20}}>
            <div style={{fontSize:10,color:'#1d4ed8',letterSpacing:4,textTransform:'uppercase',marginBottom:4}}>AI Paper Betting Lab</div>
            <h1 style={{fontFamily:"'Orbitron',sans-serif",fontSize:30,fontWeight:900,color:'#f1f5f9',letterSpacing:2}}>BET<span style={{color:'#1d4ed8'}}>LAB</span></h1>
            <div style={{fontSize:11,color:'#475569',marginTop:3}}>AI picks its own · You paste yours · Compare head to head</div>
          </div>

          {/* Dual bankrolls */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px'}}>
              <div style={{fontSize:9,color:'#60a5fa',letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>🤖 AI Bankroll</div>
              {editingBankroll?(
                <div style={{display:'flex',gap:4,marginTop:4}}>
                  <input autoFocus type="number" value={bankrollInput} onChange={e=>setBankrollInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveBankroll();if(e.key==='Escape')setEditingBankroll(false);}} style={{flex:1,background:'#0f172a',border:'1px solid #1d4ed8',borderRadius:6,color:'#f1f5f9',padding:'4px 8px',fontSize:16,fontFamily:"'Orbitron',sans-serif"}}/>
                  <button onClick={saveBankroll} style={{background:'#1d4ed8',border:'none',borderRadius:6,color:'#fff',padding:'4px 8px',cursor:'pointer',fontSize:11,fontWeight:700}}>SET</button>
                </div>
              ):(
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:22,color:state.bankroll>=state.startingBankroll?'#22c55e':'#ef4444',fontWeight:700}}>${state.bankroll.toFixed(0)}</div>
                  <button onClick={()=>{setBankrollInput(state.bankroll.toFixed(2));setEditingBankroll(true);}} style={{background:'rgba(29,78,216,.15)',border:'1px solid #1d4ed844',borderRadius:6,color:'#60a5fa',padding:'2px 6px',cursor:'pointer',fontSize:9,fontWeight:700}}>EDIT</button>
                </div>
              )}
              <div style={{fontSize:10,color:'#475569'}}>start ${state.startingBankroll.toFixed(0)} · {aiBets.filter(b=>b.result==='pending').length} pending</div>
            </div>
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px'}}>
              <div style={{fontSize:9,color:'#f97316',letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>📋 My Scripts</div>
              {editingMyBankroll?(
                <div style={{display:'flex',gap:4,marginTop:4}}>
                  <input autoFocus type="number" value={myBankrollInput} onChange={e=>setMyBankrollInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveMyBankroll();if(e.key==='Escape')setEditingMyBankroll(false);}} style={{flex:1,background:'#0f172a',border:'1px solid #f97316',borderRadius:6,color:'#f1f5f9',padding:'4px 8px',fontSize:16,fontFamily:"'Orbitron',sans-serif"}}/>
                  <button onClick={saveMyBankroll} style={{background:'#f97316',border:'none',borderRadius:6,color:'#000',padding:'4px 8px',cursor:'pointer',fontSize:11,fontWeight:700}}>SET</button>
                </div>
              ):(
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:22,color:state.myBankroll>=state.myStartingBankroll?'#22c55e':'#ef4444',fontWeight:700}}>${state.myBankroll.toFixed(0)}</div>
                  <button onClick={()=>{setMyBankrollInput(state.myBankroll.toFixed(2));setEditingMyBankroll(true);}} style={{background:'rgba(249,115,22,.15)',border:'1px solid #f9731644',borderRadius:6,color:'#f97316',padding:'2px 6px',cursor:'pointer',fontSize:9,fontWeight:700}}>EDIT</button>
                </div>
              )}
              <div style={{fontSize:10,color:'#475569'}}>start ${state.myStartingBankroll.toFixed(0)} · {myBets.filter(b=>b.result==='pending').length} pending</div>
            </div>
          </div>

          {error&&<div style={{background:'#7f1d1d',border:'1px solid #ef4444',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12,color:'#fca5a5',display:'flex',justifyContent:'space-between'}}>{error}<button onClick={()=>setError('')} style={{background:'none',border:'none',color:'#fca5a5',cursor:'pointer',fontSize:14}}>✕</button></div>}
          {(loading||teaching)&&<div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1d4ed8',borderRadius:10,padding:'12px 16px',marginBottom:12,fontSize:13,color:'#60a5fa',animation:'pulse 1.5s infinite',display:'flex',alignItems:'center',gap:10}}><div style={{width:8,height:8,background:'#3b82f6',borderRadius:'50%',flexShrink:0}}/>{loadingMsg||'Working...'}</div>}

          {/* Tabs */}
          <div style={{display:'flex',gap:2,marginBottom:14,background:'rgba(10,18,35,0.8)',padding:4,borderRadius:10,border:'1px solid #1e293b',overflowX:'auto'}}>
            {TABS.map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:'8px 2px',borderRadius:7,border:'none',cursor:'pointer',background:tab===t?(t==='ai'?'#1d4ed8':t==='paste'||t==='mine'?'#92400e':'#1e293b'):'transparent',color:tab===t?'#fff':'#64748b',fontSize:10,fontWeight:700,transition:'all .2s',whiteSpace:'nowrap'}}>{TLABELS[t]}</button>
            ))}
          </div>

          {/* DASHBOARD */}
          {tab==='dashboard'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
                <StatBox label="AI W/L" value={aiGraded.length?`${aiStats.wins}-${aiStats.total-aiStats.wins}`:'—'} color="#60a5fa"/>
                <StatBox label="AI ROI" value={aiGraded.length?`${aiStats.roi>=0?'+':''}${aiStats.roi.toFixed(0)}%`:'—'} color={aiStats.roi>=0?'#22c55e':'#ef4444'}/>
                <StatBox label="My W/L" value={myGraded.length?`${myStats.wins}-${myStats.total-myStats.wins}`:'—'} color="#f97316"/>
                <StatBox label="My ROI" value={myGraded.length?`${myStats.roi>=0?'+':''}${myStats.roi.toFixed(0)}%`:'—'} color={myStats.roi>=0?'#22c55e':'#ef4444'}/>
              </div>
              <ROIComparison bets={state.bets} bankroll={state.bankroll} startingBankroll={state.startingBankroll} myBankroll={state.myBankroll} myStartingBankroll={state.myStartingBankroll}/>
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
                <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#1d4ed8',letterSpacing:2,marginBottom:14}}>🤖 AI LIVE ODDS PICKER</div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <select value={pickSport} onChange={e=>setPickSport(e.target.value)} style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'10px 12px',fontSize:13,cursor:'pointer'}}>
                    {SPORTS.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={generatePicks} disabled={loading} style={{flex:1,padding:'10px 16px',borderRadius:8,border:'none',background:loading?'#1e293b':'linear-gradient(135deg,#1d4ed8,#2563eb)',color:loading?'#475569':'#fff',fontSize:13,fontWeight:700,cursor:loading?'not-allowed':'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1}}>
                    {loading?'WORKING...':'FIND VALUE'}
                  </button>
                </div>
                <textarea value={pickContext} onChange={e=>setPickContext(e.target.value)} placeholder="Optional focus: 'road underdogs', 'NRFI only', 'player props'..." style={{width:'100%',background:'#0f172a',border:'1px solid #1e293b',borderRadius:8,color:'#94a3b8',padding:'10px 12px',fontSize:12,resize:'none',height:52,lineHeight:1.5}}/>
              </div>
              <button onClick={runReview} disabled={loading||aiGraded.length<3} style={{width:'100%',padding:'12px 0',borderRadius:10,border:'1px solid #1e40af44',background:'rgba(29,78,216,.1)',color:aiGraded.length>=3?'#60a5fa':'#475569',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:14}}>
                📊 AI PERFORMANCE REVIEW {aiGraded.length<3?`(${3-aiGraded.length} more needed)`:''}
              </button>
            </div>
          )}

          {/* AI BETS */}
          {tab==='ai'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:10,padding:'12px 16px',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:10,color:'#60a5fa',fontWeight:700,letterSpacing:1}}>🤖 AI PAPER BETS</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{aiBets.filter(b=>b.result==='pending').length} pending · {aiGraded.length} graded</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:aiStats.roi>=0?'#22c55e':'#ef4444'}}>{aiStats.roi>=0?'+':''}{aiStats.roi.toFixed(1)}% ROI</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{aiStats.wins}W-{aiStats.total-aiStats.wins}L</div>
                </div>
              </div>
              {filterBar(aiFilter,setAiFilter)}
              {aiBets.filter(b=>aiFilter==='all'||b.result===aiFilter).length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>🤖</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO AI BETS YET</div><div style={{fontSize:12,marginTop:6}}>Go to Dashboard → Find Value</div></div>
                :aiBets.filter(b=>aiFilter==='all'||b.result===aiFilter).map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} teaching={teaching}/>)
              }
            </div>
          )}

          {/* PASTE */}
          {tab==='paste'&&<PasteTab onConfirmPicks={confirmPicks} callClaude={callClaude}/>}

          {/* MY SCRIPTS */}
          {tab==='mine'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:10,padding:'12px 16px',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:10,color:'#f97316',fontWeight:700,letterSpacing:1}}>📋 MY SCRIPT PICKS</div>
                  <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{myBets.filter(b=>b.result==='pending').length} pending · {myGraded.length} graded</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:myStats.roi>=0?'#22c55e':'#ef4444'}}>{myStats.roi>=0?'+':''}{myStats.roi.toFixed(1)}% ROI</div>
                  <div style={{fontSize:11,color:'#64748b'}}>{myStats.wins}W-{myStats.total-myStats.wins}L</div>
                </div>
              </div>
              {filterBar(myFilter,setMyFilter)}
              {myBets.filter(b=>myFilter==='all'||b.result===myFilter).length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>📋</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO SCRIPT PICKS YET</div><div style={{fontSize:12,marginTop:6}}>Go to 📋 Paste → drop in your model output</div></div>
                :myBets.filter(b=>myFilter==='all'||b.result===myFilter).map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} teaching={teaching}/>)
              }
            </div>
          )}

          {/* LESSONS */}
          {tab==='lessons'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              {state.lessons.length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>🎓</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO LESSONS YET</div><div style={{fontSize:12,marginTop:6}}>Grade AI bets → Analyze This Bet</div></div>
                :state.lessons.map(l=><LessonCard key={l.id} lesson={l}/>)
              }
            </div>
          )}

          {/* LOG */}
          {tab==='log'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{background:'rgba(5,8,16,0.95)',border:'1px solid #1e293b',borderRadius:12,padding:14,fontFamily:'monospace',fontSize:11,color:'#64748b',maxHeight:420,overflowY:'auto'}}>
                {state.sessionLog.length===0
                  ?<div style={{color:'#334155',textAlign:'center',padding:20}}>No activity yet.</div>
                  :state.sessionLog.map(l=>(
                    <div key={l.id} style={{marginBottom:4,color:l.msg.startsWith('✅')?'#22c55e':l.msg.startsWith('❌')?'#ef4444':l.msg.startsWith('⚠️')?'#f59e0b':'#64748b'}}>
                      <span style={{color:'#1e40af'}}>[{new Date(l.time).toLocaleTimeString()}]</span> {l.msg}
                    </div>
                  ))}
                <div ref={logEndRef}/>
              </div>
              <button onClick={resetAll} style={{marginTop:14,width:'100%',padding:'10px 0',borderRadius:8,background:'transparent',border:'1px solid #7f1d1d',color:'#ef4444',fontSize:11,fontWeight:700,cursor:'pointer',letterSpacing:1,textTransform:'uppercase'}}>🗑 Reset All Data</button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
