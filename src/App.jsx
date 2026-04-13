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
  NHL:'Paste your nhl_v11.py terminal output here',
  MLB:'Paste your mlb_nrfi_v7.py terminal output here',
  NBA:'Paste any NBA model output here',
  NFL:'Paste any NFL model output here',
};

function StatBox({ label, value, color='#e2e8f0' }) {
  return (
    <div style={{background:'rgba(15,23,42,0.8)',border:'1px solid #1e293b',borderRadius:10,padding:'14px 18px',textAlign:'center',flex:1,minWidth:80}}>
      <div style={{fontSize:22,fontFamily:"'Orbitron',sans-serif",color,fontWeight:700}}>{value}</div>
      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:1,marginTop:2}}>{label}</div>
    </div>
  );
}

function BetCard({ bet, onGrade, onTeach, onDelete, onEdit, onUndoGrade, teaching, allowEdit }) {
  const [showLegGrader, setShowLegGrader] = useState(false);
  const [legResults, setLegResults] = useState(
    bet.legs ? bet.legs.map(l=>({...l,result:'pending'})) : []
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [grading, setGrading] = useState(null);
  const [score, setScore] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);

  const getAISuggestion = async () => {
    setLoadingAI(true);
    try {
      const res = await fetch('/api/claude', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'claude-sonnet-4-5',
          max_tokens:300,
          system:'You are a sharp sports betting analyst. Give a brief 2-3 sentence opinion on this bet — does the reasoning hold up, is there real edge, and would you take it? Be direct and specific. Consider the bettor\'s history when giving advice.',
          messages:[{role:'user',content:`Bet: ${bet.pick}
Sport: ${bet.sport}
Odds: ${bet.odds}
Reasoning: ${bet.reasoning}
Key factors: ${bet.keyFactors?.join(', ')}
Model prob: ${bet.modelProb}%

Is this a good bet?`}],
        }),
      });
      const data = await res.json();
      const text = data.content?.filter(b=>b.type==='text').map(b=>b.text).join('') || 'No response';
      setAiSuggestion(text);
    } catch(e) { setAiSuggestion('Error: '+e.message); }
    setLoadingAI(false);
  };
  // Recalculate parlay odds from legs if available
  const effectiveOdds = (()=>{
    if (bet.betCategory==='parlay'&&bet.legs?.length>=2) {
      const hasOdds = bet.legs.filter(l=>l.odds);
      if (hasOdds.length>=2) {
        const dec = hasOdds.reduce((acc,leg)=>{
          const d = leg.odds>0?leg.odds/100+1:100/Math.abs(leg.odds)+1;
          return acc*d;
        },1.0);
        const boosted = bet.boost>0 ? dec*(1+bet.boost/100) : dec;
        return boosted>=2?Math.round((boosted-1)*100):Math.round(-100/(boosted-1));
      }
    }
    return parseInt(bet.odds)||-110;
  })();
  const profit = bet.result==='win'?(americanToDecimal(effectiveOdds)-1)*bet.stake:bet.result==='loss'?-bet.stake:0;
  const col = RC[bet.result]||'#334155';
  const isAI = bet.source==='ai';
  const accentColor = isAI?'#60a5fa':'#f97316';

  const handleLegGrade = () => {
    const allWon=legResults.every(l=>l.result==='win');
    const anyLoss=legResults.some(l=>l.result==='loss');
    onGrade(bet.id, allWon?'win':anyLoss?'loss':'push');
    setShowLegGrader(false);
  };

  return (
    <div style={{background:'rgba(10,18,35,0.9)',border:`1px solid ${col}44`,borderLeft:`3px solid ${accentColor}`,borderRadius:10,padding:'14px 16px',marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:4}}>
            <span style={{fontFamily:"'Orbitron',sans-serif",fontSize:13,color:'#f1f5f9',fontWeight:700}}>{bet.pick}</span>
            <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20,textTransform:'uppercase'}}>{bet.sport}</span>
            <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20}}>{bet.betType}</span>
            {bet.betCategory==='parlay'&&<span style={{fontSize:9,background:'rgba(251,191,36,0.15)',color:'#fbbf24',padding:'2px 6px',borderRadius:20,border:'1px solid rgba(251,191,36,0.3)'}}>PARLAY</span>}
            {bet.betCategory==='prop'&&<span style={{fontSize:9,background:'rgba(167,139,250,0.15)',color:'#a78bfa',padding:'2px 6px',borderRadius:20,border:'1px solid rgba(167,139,250,0.3)'}}>PROP</span>}
          </div>
          <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.5}}>{bet.reasoning}</div>
          {bet.keyFactors?.length>0&&(
            <div style={{marginTop:6,display:'flex',gap:4,flexWrap:'wrap'}}>
              {bet.keyFactors.map((f,i)=><span key={i} style={{fontSize:9,background:'rgba(59,130,246,0.15)',color:'#60a5fa',padding:'2px 7px',borderRadius:20,border:'1px solid rgba(59,130,246,0.2)'}}>{f}</span>)}
            </div>
          )}
          {bet.legs?.length>0&&(
            <div style={{marginTop:8,padding:'8px 10px',background:'rgba(251,191,36,0.05)',borderRadius:6,border:'1px solid rgba(251,191,36,0.15)'}}>
              <div style={{fontSize:10,color:'#fbbf24',fontWeight:700,marginBottom:4}}>LEGS ({bet.legs.length})</div>
              {bet.legs.map((leg,i)=><div key={i} style={{fontSize:11,color:'#94a3b8',marginBottom:2}}>• {leg.desc}{leg.odds?` (${leg.odds>0?'+':''}${leg.odds})`:''}</div>)}
            </div>
          )}
          <div style={{fontSize:10,color:'#475569',marginTop:6}}>
            Conf {bet.confidence}% · Implied {impliedProb(bet.odds).toFixed(1)}% · {new Date(bet.date).toLocaleDateString()}
            {bet.modelProb?` · Model: ${bet.modelProb}%`:''}
          </div>
          {bet.score&&<div style={{marginTop:4,fontSize:11,color:'#38bdf8',fontWeight:700}}>📊 {bet.score}</div>}
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:'#e2e8f0'}}>{formatOdds(effectiveOdds)}{bet.boost>0&&<span style={{fontSize:9,color:'#22c55e',display:'block'}}>+{bet.boost}% boost</span>}</div>
          <div style={{fontSize:11,color:'#64748b'}}>${bet.stake} stake</div>
          {bet.result!=='pending'&&<div style={{fontSize:14,fontWeight:700,color:RC[bet.result]||col,marginTop:4}}>{bet.result==='push'?'PUSH':formatMoney(profit)}</div>}
          {bet.result==='pending'&&<div style={{fontSize:10,color:'#f59e0b',marginTop:4}}>PENDING</div>}
        </div>
      </div>

      {bet.result==='pending'&&!showLegGrader&&!grading&&(
        <div style={{display:'flex',gap:6,marginTop:10}}>
          {bet.betCategory==='parlay'&&bet.legs?.length>0
            ?<button onClick={()=>setShowLegGrader(true)} style={{flex:1,padding:'7px 0',borderRadius:6,border:'1px solid #fbbf2444',background:'rgba(251,191,36,0.1)',color:'#fbbf24',fontSize:11,fontWeight:700,cursor:'pointer'}}>GRADE LEGS</button>
            :['win','loss','push'].map(r=>(
              <button key={r} onClick={()=>setGrading(r)} style={{flex:1,padding:'7px 0',borderRadius:6,border:'none',cursor:'pointer',background:r==='win'?'#14532d':r==='loss'?'#7f1d1d':'#1e293b',color:r==='win'?'#86efac':r==='loss'?'#fca5a5':'#94a3b8',fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>{r}</button>
            ))
          }
        </div>
      )}
      {bet.result==='pending'&&grading&&(
        <div style={{marginTop:10,padding:12,background:'rgba(15,23,42,0.8)',borderRadius:8,border:'1px solid #334155'}}>
          <div style={{fontSize:10,color:'#64748b',fontWeight:700,letterSpacing:1,marginBottom:8}}>ENTER SCORE (optional)</div>
          <input
            value={score}
            onChange={e=>setScore(e.target.value)}
            placeholder={bet.sport==='MLB'?'e.g. 3-1 or 1st inn: 2-0':bet.sport==='NHL'?'e.g. 4-2 OT':bet.sport==='NBA'?'e.g. 114-108':'e.g. 24-17'}
            style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'8px 10px',fontSize:13,fontFamily:"'Rajdhani',sans-serif",marginBottom:10}}
          />
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>{onGrade(bet.id,grading,score);setGrading(null);setScore('');}} style={{flex:2,padding:'8px 0',borderRadius:6,border:'none',cursor:'pointer',background:grading==='win'?'#14532d':grading==='loss'?'#7f1d1d':'#1e293b',color:grading==='win'?'#86efac':grading==='loss'?'#fca5a5':'#94a3b8',fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>CONFIRM {grading.toUpperCase()}</button>
            <button onClick={()=>{setGrading(null);setScore('');}} style={{flex:1,padding:'8px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:11,fontWeight:700,cursor:'pointer'}}>CANCEL</button>
          </div>
        </div>
      )}

      {showLegGrader&&(
        <div style={{marginTop:10,padding:12,background:'rgba(251,191,36,0.05)',borderRadius:8,border:'1px solid rgba(251,191,36,0.2)'}}>
          <div style={{fontSize:10,color:'#fbbf24',fontWeight:700,letterSpacing:1,marginBottom:10}}>MARK EACH LEG</div>
          {legResults.map((leg,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <div style={{flex:1,fontSize:12,color:'#94a3b8'}}>{leg.desc}</div>
              <div style={{display:'flex',gap:4}}>
                {['win','loss','push'].map(r=>(
                  <button key={r} onClick={()=>setLegResults(p=>p.map((l,j)=>j===i?{...l,result:r}:l))} style={{padding:'3px 8px',borderRadius:4,border:'none',cursor:'pointer',background:legResults[i].result===r?(r==='win'?'#14532d':r==='loss'?'#7f1d1d':'#334155'):'#1e293b',color:legResults[i].result===r?(r==='win'?'#86efac':r==='loss'?'#fca5a5':'#94a3b8'):'#475569',fontSize:10,fontWeight:700}}>{r}</button>
                ))}
              </div>
            </div>
          ))}
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <button onClick={handleLegGrade} style={{flex:1,padding:'7px 0',borderRadius:6,border:'none',background:'#1d4ed8',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>CONFIRM</button>
            <button onClick={()=>setShowLegGrader(false)} style={{flex:1,padding:'7px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:11,fontWeight:700,cursor:'pointer'}}>CANCEL</button>
          </div>
        </div>
      )}

      {allowEdit&&(
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <button onClick={()=>onEdit(bet)} style={{flex:1,padding:'5px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:10,fontWeight:700,cursor:'pointer'}}>✏️ EDIT</button>
          {bet.result==='pending'&&(!confirmDelete
            ?<button onClick={()=>setConfirmDelete(true)} style={{flex:1,padding:'5px 0',borderRadius:6,border:'1px solid #7f1d1d44',background:'transparent',color:'#ef444488',fontSize:10,fontWeight:700,cursor:'pointer'}}>🗑 DELETE</button>
            :<button onClick={()=>onDelete(bet.id)} style={{flex:1,padding:'5px 0',borderRadius:6,border:'none',background:'#7f1d1d',color:'#fca5a5',fontSize:10,fontWeight:700,cursor:'pointer'}}>CONFIRM DELETE</button>
          )}
        </div>
      )}

      {!isAI&&bet.result==='pending'&&(
        <div style={{marginTop:8}}>
          <button onClick={getAISuggestion} disabled={loadingAI} style={{width:'100%',padding:'7px 0',borderRadius:6,border:'1px solid #a78bfa44',background:'rgba(167,139,250,0.1)',color:loadingAI?'#334155':'#a78bfa',fontSize:11,fontWeight:700,cursor:loadingAI?'not-allowed':'pointer',letterSpacing:1,textTransform:'uppercase'}}>
            🤖 {loadingAI?'ANALYZING...':'GET AI OPINION'}
          </button>
          {aiSuggestion&&(
            <div style={{marginTop:8,padding:'10px 12px',background:'rgba(167,139,250,0.05)',borderRadius:8,border:'1px solid rgba(167,139,250,0.2)'}}>
              <div style={{fontSize:10,color:'#a78bfa',fontWeight:700,letterSpacing:1,marginBottom:4}}>🤖 AI SAYS</div>
              <div style={{fontSize:12,color:'#cbd5e1',lineHeight:1.6}}>{aiSuggestion}</div>
            </div>
          )}
        </div>
      )}
      {bet.result!=='pending'&&(
        <div style={{display:'flex',gap:6,marginTop:10}}>
          {!bet.lesson&&isAI&&(
            <button onClick={()=>onTeach(bet.id)} disabled={teaching} style={{flex:1,padding:'7px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:teaching?'#334155':'#60a5fa',fontSize:11,fontWeight:700,cursor:teaching?'not-allowed':'pointer',letterSpacing:1,textTransform:'uppercase'}}>
              🎓 {teaching?'Analyzing...':'Analyze'}
            </button>
          )}
          <button onClick={()=>onUndoGrade(bet.id)} style={{flex:1,padding:'7px 0',borderRadius:6,border:'1px solid #f59e0b44',background:'rgba(245,158,11,0.1)',color:'#f59e0b',fontSize:11,fontWeight:700,cursor:'pointer',letterSpacing:1,textTransform:'uppercase'}}>↩ UNDO</button>
        </div>
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

function ROIComparison({ bets }) {
  function calcStats(source) {
    const graded=bets.filter(b=>b.source===source&&b.result!=='pending');
    if (!graded.length) return null;
    const wins=graded.filter(b=>b.result==='win').length;
    const staked=graded.reduce((a,b)=>a+b.stake,0);
    const profit=graded.reduce((a,b)=>{
      if(b.result==='win'){
        const eff=b.betCategory==='parlay'&&b.legs?.length>=2
          ? (()=>{const dec=b.legs.filter(l=>l.odds).reduce((acc,l)=>{const d=l.odds>0?l.odds/100+1:100/Math.abs(l.odds)+1;return acc*d;},1.0);const boosted=b.boost>0?dec*(1+b.boost/100):dec;return boosted>=2?Math.round((boosted-1)*100):Math.round(-100/(boosted-1));})()
          : parseInt(b.odds)||-110;
        return a+(americanToDecimal(eff)-1)*b.stake;
      }
      if(b.result==='loss') return a-b.stake;
      return a;
    },0);
    const roi=staked?profit/staked*100:0;
    return {wins,total:graded.length,wr:wins/graded.length*100,roi,profit,staked};
  }
  const ai=calcStats('ai'), my=calcStats('paste');
  const roiC=v=>v>5?'#22c55e':v>0?'#86efac':v>-5?'#fbbf24':'#f87171';
  return (
    <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#1d4ed8',letterSpacing:2,marginBottom:14,textTransform:'uppercase'}}>📊 Head to Head</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={{borderRight:'1px solid #1e293b',paddingRight:12}}>
          <div style={{fontSize:10,color:'#60a5fa',letterSpacing:2,marginBottom:6,fontWeight:700}}>🤖 AI PAPER BETS</div>
          {ai?<>
            <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:24,color:ai.profit>=0?'#22c55e':'#ef4444',fontWeight:700}}>{formatMoney(ai.profit)}</div>
            <div style={{fontSize:10,color:'#475569',marginBottom:6}}>net profit · {ai.total} graded</div>
            <div style={{fontSize:12,color:roiC(ai.roi),fontWeight:700}}>ROI {ai.roi>=0?'+':''}{ai.roi.toFixed(1)}%</div>
            <div style={{fontSize:11,color:'#64748b'}}>{ai.wins}W-{ai.total-ai.wins}L · {ai.wr.toFixed(0)}% WR</div>
          </>:<div style={{fontSize:11,color:'#334155'}}>No graded picks yet</div>}
        </div>
        <div style={{paddingLeft:12}}>
          <div style={{fontSize:10,color:'#f97316',letterSpacing:2,marginBottom:6,fontWeight:700}}>📋 MY SCRIPTS</div>
          {my?<>
            <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:24,color:my.profit>=0?'#22c55e':'#ef4444',fontWeight:700}}>{formatMoney(my.profit)}</div>
            <div style={{fontSize:10,color:'#475569',marginBottom:6}}>net profit · {my.total} graded</div>
            <div style={{fontSize:12,color:roiC(my.roi),fontWeight:700}}>ROI {my.roi>=0?'+':''}{my.roi.toFixed(1)}%</div>
            <div style={{fontSize:11,color:'#64748b'}}>{my.wins}W-{my.total-my.wins}L · {my.wr.toFixed(0)}% WR</div>
          </>:<div style={{fontSize:11,color:'#334155'}}>No graded picks yet</div>}
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

function MyPickModal({ existing, onSave, onClose }) {
  const [form, setForm] = useState(existing || {
    sport:'MLB', pick:'', betType:'NRFI', betCategory:'straight',
    odds:-115, stake:25, confidence:60, modelProb:'', reasoning:'', legs:[], boost:0,
  });
  const [legInput, setLegInput] = useState('');
  const [legOdds, setLegOdds] = useState('');

  const calcParlayOdds = (legs) => {
    if (legs.length < 2) return null;
    const hasOdds = legs.filter(l=>l.odds);
    if (!hasOdds.length) return null;
    const dec = hasOdds.reduce((acc,leg)=>{
      const d = leg.odds>0 ? leg.odds/100+1 : 100/Math.abs(leg.odds)+1;
      return acc*d;
    },1.0);
    const boost = form.boost>0 ? 1+(form.boost/100) : 1;
    const boosted = dec * boost;
    const american = boosted>=2 ? Math.round((boosted-1)*100) : Math.round(-100/(boosted-1));
    return american;
  };

  const addLeg = () => {
    if (!legInput.trim()) return;
    setForm(f=>({...f,legs:[...f.legs,{desc:legInput.trim(),odds:legOdds?parseInt(legOdds):null,result:'pending'}]}));
    setLegInput(''); setLegOdds('');
  };
  const removeLeg = i => setForm(f=>({...f,legs:f.legs.filter((_,j)=>j!==i)}));

  const inp = extra=>({background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13,fontFamily:"'Rajdhani',sans-serif",width:'100%',...extra});
  const lbl = {fontSize:10,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4,display:'block'};

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
      <div style={{background:'#0a1220',border:'1px solid #1e293b',borderRadius:14,padding:20,width:'100%',maxWidth:440,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:13,color:'#f97316',marginBottom:16}}>{existing?'EDIT MY BET':'LOG MY BET'}</div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          <div>
            <label style={lbl}>SPORT</label>
            <select style={inp()} value={form.sport} onChange={e=>setForm(f=>({...f,sport:e.target.value}))}>
              {['MLB','NHL','NBA','NFL'].map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>CATEGORY</label>
            <select style={inp()} value={form.betCategory} onChange={e=>setForm(f=>({...f,betCategory:e.target.value}))}>
              <option value="straight">Straight</option>
              <option value="parlay">Parlay</option>
              <option value="prop">Player Prop</option>
            </select>
          </div>
        </div>

        <div style={{marginBottom:10}}>
          <label style={lbl}>PICK / DESCRIPTION</label>
          <input style={inp()} value={form.pick} onChange={e=>setForm(f=>({...f,pick:e.target.value}))}
            placeholder={form.betCategory==='parlay'?'e.g. 3-leg parlay':form.betCategory==='prop'?'e.g. Matthews O0.5 goals':'e.g. BOS @ NYY — NRFI'}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10}}>
          <div>
            <label style={lbl}>ODDS</label>
            <input type="number" style={inp()} value={form.odds} onChange={e=>setForm(f=>({...f,odds:+e.target.value}))}/>
          </div>
          <div>
            <label style={lbl}>STAKE $</label>
            <input type="number" style={inp()} value={form.stake} onChange={e=>setForm(f=>({...f,stake:+e.target.value}))}/>
          </div>
          <div>
            <label style={lbl}>MODEL %</label>
            <input style={inp()} value={form.modelProb} onChange={e=>setForm(f=>({...f,modelProb:e.target.value}))} placeholder="58"/>
          </div>
        </div>

        <div style={{marginBottom:10}}>
          <label style={lbl}>BET TYPE</label>
          <input style={inp()} value={form.betType} onChange={e=>setForm(f=>({...f,betType:e.target.value}))}
            placeholder={form.betCategory==='prop'?'e.g. Goals O0.5':'NRFI / Moneyline / Spread'}/>
        </div>

        <div style={{marginBottom:10}}>
          <label style={lbl}>REASONING</label>
          <textarea style={{...inp(),resize:'none',minHeight:56,lineHeight:1.5}} value={form.reasoning} onChange={e=>setForm(f=>({...f,reasoning:e.target.value}))} placeholder="Why are you taking this bet?"/>
        </div>

        {form.betCategory==='parlay'&&(
          <div style={{marginBottom:12,padding:12,background:'rgba(251,191,36,0.05)',borderRadius:8,border:'1px solid rgba(251,191,36,0.2)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontSize:10,color:'#fbbf24',fontWeight:700,letterSpacing:1}}>PARLAY LEGS</div>
              {form.legs.length>=2&&(()=>{
                const american = calcParlayOdds(form.legs);
                return american ? <div style={{fontSize:11,color:'#fbbf24'}}>
                  Calc: <strong>{american>0?'+':''}{american}</strong>
                  {form.boost>0&&<span style={{color:'#22c55e',marginLeft:4}}>(+{form.boost}% boost)</span>}
                  <button onClick={()=>setForm(f=>({...f,odds:american}))} style={{marginLeft:8,padding:'2px 8px',borderRadius:4,border:'none',background:'#fbbf2433',color:'#fbbf24',fontSize:10,cursor:'pointer',fontWeight:700}}>USE</button>
                </div> : null;
              })()}
            </div>
            {form.legs.map((leg,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <div style={{flex:1,fontSize:12,color:'#94a3b8'}}>{leg.desc}{leg.odds?` (${leg.odds>0?'+':''}${leg.odds})`:''}</div>
                <button onClick={()=>removeLeg(i)} style={{background:'#7f1d1d',border:'none',borderRadius:4,color:'#fca5a5',padding:'2px 8px',fontSize:10,cursor:'pointer'}}>✕</button>
              </div>
            ))}
            <div style={{display:'flex',gap:6,marginTop:8}}>
              <input style={{...inp(),flex:2,width:'auto'}} value={legInput} onChange={e=>setLegInput(e.target.value)} placeholder="Leg e.g. BOS ML"/>
              <input type="number" style={{...inp(),flex:1,width:'auto'}} value={legOdds} onChange={e=>setLegOdds(e.target.value)} placeholder="Odds"/>
              <button onClick={addLeg} style={{padding:'8px 12px',borderRadius:8,border:'none',background:'#1d4ed8',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0}}>+ADD</button>
            </div>
          </div>
        )}

        {form.betCategory==='prop'&&(
          <div style={{marginBottom:12,padding:12,background:'rgba(167,139,250,0.05)',borderRadius:8,border:'1px solid rgba(167,139,250,0.2)'}}>
            <div style={{fontSize:10,color:'#a78bfa',fontWeight:700,letterSpacing:1,marginBottom:6}}>PROP DETAILS</div>
            <div style={{fontSize:11,color:'#64748b'}}>Fill in Bet Type above e.g. "Points O22.5" or "Strikeouts O5.5"</div>
          </div>
        )}

        <div style={{marginBottom:12,padding:12,background:'rgba(34,197,94,0.05)',borderRadius:8,border:'1px solid rgba(34,197,94,0.2)'}}>
          <div style={{fontSize:10,color:'#22c55e',fontWeight:700,letterSpacing:1,marginBottom:8}}>BOOST (optional)</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input type="number" min="0" max="100" style={{...inp(),flex:1}} value={form.boost||0} onChange={e=>setForm(f=>({...f,boost:+e.target.value}))} placeholder="0"/>
            <span style={{color:'#64748b',fontSize:13,flexShrink:0}}>% boost on odds</span>
          </div>
          {form.boost>0&&(()=>{
            const base = parseInt(form.odds)||-110;
            const dec = base>0 ? base/100+1 : 100/Math.abs(base)+1;
            const boosted = dec*(1+form.boost/100);
            const newOdds = boosted>=2 ? Math.round((boosted-1)*100) : Math.round(-100/(boosted-1));
            return <div style={{marginTop:6,fontSize:11,color:'#22c55e'}}>
              {base>0?'+':''}{base} + {form.boost}% boost = <strong>{newOdds>0?'+':''}{newOdds}</strong>
              <button onClick={()=>setForm(f=>({...f,odds:newOdds}))} style={{marginLeft:8,padding:'2px 8px',borderRadius:4,border:'none',background:'#22c55e33',color:'#22c55e',fontSize:10,cursor:'pointer',fontWeight:700}}>USE</button>
            </div>;
          })()}
        </div>

        <div style={{display:'flex',gap:8,marginTop:4}}>
          <button onClick={()=>onSave(form)} style={{flex:1,padding:'10px 0',borderRadius:8,border:'none',background:'#f97316',color:'#000',fontFamily:"'Orbitron',sans-serif",fontSize:11,fontWeight:700,cursor:'pointer'}}>{existing?'SAVE CHANGES':'ADD BET'}</button>
          <button onClick={onClose} style={{flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:11,fontWeight:700,cursor:'pointer'}}>CANCEL</button>
        </div>
      </div>
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
Extract the TOP 3 best bet recommendations and return them as a JSON array.
Each object must have exactly:
  pick       - string: short description e.g. "NYY @ BOS — NRFI" or "BOS ML"
  betType    - string: "NRFI","YRFI","Moneyline","Spread","Total","Player Prop"
  odds       - integer: American odds. If not stated use -110.
  modelProb  - number: model probability as percentage e.g. 57.3. null if not found.
  confidence - integer 55-85: strength of signal
  reasoning  - string: 2-3 sentences with specific stats, edge size, pitcher names, xG values, Kelly% from the output
  keyFactors - array of exactly 5 short strings: most important data points (K%, xG, edge tier, NRFI%, rest days, park factor, GSAx etc.)
  rating     - string: model rating label e.g. "STRONG NRFI", "T1_STRONG", "LEAN"
  edge       - string: edge percentage if present e.g. "+6.2%" or "STRONG BET"
Rules:
- Return TOP 3 ranked by model confidence/edge, or fewer if fewer exist
- Only include bets model explicitly recommends — NO SKIPs, NO NO EDGE
- Prioritize TOP PLAYS section if present
- Be specific in reasoning — use exact stats and numbers from the output
- Return [] if no actionable picks
- Respond ONLY with a JSON array, no markdown`;
    try {
      const raw = await claudeFn(
        [{role:'user',content:`Sport: ${activeSport}\n\nModel output:\n${text.slice(0,10000)}`}],
        systemPrompt, false
      );
      let picks=[];
      const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const start=clean.indexOf('['),end=clean.lastIndexOf(']');
      if (start!==-1&&end!==-1) picks=JSON.parse(clean.slice(start,end+1));
      if (!Array.isArray(picks)||picks.length===0) {
        setError('No actionable picks found. Paste the full output including TOP PLAYS section.');
      } else {
        setPreview({sport:activeSport,picks:picks.slice(0,3)});
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
          return <button key={s} onClick={()=>{setActiveSport(s);setPreview(null);setError('');}} style={{flex:1,padding:'8px 0',borderRadius:7,border:'none',cursor:'pointer',background:activeSport===s?c.dim:'transparent',color:activeSport===s?c.accent:'#64748b',fontSize:12,fontWeight:700,letterSpacing:1,transition:'all .2s',boxShadow:activeSport===s?`inset 0 0 0 1px ${c.border}`:'none'}}>{s}</button>;
        })}
      </div>

      <div style={{background:'rgba(10,18,35,0.95)',border:`1px solid ${sc.border}`,borderRadius:14,padding:18,marginBottom:14}}>
        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:sc.accent,letterSpacing:2,marginBottom:12}}>
          PASTE {activeSport} OUTPUT → TOP 3 PICKS
        </div>
        <textarea value={pastes[activeSport]} onChange={e=>setPastes(p=>({...p,[activeSport]:e.target.value}))} placeholder={SPORT_HINTS[activeSport]} style={{...inp({width:'100%',resize:'vertical',minHeight:180,lineHeight:1.6,fontSize:12,color:'#64748b'})}}/>
        <div style={{display:'flex',gap:8,marginTop:12,alignItems:'flex-end'}}>
          <div style={{flex:1}}>
            <div style={lbl}>STAKE $ EACH</div>
            <input type="number" value={stake} onChange={e=>setStake(+e.target.value)} style={{...inp({width:'100%'})}}/>
          </div>
          <button onClick={parse} disabled={parsing||!pastes[activeSport].trim()} style={{flex:2,padding:'12px 0',borderRadius:8,border:'none',cursor:parsing||!pastes[activeSport].trim()?'not-allowed':'pointer',background:parsing||!pastes[activeSport].trim()?'#1e293b':`linear-gradient(135deg,${sc.accent}cc,${sc.accent})`,color:parsing||!pastes[activeSport].trim()?'#475569':'#000',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
            {parsing?'PARSING...':'🧠 GET TOP 3 PICKS'}
          </button>
        </div>
        {error&&<div style={{marginTop:10,padding:'10px 12px',background:'rgba(127,29,29,0.4)',borderRadius:8,border:'1px solid #ef444444',fontSize:12,color:'#fca5a5'}}>{error}</div>}
      </div>

      {preview&&(
        <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#22c55e',letterSpacing:2,marginBottom:14}}>
            ✅ TOP {preview.picks.length} {preview.sport} PICKS
          </div>
          {preview.picks.map((pick,i)=>(
            <div key={i} style={{background:'rgba(5,8,16,0.8)',border:`1px solid ${SPORT_COLORS[preview.sport].border}`,borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,color:SPORT_COLORS[preview.sport].accent,fontWeight:700,marginBottom:4}}>#{i+1} PICK</div>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:13,color:'#f1f5f9',fontWeight:700,marginBottom:4}}>{pick.pick}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20}}>{pick.betType}</span>
                    {pick.rating&&<span style={{fontSize:9,background:'rgba(34,197,94,0.15)',color:'#22c55e',padding:'2px 6px',borderRadius:20,border:'1px solid rgba(34,197,94,0.25)'}}>{pick.rating}</span>}
                    {pick.edge&&<span style={{fontSize:9,background:'rgba(251,191,36,0.15)',color:'#fbbf24',padding:'2px 6px',borderRadius:20,border:'1px solid rgba(251,191,36,0.25)'}}>{pick.edge}</span>}
                  </div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#e2e8f0'}}>{pick.odds>0?'+':''}{pick.odds}</div>
                  {pick.modelProb!=null&&<div style={{fontSize:11,color:SPORT_COLORS[preview.sport].accent}}>Model: {pick.modelProb}%</div>}
                  <div style={{fontSize:11,color:'#475569'}}>Conf: {pick.confidence}%</div>
                </div>
              </div>
              <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6,marginBottom:8}}>{pick.reasoning}</div>
              {pick.keyFactors?.length>0&&(
                <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                  {pick.keyFactors.map((f,j)=><span key={j} style={{fontSize:9,background:'rgba(59,130,246,0.15)',color:'#60a5fa',padding:'2px 7px',borderRadius:20,border:'1px solid rgba(59,130,246,0.2)'}}>{f}</span>)}
                </div>
              )}
              <div style={{marginTop:8,fontSize:10,color:'#334155'}}>Stake ${stake} · logs to MY SCRIPTS bankroll</div>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={confirm} style={{flex:2,padding:'12px 0',borderRadius:8,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#000',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
              ✅ LOG ALL {preview.picks.length} PICKS
            </button>
            <button onClick={()=>setPreview(null)} style={{flex:1,padding:'12px 0',borderRadius:8,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:12,fontWeight:700,cursor:'pointer'}}>DISCARD</button>
          </div>
        </div>
      )}

      {!preview&&(
        <div style={{background:'rgba(10,18,35,0.8)',border:'1px solid #1e293b',borderRadius:12,padding:'16px 18px'}}>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:10,color:'#334155',letterSpacing:2,marginBottom:12,textTransform:'uppercase'}}>How It Works</div>
          {[
            ['1','Run your Python script','python mlb_nrfi_v7.py  or  python nhl_v11.py'],
            ['2','Copy full terminal output','Long-press → Select All → Copy'],
            ['3','Pick sport tab above','NHL · MLB · NBA · NFL'],
            ['4','Paste and hit Parse','AI extracts TOP 3 with full breakdowns'],
            ['5','Review each pick','Odds · Model% · Reasoning · 5 key factors'],
            ['6','Confirm → My Scripts','Grade as results come in'],
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
  const [editingStartBankroll, setEditingStartBankroll] = useState(false);
  const [startBankrollInput, setStartBankrollInput] = useState('');
  const [editingMyStartBankroll, setEditingMyStartBankroll] = useState(false);
  const [myStartBankrollInput, setMyStartBankrollInput] = useState('');
  const [myPickModal, setMyPickModal] = useState(null);
  const logEndRef = useRef(null);

  useEffect(()=>{
    const {bankroll,startingBankroll,myBankroll,myStartingBankroll,bets,lessons,sessionLog} = state;
    persist({bankroll,startingBankroll,myBankroll,myStartingBankroll,bets,lessons,sessionLog});
  },[state]);
  useEffect(()=>{ logEndRef.current?.scrollIntoView({behavior:'smooth'}); },[state.sessionLog]);

  const aiBets   = state.bets.filter(b=>b.source==='ai');
  const myBets   = state.bets.filter(b=>b.source==='paste');
  const aiGraded = aiBets.filter(b=>b.result!=='pending');
  const myGraded = myBets.filter(b=>b.result!=='pending');

  const calcROI = graded => {
    const wins=graded.filter(b=>b.result==='win').length;
    const staked=graded.reduce((a,b)=>a+b.stake,0);
    const profit=graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
    return {wins,total:graded.length,staked,profit,roi:staked?profit/staked*100:0,wr:graded.length?wins/graded.length*100:0};
  };
  const aiStats=calcROI(aiGraded), myStats=calcROI(myGraded);

  function addLog(msg) {
    setState(s=>({...s,sessionLog:[...s.sessionLog.slice(-99),{id:uid(),msg,time:Date.now()}]}));
  }

  function saveBankroll() {
    const val=parseFloat(bankrollInput);
    if (!isNaN(val)&&val>0){const r=parseFloat(val.toFixed(2));setState(s=>({...s,bankroll:r}));addLog(`💰 AI bankroll → $${r}`);}
    setEditingBankroll(false);
  }
  function saveMyBankroll() {
    const val=parseFloat(myBankrollInput);
    if (!isNaN(val)&&val>0){const r=parseFloat(val.toFixed(2));setState(s=>({...s,myBankroll:r}));addLog(`💰 My bankroll → $${r}`);}
    setEditingMyBankroll(false);
  }

  const addAIPick = useCallback(pickData=>{
    const bet={id:uid(),pick:pickData.pick||'Unknown',sport:pickData.sport||'NHL',betType:pickData.betType||'Moneyline',betCategory:'straight',odds:parseInt(pickData.odds)||-110,stake:pickData.stake||25,result:'pending',date:new Date().toISOString(),reasoning:pickData.reasoning||'',keyFactors:pickData.keyFactors||[],confidence:pickData.confidence||60,edge:pickData.edge||'',modelProb:pickData.modelProb||null,lesson:null,source:'ai'};
    setState(s=>({...s,bankroll:parseFloat((s.bankroll-bet.stake).toFixed(2)),bets:[bet,...s.bets]}));
    addLog(`🤖 AI: ${bet.pick}`);
  },[]);

  const addMyPick = useCallback(pickData=>{
    const bet={id:uid(),pick:pickData.pick||'Unknown',sport:pickData.sport||'MLB',betType:pickData.betType||'Moneyline',betCategory:pickData.betCategory||'straight',odds:parseInt(pickData.odds)||-110,stake:pickData.stake||25,result:'pending',date:new Date().toISOString(),reasoning:pickData.reasoning||'',keyFactors:pickData.keyFactors||[],confidence:pickData.confidence||60,modelProb:pickData.modelProb||null,rating:pickData.rating||'',edge:pickData.edge||'',legs:pickData.legs||[],lesson:null,source:'paste'};
    setState(s=>({...s,myBankroll:parseFloat((s.myBankroll-bet.stake).toFixed(2)),bets:[bet,...s.bets]}));
    addLog(`📋 My pick: ${bet.pick}`);
  },[]);

  const editMyPick = useCallback(form=>{
    if (!form.id) {
      addMyPick(form);
    } else {
      setState(s=>{
        const old = s.bets.find(b=>b.id===form.id);
        const stakeDiff = (old?.stake||0) - (form.stake||0);
        return {
          ...s,
          myBankroll: parseFloat((s.myBankroll + stakeDiff).toFixed(2)),
          bets: s.bets.map(b=>b.id===form.id?{...b,...form,odds:parseInt(form.odds)||b.odds,stake:parseFloat(form.stake)||b.stake}:b),
        };
      });
      addLog(`✏️ Edited: ${form.pick}`);
    }
    setMyPickModal(null);
  },[addMyPick]);

  const deleteMyPick = useCallback(id=>{
    const bet=state.bets.find(b=>b.id===id);
    if (!bet) return;
    setState(s=>({...s,myBankroll:parseFloat((s.myBankroll+bet.stake).toFixed(2)),bets:s.bets.filter(b=>b.id!==id)}));
    addLog(`🗑 Deleted: ${bet.pick} (stake refunded)`);
  },[state.bets]);

  const confirmPicks = useCallback((picks,sport,stake)=>{
    picks.forEach(p=>addMyPick({pick:p.pick,sport,betType:p.betType||'Moneyline',betCategory:'straight',odds:parseInt(p.odds)||-110,stake,confidence:p.confidence||60,reasoning:p.reasoning||'',keyFactors:p.keyFactors||[],modelProb:p.modelProb||null,rating:p.rating||'',edge:p.edge||'',legs:[]}));
    addLog(`📋 Logged ${picks.length} ${sport} pick(s)`);
    setTab('mine');
  },[addMyPick]);

  const buildHistorySummary = () => {
    const graded = state.bets.filter(b=>b.result!=='pending');
    if (!graded.length) return '';
    const wins=graded.filter(b=>b.result==='win').length;
    const staked=graded.reduce((a,b)=>a+b.stake,0);
    const profit=graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
    const roi=staked?profit/staked*100:0;
    const bySport={};
    graded.forEach(b=>{
      if(!bySport[b.sport])bySport[b.sport]={w:0,l:0};
      if(b.result==='win')bySport[b.sport].w++;
      else if(b.result==='loss')bySport[b.sport].l++;
    });
    const sportStr=Object.entries(bySport).map(([s,v])=>`${s}:${v.w}W-${v.l}L`).join(', ');
    const recent=graded.slice(0,5).map(b=>`${b.pick}(${b.result}${b.score?' '+b.score:''})`).join(', ');
    return `

YOUR BETTING HISTORY (${graded.length} graded bets):
Record: ${wins}W-${graded.length-wins}L | ROI: ${roi.toFixed(1)}% | Net: ${formatMoney(profit)}
By sport: ${sportStr}
Recent: ${recent}
Use this history to adapt your picks — avoid bet types that are losing, favor what's working.`;
  };


  const generatePicks = useCallback(async ()=>{
    setLoading(true);setError('');
    const cfg=SPORT_CONFIG[pickSport];
    addLog(`🔍 Fetching ${pickSport} odds...`);setLoadingMsg('📡 Pulling live odds...');
    let oddsText='';
    try {
      const games=await fetchOdds(cfg.oddsKey,cfg.markets);
      oddsText=formatOddsForClaude(games);
      addLog(`✅ ${games.length} games`);
    } catch(err){oddsText='Live odds unavailable.';addLog(`⚠️ ${err.message}`);}
    const stakeAmount=Math.max(10,Math.round(state.bankroll*0.03/5)*5);
    const history=buildHistorySummary();
    const sys=`You are a sharp sports bettor. Find value bets from these live odds.\nLIVE ODDS:\n${oddsText}${history}\nReturn ONLY a JSON array. Each: {"pick","sport","betType","odds"(integer),"reasoning","keyFactors"(3-5 strings),"confidence"(55-80),"edge"}\nReturn [] if no value. No markdown.${pickContext?`\nFocus: ${pickContext}`:''}`;
    setLoadingMsg('🧠 Finding value...');
    try {
      const raw=await callClaude([{role:'user',content:`Today ${new Date().toLocaleDateString()}. Review ${pickSport} odds, search injuries/news, return best value bets as JSON.`}],sys,true);
      let picks=[];
      const s=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const start=s.indexOf('[');
      if (start!==-1){
        let depth=0,inStr=false,esc=false,end=-1;
        for(let i=start;i<s.length;i++){
          const c=s[i];if(esc){esc=false;continue;}if(c==='\\'&&inStr){esc=true;continue;}if(c==='"'){inStr=!inStr;continue;}if(inStr)continue;
          if(c==='[')depth++;else if(c===']'){depth--;if(depth===0){end=i;break;}}
        }
        if(end!==-1)picks=JSON.parse(s.slice(start,end+1));
      }
      if(!Array.isArray(picks)||picks.length===0){addLog('No strong value found.');setLoadingMsg('');setLoading(false);return;}
      picks.forEach(p=>addAIPick({...p,sport:pickSport,stake:stakeAmount}));
      addLog(`✅ AI placed ${picks.length} pick(s)`);setTab('ai');
    } catch(err){setError('Failed: '+err.message);addLog('❌ '+err.message);}
    setLoadingMsg('');setLoading(false);
  },[pickSport,pickContext,state.bankroll,addAIPick]);

  const gradeBet = useCallback((id,result,score='')=>{
    const bet=state.bets.find(b=>b.id===id);
    if(!bet)return;
    const payout=result==='win'?americanToDecimal(bet.odds)*bet.stake:result==='push'?bet.stake:0;
    const pl=result==='win'?(americanToDecimal(bet.odds)-1)*bet.stake:result==='loss'?-bet.stake:0;
    const key=bet.source==='paste'?'myBankroll':'bankroll';
    setState(s=>({...s,[key]:parseFloat((s[key]+payout).toFixed(2)),bets:s.bets.map(b=>b.id===id?{...b,result,score}:b)}));
    addLog(`Graded: ${bet.pick} → ${result.toUpperCase()}${score?' ('+score+')':''} (${formatMoney(pl)})`);
  },[state.bets]);

  const undoGrade = useCallback((id)=>{
    const bet=state.bets.find(b=>b.id===id);
    if(!bet||bet.result==='pending')return;
    const key=bet.source==='paste'?'myBankroll':'bankroll';
    // gradeBet added: win=full payout, push=stake back, loss=nothing
    // undoGrade must reverse that and restore pending state (stake already out)
    const reversal = bet.result==='win'
      ? -(americanToDecimal(bet.odds)-1)*bet.stake  // remove profit only
      : bet.result==='loss'
      ? bet.stake                                     // refund stake
      : -bet.stake;                                   // push: remove returned stake
    setState(s=>({...s,[key]:parseFloat((s[key]+reversal).toFixed(2)),bets:s.bets.map(b=>b.id===id?{...b,result:'pending',score:''}:b)}));
    addLog(`↩ Undo grade: ${bet.pick} → back to PENDING`);
  },[state.bets]);

  const teachLesson = useCallback(async betId=>{
    const bet=state.bets.find(b=>b.id===betId);if(!bet)return;
    setTeaching(true);setLoadingMsg('🎓 Generating lesson...');
    const pl=bet.result==='win'?(americanToDecimal(bet.odds)-1)*bet.stake:-bet.stake;
    try {
      const lesson=await callClaude([{role:'user',content:`Analyze this ${bet.result} bet:\nPick: ${bet.pick} (${bet.sport}, ${bet.betType})\nOdds: ${formatOdds(bet.odds)} implied ${impliedProb(bet.odds).toFixed(1)}%\nReasoning: ${bet.reasoning}\nResult: ${bet.result} (${formatMoney(pl)})\n\nWas the reasoning sound? What should a sharper bettor do differently? 3-4 sentences.`}],'Sharp betting coach. Direct and specific. Plain text only.',false);
      const card={id:uid(),date:new Date().toISOString(),title:`${bet.result==='win'?'✅':'❌'} ${bet.pick}`,category:bet.sport,body:lesson,takeaway:null,betId};
      setState(s=>({...s,bets:s.bets.map(b=>b.id===betId?{...b,lesson}:b),lessons:[card,...s.lessons]}));
      addLog(`📘 Lesson: ${bet.pick}`);
    } catch(err){setError('Lesson failed: '+err.message);}
    setTeaching(false);setLoadingMsg('');
  },[state.bets]);

  const runReview = useCallback(async ()=>{
    if(aiGraded.length<3){setError('Need at least 3 graded AI bets.');return;}
    setLoading(true);setLoadingMsg('📊 Running review...');
    const summary=aiGraded.slice(0,20).map(b=>({pick:b.pick,sport:b.sport,odds:b.odds,confidence:b.confidence,result:b.result}));
    try {
      const raw=await callClaude([{role:'user',content:`Review ${aiGraded.length} AI bets:\n${JSON.stringify(summary)}\nWR ${aiStats.wr.toFixed(1)}%, ROI ${aiStats.roi.toFixed(1)}%\nReturn ONLY: {"title":"...","category":"AI Review","body":"3-4 sentences","takeaway":"key improvement"}`}],'Professional betting analyst. JSON only, no markdown.',false);
      let review={};
      try{const c=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();const si=c.indexOf('{'),ei=c.lastIndexOf('}');if(si!==-1&&ei!==-1)review=JSON.parse(c.slice(si,ei+1));}catch{}
      setState(s=>({...s,lessons:[{id:uid(),date:new Date().toISOString(),title:review.title||'AI Review',category:'AI Review',body:review.body||raw,takeaway:review.takeaway||null},...s.lessons]}));
      addLog('📊 Review done');setTab('lessons');
    } catch(err){setError('Review failed: '+err.message);}
    setLoading(false);setLoadingMsg('');
  },[aiGraded,aiStats]);

  const resetAll=()=>{if(!confirm('Reset ALL data?'))return;setState({...EMPTY_STATE});};

  const TABS=['dashboard','ai','paste','mine','lessons','log'];
  const TLABELS={dashboard:'📊 Dash',ai:'🤖 AI Bets',paste:'📋 Paste',mine:'📈 My Scripts',lessons:`🎓 (${state.lessons.length})`,log:'🪵 Log'};

  const filterBar=(filter,setFilter)=>(
    <div style={{display:'flex',gap:5,marginBottom:12,flexWrap:'wrap'}}>
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
            <div style={{fontSize:11,color:'#475569',marginTop:3}}>AI picks its own · Paste yours · Head to head v2</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom: editingBankroll||editingMyBankroll?4:14}}>
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px'}}>
              <div style={{fontSize:9,color:'#60a5fa',letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>🤖 AI Bankroll</div>
              <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:22,color:state.bankroll>=state.startingBankroll?'#22c55e':'#ef4444',fontWeight:700,marginTop:2}}>${state.bankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569',marginTop:2}}>start ${state.startingBankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569'}}>{aiBets.filter(b=>b.result==='pending').length} pending</div>
              <button onClick={()=>{setBankrollInput('');setStartBankrollInput('');setEditingBankroll(true);setEditingMyBankroll(false);}} style={{marginTop:6,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #1d4ed844',background:'rgba(29,78,216,.1)',color:'#60a5fa',fontSize:10,fontWeight:700,cursor:'pointer'}}>EDIT</button>
            </div>
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px'}}>
              <div style={{fontSize:9,color:'#f97316',letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>📋 My Scripts</div>
              <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:22,color:state.myBankroll>=state.myStartingBankroll?'#22c55e':'#ef4444',fontWeight:700,marginTop:2}}>${state.myBankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569',marginTop:2}}>start ${state.myStartingBankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569'}}>{myBets.filter(b=>b.result==='pending').length} pending</div>
              <button onClick={()=>{setMyBankrollInput('');setMyStartBankrollInput('');setEditingMyBankroll(true);setEditingBankroll(false);}} style={{marginTop:6,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #f9731644',background:'rgba(249,115,22,.1)',color:'#f97316',fontSize:10,fontWeight:700,cursor:'pointer'}}>EDIT</button>
            </div>
          </div>
          {editingBankroll&&(
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1d4ed844',borderRadius:14,padding:14,marginBottom:14}}>
              <div style={{fontSize:10,color:'#60a5fa',fontWeight:700,marginBottom:10}}>🤖 EDIT AI BANKROLL</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div>
                  <div style={{fontSize:9,color:'#475569',marginBottom:3}}>CURRENT $</div>
                  <div style={{display:'flex',gap:3}}>
                    <input autoFocus type="number" value={bankrollInput} onChange={e=>setBankrollInput(e.target.value)} placeholder={state.bankroll.toFixed(0)} style={{flex:1,background:'#0f172a',border:'1px solid #1d4ed8',borderRadius:6,color:'#f1f5f9',padding:'6px 8px',fontSize:13,width:0}}/>
                    <button onClick={saveBankroll} style={{background:'#1d4ed8',border:'none',borderRadius:6,color:'#fff',padding:'6px 10px',cursor:'pointer',fontSize:11,fontWeight:700}}>SET</button>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,color:'#475569',marginBottom:3}}>START $</div>
                  <div style={{display:'flex',gap:3}}>
                    <input type="number" value={startBankrollInput} onChange={e=>setStartBankrollInput(e.target.value)} placeholder={state.startingBankroll.toFixed(0)} style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#f1f5f9',padding:'6px 8px',fontSize:13,width:0}}/>
                    <button onClick={()=>{setState(s=>({...s,startingBankroll:parseFloat(startBankrollInput)||s.startingBankroll}));setEditingBankroll(false);}} style={{background:'#334155',border:'none',borderRadius:6,color:'#94a3b8',padding:'6px 10px',cursor:'pointer',fontSize:11,fontWeight:700}}>SET</button>
                  </div>
                </div>
              </div>
              <button onClick={()=>setEditingBankroll(false)} style={{marginTop:8,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:'#475569',fontSize:10,cursor:'pointer'}}>DONE</button>
            </div>
          )}
          {editingMyBankroll&&(
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #f9731644',borderRadius:14,padding:14,marginBottom:14}}>
              <div style={{fontSize:10,color:'#f97316',fontWeight:700,marginBottom:10}}>📋 EDIT MY SCRIPTS BANKROLL</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div>
                  <div style={{fontSize:9,color:'#475569',marginBottom:3}}>CURRENT $</div>
                  <div style={{display:'flex',gap:3}}>
                    <input autoFocus type="number" value={myBankrollInput} onChange={e=>setMyBankrollInput(e.target.value)} placeholder={state.myBankroll.toFixed(0)} style={{flex:1,background:'#0f172a',border:'1px solid #f97316',borderRadius:6,color:'#f1f5f9',padding:'6px 8px',fontSize:13,width:0}}/>
                    <button onClick={saveMyBankroll} style={{background:'#f97316',border:'none',borderRadius:6,color:'#000',padding:'6px 10px',cursor:'pointer',fontSize:11,fontWeight:700}}>SET</button>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,color:'#475569',marginBottom:3}}>START $</div>
                  <div style={{display:'flex',gap:3}}>
                    <input type="number" value={myStartBankrollInput} onChange={e=>setMyStartBankrollInput(e.target.value)} placeholder={state.myStartingBankroll.toFixed(0)} style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#f1f5f9',padding:'6px 8px',fontSize:13,width:0}}/>
                    <button onClick={()=>{setState(s=>({...s,myStartingBankroll:parseFloat(myStartBankrollInput)||s.myStartingBankroll}));setEditingMyBankroll(false);}} style={{background:'#334155',border:'none',borderRadius:6,color:'#94a3b8',padding:'6px 10px',cursor:'pointer',fontSize:11,fontWeight:700}}>SET</button>
                  </div>
                </div>
              </div>
              <button onClick={()=>setEditingMyBankroll(false)} style={{marginTop:8,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:'#475569',fontSize:10,cursor:'pointer'}}>DONE</button>
            </div>
          )}
          <div>
          </div>

          {error&&<div style={{background:'#7f1d1d',border:'1px solid #ef4444',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12,color:'#fca5a5',display:'flex',justifyContent:'space-between'}}>{error}<button onClick={()=>setError('')} style={{background:'none',border:'none',color:'#fca5a5',cursor:'pointer',fontSize:14}}>✕</button></div>}
          {(loading||teaching)&&<div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1d4ed8',borderRadius:10,padding:'12px 16px',marginBottom:12,fontSize:13,color:'#60a5fa',animation:'pulse 1.5s infinite',display:'flex',alignItems:'center',gap:10}}><div style={{width:8,height:8,background:'#3b82f6',borderRadius:'50%',flexShrink:0}}/>{loadingMsg||'Working...'}</div>}

          <div style={{display:'flex',gap:2,marginBottom:14,background:'rgba(10,18,35,0.8)',padding:4,borderRadius:10,border:'1px solid #1e293b',overflowX:'auto'}}>
            {TABS.map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:'8px 2px',borderRadius:7,border:'none',cursor:'pointer',background:tab===t?(t==='ai'?'#1d4ed8':t==='paste'||t==='mine'?'#7c2d12':'#1e293b'):'transparent',color:tab===t?'#fff':'#64748b',fontSize:10,fontWeight:700,transition:'all .2s',whiteSpace:'nowrap'}}>{TLABELS[t]}</button>
            ))}
          </div>

          {tab==='dashboard'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
                <StatBox label="AI W/L" value={aiGraded.length?`${aiStats.wins}-${aiStats.total-aiStats.wins}`:'—'} color="#60a5fa"/>
                <StatBox label="AI ROI" value={aiGraded.length?`${aiStats.roi>=0?'+':''}${aiStats.roi.toFixed(0)}%`:'—'} color={aiStats.roi>=0?'#22c55e':'#ef4444'}/>
                <StatBox label="My W/L" value={myGraded.length?`${myStats.wins}-${myStats.total-myStats.wins}`:'—'} color="#f97316"/>
                <StatBox label="My ROI" value={myGraded.length?`${myStats.roi>=0?'+':''}${myStats.roi.toFixed(0)}%`:'—'} color={myStats.roi>=0?'#22c55e':'#ef4444'}/>
              </div>
              <ROIComparison bets={state.bets}/>
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
                <textarea value={pickContext} onChange={e=>setPickContext(e.target.value)} placeholder="Optional: 'road underdogs', 'NRFI only', 'player props'..." style={{width:'100%',background:'#0f172a',border:'1px solid #1e293b',borderRadius:8,color:'#94a3b8',padding:'10px 12px',fontSize:12,resize:'none',height:52,lineHeight:1.5}}/>
              </div>
              <button onClick={runReview} disabled={loading||aiGraded.length<3} style={{width:'100%',padding:'12px 0',borderRadius:10,border:'1px solid #1e40af44',background:'rgba(29,78,216,.1)',color:aiGraded.length>=3?'#60a5fa':'#475569',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:14}}>
                📊 AI PERFORMANCE REVIEW {aiGraded.length<3?`(${3-aiGraded.length} more needed)`:''}
              </button>
            </div>
          )}

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
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>🤖</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO AI BETS YET</div><div style={{fontSize:12,marginTop:6}}>Dashboard → Find Value</div></div>
                :aiBets.filter(b=>aiFilter==='all'||b.result===aiFilter).map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} onUndoGrade={undoGrade} teaching={teaching} allowEdit={false}/>)
              }
            </div>
          )}

          {tab==='paste'&&<PasteTab onConfirmPicks={confirmPicks} callClaude={callClaude}/>}

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
              <div style={{display:'flex',gap:6,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
                {['all','pending','win','loss','push'].map(r=>(
                  <button key={r} onClick={()=>setMyFilter(r)} style={{padding:'5px 10px',borderRadius:6,border:'none',cursor:'pointer',background:myFilter===r?'#7c2d12':'#1e293b',color:myFilter===r?'#fb923c':'#64748b',fontSize:10,fontWeight:700,textTransform:'uppercase'}}>{r}</button>
                ))}
                <button onClick={()=>setMyPickModal('new')} style={{marginLeft:'auto',padding:'6px 12px',borderRadius:6,border:'1px solid #f9731644',background:'rgba(249,115,22,0.1)',color:'#f97316',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>+ ADD BET</button>
              </div>
              {myBets.filter(b=>myFilter==='all'||b.result===myFilter).length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>📋</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO SCRIPT PICKS YET</div><div style={{fontSize:12,marginTop:6}}>Go to 📋 Paste to import from your model</div></div>
                :myBets.filter(b=>myFilter==='all'||b.result===myFilter).map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} onDelete={deleteMyPick} onEdit={b=>setMyPickModal(b)} onUndoGrade={undoGrade} teaching={teaching} allowEdit={true}/>)
              }
            </div>
          )}

          {tab==='lessons'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              {state.lessons.length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>🎓</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO LESSONS YET</div><div style={{fontSize:12,marginTop:6}}>Grade AI bets → Analyze This Bet</div></div>
                :state.lessons.map(l=><LessonCard key={l.id} lesson={l}/>)
              }
            </div>
          )}

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

      {myPickModal&&(
        <MyPickModal
          existing={myPickModal==='new'?null:myPickModal}
          onSave={editMyPick}
          onClose={()=>setMyPickModal(null)}
        />
      )}
    </>
  );
}
// Mon Apr 13 17:35:05 CDT 2026
