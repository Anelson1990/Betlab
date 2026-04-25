// src/App.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchOdds, callClaude } from './api.js';
import { SPORT_CONFIG, SPORTS, formatOddsForClaude } from './sportsMap.js';
import { runSim, getSimConfidence, calcTuningParams } from './simEngine.js';
import { analyzeSimTuning, analyzeBetTypePerf, analyzeConfTiers, getBettingInsights, shouldRetune, buildTuningPrompt, getCalibrationFilter, applyCalibrationToConfidence, getDynamicConfidenceAdjustment, analyzeReasoningPatterns } from './tuningEngine.js';
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

function BetCard({ bet, onGrade, onTeach, onDelete, onEdit, onUndoGrade, onTail, teaching, allowEdit, bankroll=1000 }) {
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
  const isAI = bet.source==='ai' || bet.source==='groq';
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
          {bet.simConfidence&&(
            <div style={{marginTop:4,padding:'4px 8px',background:'rgba(251,191,36,0.05)',borderRadius:4,border:'1px solid rgba(251,191,36,0.2)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:9,color:'#fbbf24',fontWeight:700,letterSpacing:1}}>🎲 MC SIM</span>
              <span style={{fontSize:11,color:'#fbbf24',fontWeight:700}}>{bet.simConfidence}%</span>
            </div>
          )}
          {bet.simResult&&(
            <div style={{marginTop:2,display:'flex',gap:4,flexWrap:'wrap'}}>
              {bet.simResult.homeWinProb!=null&&<span style={{fontSize:9,color:'#475569'}}>Home {bet.simResult.homeWinProb}%</span>}
              {bet.simResult.awayWinProb!=null&&<span style={{fontSize:9,color:'#475569'}}>Away {bet.simResult.awayWinProb}%</span>}
              {bet.simResult.overProb!=null&&<span style={{fontSize:9,color:'#475569'}}>O {bet.simResult.overProb}%</span>}
              {bet.simResult.underProb!=null&&<span style={{fontSize:9,color:'#475569'}}>U {bet.simResult.underProb}%</span>}
              {bet.simResult.nrfiProb!=null&&<span style={{fontSize:9,color:'#475569'}}>NRFI {bet.simResult.nrfiProb}%</span>}
            </div>
          )}
          {bet.weather&&bet.weather.source&&(
            <div style={{marginTop:4,fontSize:10,color:'#64748b'}}>
              🌤 {bet.weather.temp_f}°F · {bet.weather.wind_mph}mph wind
              {bet.weather.notes?.[0]&&<span style={{color:'#fbbf24'}}> · {bet.weather.notes[0]}</span>}
            </div>
          )}
          {bet.official&&<div style={{marginTop:4,padding:'4px 8px',background:'rgba(56,189,248,0.05)',borderRadius:4,border:'1px solid rgba(56,189,248,0.15)'}}>
            <span style={{fontSize:9,color:'#38bdf8',fontWeight:700}}>👨‍⚖️ </span>
            <span style={{fontSize:10,color:'#64748b'}}>{bet.official.name} — {bet.official.tendency}</span>
            {bet.official.impact&&<span style={{fontSize:10,color:'#fbbf24'}}> · {bet.official.impact}</span>}
          </div>}
          {bet.opponent&&<div style={{marginTop:4,padding:'4px 8px',background:'rgba(167,139,250,0.05)',borderRadius:4,border:'1px solid rgba(167,139,250,0.15)'}}>
            <span style={{fontSize:9,color:'#a78bfa',fontWeight:700}}>⚔️ </span>
            <span style={{fontSize:10,color:'#64748b'}}>{bet.opponent.quality} · {bet.opponent.keyStats}</span>
          </div>}
          {bet.restTravel&&(bet.restTravel.backToBack||bet.restTravel.travelNote)&&<div style={{marginTop:4,padding:'4px 8px',background:'rgba(34,197,94,0.05)',borderRadius:4,border:'1px solid rgba(34,197,94,0.15)'}}>
            <span style={{fontSize:9,color:'#22c55e',fontWeight:700}}>😴 </span>
            <span style={{fontSize:10,color:'#64748b'}}>{bet.restTravel.restDays!=null?`${bet.restTravel.restDays}d rest`:''}{bet.restTravel.backToBack?' · B2B':''}{bet.restTravel.travelNote?` · ${bet.restTravel.travelNote}`:''}</span>
          </div>}
          {bet.modelProb&&bet.result==='pending'&&(()=>{
            const p=parseFloat(bet.modelProb)/100;
            const dec=bet.odds>0?bet.odds/100+1:100/Math.abs(bet.odds)+1;
            const imp=1/dec;
            const edge=p-imp;
            const kelly=edge>0?((dec-1)*p-(1-p))/(dec-1)*0.25*100:0;
            if(edge<=0) return null;
            const bankrollForKelly = bet.source==='paste'?null:null; // accessed via closure not available here
            const kellyDollars = (kelly/100*bankroll).toFixed(0);
            return <div style={{marginTop:4,padding:'4px 8px',background:'rgba(34,197,94,0.05)',borderRadius:4,border:'1px solid rgba(34,197,94,0.15)'}}>
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <span style={{fontSize:10,color:'#22c55e'}}>Edge: +{(edge*100).toFixed(1)}%</span>
                <span style={{fontSize:10,color:'#22c55e'}}>Kelly: {kelly.toFixed(1)}% · ${kellyDollars}</span>
              </div>
            </div>;
          })()}
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

      {(allowEdit||onDelete)&&(
        <div style={{display:'flex',gap:6,marginTop:6}}>
          {allowEdit&&onEdit&&<button onClick={()=>onEdit(bet)} style={{flex:1,padding:'5px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:'#64748b',fontSize:10,fontWeight:700,cursor:'pointer'}}>✏️ EDIT</button>}
          {bet.result==='pending'&&onDelete&&(!confirmDelete
            ?<button onClick={()=>setConfirmDelete(true)} style={{flex:1,padding:'5px 0',borderRadius:6,border:'1px solid #7f1d1d44',background:'transparent',color:'#ef444488',fontSize:10,fontWeight:700,cursor:'pointer'}}>🗑 DELETE</button>
            :<button onClick={()=>onDelete(bet.id)} style={{flex:1,padding:'5px 0',borderRadius:6,border:'none',background:'#7f1d1d',color:'#fca5a5',fontSize:10,fontWeight:700,cursor:'pointer'}}>CONFIRM DELETE</button>
          )}
        </div>
      )}

      {isAI&&bet.result==='pending'&&onTail&&(
        <button onClick={()=>onTail(bet)} style={{width:'100%',marginTop:8,padding:'7px 0',borderRadius:6,border:'1px solid #22c55e44',background:'rgba(34,197,94,0.1)',color:'#22c55e',fontSize:11,fontWeight:700,cursor:'pointer',letterSpacing:1,textTransform:'uppercase'}}>
          🐍 TAIL THIS BET
        </button>
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
            <button onClick={()=>onTeach(bet)} disabled={teaching} style={{flex:1,padding:'7px 0',borderRadius:6,border:'1px solid #334155',background:'transparent',color:teaching?'#334155':'#60a5fa',fontSize:11,fontWeight:700,cursor:teaching?'not-allowed':'pointer',letterSpacing:1,textTransform:'uppercase'}}>
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

function ROIComparison({ bets, bankroll, startingBankroll, myBankroll, myStartingBankroll, groqBankroll, groqStartingBankroll }) {
  const aiGraded=bets.filter(b=>b.source==='ai'&&b.result!=='pending');
  const myGraded=bets.filter(b=>b.source==='paste'&&b.result!=='pending');
  const groqGraded=bets.filter(b=>b.source==='groq'&&b.result!=='pending');
  const aiWins=aiGraded.filter(b=>b.result==='win').length;
  const myWins=myGraded.filter(b=>b.result==='win').length;
  const groqWins=groqGraded.filter(b=>b.result==='win').length;
  const aiStaked=aiGraded.reduce((a,b)=>a+b.stake,0);
  const myStaked=myGraded.reduce((a,b)=>a+b.stake,0);
  const groqStaked=groqGraded.reduce((a,b)=>a+b.stake,0);
  const aiPnL=bankroll-startingBankroll;
  const myPnL=myBankroll-myStartingBankroll;
  const groqPnL=groqBankroll-groqStartingBankroll;
  const aiROI=aiStaked?aiPnL/aiStaked*100:0;
  const myROI=myStaked?myPnL/myStaked*100:0;
  const groqROI=groqStaked?groqPnL/groqStaked*100:0;
  const roiC=v=>v>5?'#22c55e':v>0?'#86efac':v>-5?'#fbbf24':'#f87171';
  const leader = aiROI>=groqROI&&aiROI>=myROI?'ai':myROI>=aiROI&&myROI>=groqROI?'my':'groq';
  return (
    <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#1d4ed8',letterSpacing:2,marginBottom:14,textTransform:'uppercase'}}>📊 Head to Head</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
        <div style={{borderRight:'1px solid #1e293b',paddingRight:8}}>
          <div style={{fontSize:9,color:'#60a5fa',letterSpacing:1,marginBottom:6,fontWeight:700}}>🤖 CLAUDE</div>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:aiPnL>=0?'#22c55e':'#ef4444',fontWeight:700}}>{formatMoney(aiPnL)}</div>
          <div style={{fontSize:9,color:'#475569',marginBottom:4}}>vs ${startingBankroll} start</div>
          {aiGraded.length>0?<>
            <div style={{fontSize:11,color:roiC(aiROI),fontWeight:700}}>ROI {aiROI>=0?'+':''}{aiROI.toFixed(1)}%</div>
            <div style={{fontSize:10,color:'#64748b'}}>{aiWins}W-{aiGraded.length-aiWins}L</div>
          </>:<div style={{fontSize:10,color:'#334155'}}>No picks yet</div>}
        </div>
        <div style={{borderRight:'1px solid #1e293b',paddingLeft:4,paddingRight:4}}>
          <div style={{fontSize:9,color:'#8b5cf6',letterSpacing:1,marginBottom:6,fontWeight:700}}>🧠 GROQ</div>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:groqPnL>=0?'#22c55e':'#ef4444',fontWeight:700}}>{formatMoney(groqPnL)}</div>
          <div style={{fontSize:9,color:'#475569',marginBottom:4}}>vs ${groqStartingBankroll} start</div>
          {groqGraded.length>0?<>
            <div style={{fontSize:11,color:roiC(groqROI),fontWeight:700}}>ROI {groqROI>=0?'+':''}{groqROI.toFixed(1)}%</div>
            <div style={{fontSize:10,color:'#64748b'}}>{groqWins}W-{groqGraded.length-groqWins}L</div>
          </>:<div style={{fontSize:10,color:'#334155'}}>No picks yet</div>}
        </div>
        <div style={{paddingLeft:8}}>
          <div style={{fontSize:9,color:'#f97316',letterSpacing:1,marginBottom:6,fontWeight:700}}>📋 MY PICKS</div>
          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:myPnL>=0?'#22c55e':'#ef4444',fontWeight:700}}>{formatMoney(myPnL)}</div>
          <div style={{fontSize:9,color:'#475569',marginBottom:4}}>vs ${myStartingBankroll} start</div>
          {myGraded.length>0?<>
            <div style={{fontSize:11,color:roiC(myROI),fontWeight:700}}>ROI {myROI>=0?'+':''}{myROI.toFixed(1)}%</div>
            <div style={{fontSize:10,color:'#64748b'}}>{myWins}W-{myGraded.length-myWins}L</div>
          </>:<div style={{fontSize:10,color:'#334155'}}>No picks yet</div>}
        </div>
      </div>
      <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #1e293b',fontSize:11,fontWeight:700,textAlign:'center',color:leader==='ai'?'#60a5fa':leader==='groq'?'#8b5cf6':'#f97316'}}>
        {leader==='ai'?`🤖 Claude leading`:leader==='groq'?`🧠 Groq leading`:`📋 Your picks leading`} · Best ROI: {Math.max(aiROI,groqROI,myROI).toFixed(1)}%
      </div>
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
            <div style={{display:'flex',gap:3,alignItems:'center'}}>
              <button onClick={()=>setForm(f=>({...f,odds:-Math.abs(f.odds)}))} style={{width:36,height:36,borderRadius:8,border:'1px solid #334155',background:form.odds<0?'#7f1d1d':'#1e293b',color:form.odds<0?'#fca5a5':'#64748b',fontSize:18,fontWeight:700,cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
              <div style={{flex:1,textAlign:'center',fontFamily:"'Orbitron',sans-serif",fontSize:16,color:form.odds<0?'#fca5a5':'#86efac',padding:'8px 4px',background:'#0f172a',borderRadius:8,border:'1px solid #334155'}}>
                {form.odds>0?'+':''}{form.odds}
              </div>
              <button onClick={()=>setForm(f=>({...f,odds:Math.abs(f.odds)}))} style={{width:36,height:36,borderRadius:8,border:'1px solid #334155',background:form.odds>0?'#14532d':'#1e293b',color:form.odds>0?'#86efac':'#64748b',fontSize:18,fontWeight:700,cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
            </div>
            <input type="number" style={{...inp(),width:'100%',marginTop:4}} value={Math.abs(form.odds)} onChange={e=>setForm(f=>({...f,odds:f.odds<0?-Math.abs(+e.target.value):Math.abs(+e.target.value)}))} placeholder="e.g. 110"/>
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
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [stake, setStake] = useState(25);
  const [verifying, setVerifying] = useState(false);
  const [verifications, setVerifications] = useState({});
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
        const top = picks.slice(0,3);
        setPreview({sport:activeSport,picks:top});
        setSelected(top.map((_,i)=>i));
      }
    } catch(e) { setError('Parse failed: '+e.message); }
    setParsing(false);
  };

  const verifyPicks = async () => {
    if (!preview) return;
    setVerifying(true);
    const sport = preview.sport;
    const sportGuides = {
      MLB: 'Check: starting pitcher confirmed + recent ERA/WHIP, umpire zone tendencies (over/under rate), weather (wind direction/speed affects NRFI), lineup injuries, line movement since open. For NRFI picks focus on pitcher strikeout rates and first inning history.',
      NHL: 'Check: confirmed goalie starters, back-to-back situations, recent form last 5 games, key injuries, power play and penalty kill rates, home/away splits, line movement.',
      NBA: 'Check: injury report (stars sitting?), back-to-back, pace of play matchup, defensive ratings, recent scoring trends, rest advantage, line movement.',
      NFL: 'Check: injury report (QB, WR, OL), weather forecast (wind/rain/snow affects totals), referee crew tendencies, line movement, public vs sharp split, divisional game dynamics.',
    };
    const newVerifs = {};
    for (const pick of preview.picks) {
      try {
        const raw = await callClaude([{role:'user',content:`You are an independent sharp sports betting analyst. Do NOT look at the model probability yet.

PICK TO VERIFY: ${pick.pick}
SPORT: ${sport}
BET TYPE: ${pick.betType}
MODEL SAYS: ${pick.recommendation} at ${pick.modelProb}% probability, odds ${pick.odds}

YOUR JOB: Use web search to independently research this matchup RIGHT NOW. ${sportGuides[sport]}

After your research, return ONLY this JSON:
{
  "verdict": "AGREE" or "DISAGREE" or "CAUTION",
  "confidence": 1-10,
  "summary": "2-3 sentences of what you found",
  "key_findings": ["3-4 specific facts you found from web search"],
  "edge_assessment": "Is there real edge here? Why or why not?",
  "risk_flags": ["any red flags found"],
  "independent_prob": "your own estimated probability % as a number"
}`}],
        `You are an elite independent sports betting analyst. Always use web search to find current data before giving verdict. Be brutally honest. JSON only.`,
        true // use web search
      );
      let v={verdict:'UNKNOWN',summary:'Could not verify',key_findings:[],risk_flags:[]};
      try{const c=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();const s=c.indexOf('{'),e=c.lastIndexOf('}');if(s!==-1&&e!==-1)v=JSON.parse(c.slice(s,e+1));}catch{}
      newVerifs[pick.pick]=v;
      } catch(err){ newVerifs[pick.pick]={verdict:'UNKNOWN',summary:'Search failed: '+err.message,key_findings:[],risk_flags:[]}; }
    }
    setVerifications(newVerifs);
    setVerifying(false);
  };

  const confirm = () => {
    if (!preview) return;
    const picksToLog = preview.picks.filter((_,i)=>selected.includes(i));
    if (!picksToLog.length) { setError('Select at least one pick.'); return; }
    onConfirmPicks(picksToLog, preview.sport, stake);
    setPreview(null);
    setSelected([]);
    setVerifications({});
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
            <div key={i} style={{background:selected.includes(i)?'rgba(5,8,16,0.9)':'rgba(5,8,16,0.4)',border:`1px solid ${selected.includes(i)?SPORT_COLORS[preview.sport].border:'#1e293b'}`,borderRadius:10,padding:14,marginBottom:10,opacity:selected.includes(i)?1:0.5}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    <input type="checkbox" checked={selected.includes(i)} onChange={()=>setSelected(s=>s.includes(i)?s.filter(x=>x!==i):[...s,i])} style={{width:16,height:16,cursor:'pointer',accentColor:SPORT_COLORS[preview.sport].accent}}/>
                    <div style={{fontSize:10,color:SPORT_COLORS[preview.sport].accent,fontWeight:700}}>#{i+1} PICK</div>
                  </div>
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
              {pick.official&&<div style={{marginTop:6,padding:'6px 10px',background:'rgba(56,189,248,0.05)',borderRadius:6,border:'1px solid rgba(56,189,248,0.15)'}}>
                <div style={{fontSize:9,color:'#38bdf8',fontWeight:700,marginBottom:2}}>👨‍⚖️ OFFICIAL</div>
                <div style={{fontSize:11,color:'#94a3b8'}}>{pick.official.name} · {pick.official.tendency}</div>
                {pick.official.impact&&<div style={{fontSize:10,color:'#fbbf24',marginTop:2}}>{pick.official.impact}</div>}
              </div>}
              {pick.opponent&&<div style={{marginTop:6,padding:'6px 10px',background:'rgba(167,139,250,0.05)',borderRadius:6,border:'1px solid rgba(167,139,250,0.15)'}}>
                <div style={{fontSize:9,color:'#a78bfa',fontWeight:700,marginBottom:2}}>⚔️ OPPONENT</div>
                <div style={{fontSize:11,color:'#94a3b8'}}>{pick.opponent.quality} · {pick.opponent.rating}</div>
                {pick.opponent.keyStats&&<div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{pick.opponent.keyStats}</div>}
              </div>}
              {pick.restTravel&&<div style={{marginTop:6,padding:'6px 10px',background:'rgba(34,197,94,0.05)',borderRadius:6,border:'1px solid rgba(34,197,94,0.15)'}}>
                <div style={{fontSize:9,color:'#22c55e',fontWeight:700,marginBottom:2}}>😴 REST & TRAVEL</div>
                <div style={{fontSize:11,color:'#94a3b8'}}>{pick.restTravel.restDays!=null?`${pick.restTravel.restDays} rest days`:''}{pick.restTravel.backToBack?' · Back-to-back':''}{pick.restTravel.travelNote?` · ${pick.restTravel.travelNote}`:''}</div>
              </div>}
              <div style={{marginTop:8,fontSize:10,color:'#334155'}}>Stake ${stake} · logs to MY PICKS bankroll</div>
            </div>
          ))}
          <button onClick={verifyPicks} disabled={verifying} style={{width:'100%',padding:'12px 0',borderRadius:10,border:'1px solid #a78bfa44',background:verifying?'#1e293b':'rgba(167,139,250,0.1)',color:verifying?'#475569':'#a78bfa',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1,cursor:verifying?'not-allowed':'pointer',marginBottom:8}}>
            {verifying?'🔍 SEARCHING LIVE DATA...':'🔍 AI VERIFY WITH LIVE DATA'}
          </button>

          {Object.keys(verifications).length>0&&(
            <div style={{marginBottom:10}}>
              {preview.picks.map((pick,i)=>{
                const v=verifications[pick.pick];
                if(!v) return null;
                const vc=v.verdict==='AGREE'?'#22c55e':v.verdict==='DISAGREE'?'#ef4444':'#fbbf24';
                return (
                  <div key={i} style={{padding:'10px 12px',background:`rgba(${v.verdict==='AGREE'?'34,197,94':v.verdict==='DISAGREE'?'239,68,68':'251,191,36'},0.05)`,borderRadius:8,border:`1px solid ${vc}33`,marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:700}}>{pick.pick}</div>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        {v.independent_prob&&<span style={{fontSize:10,color:'#64748b'}}>AI: {v.independent_prob}%</span>}
                        <span style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:vc,fontWeight:700,padding:'2px 8px',borderRadius:4,border:`1px solid ${vc}44`,background:`${vc}11`}}>{v.verdict}</span>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:'#94a3b8',marginBottom:6,lineHeight:1.5}}>{v.summary}</div>
                    {v.key_findings?.length>0&&(
                      <div style={{marginBottom:4}}>
                        {v.key_findings.map((f,j)=><div key={j} style={{fontSize:10,color:'#64748b',marginBottom:2}}>• {f}</div>)}
                      </div>
                    )}
                    {v.risk_flags?.length>0&&v.risk_flags[0]&&(
                      <div style={{marginTop:4}}>
                        {v.risk_flags.map((f,j)=><div key={j} style={{fontSize:10,color:'#fbbf24',marginBottom:2}}>⚠️ {f}</div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={confirm} style={{flex:2,padding:'12px 0',borderRadius:8,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#000',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
              ✅ LOG {selected.length} OF {preview.picks.length} PICKS
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
            ['6','Confirm → My Picks','Grade as results come in'],
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

const JSONBIN_MASTER_KEY = '$2a$10$OgNCQZvgTz/DoMEzXLkBRu8m.1M0fsZT55WDrZxc5dnYU8WE/EV3u';

function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [pickSport, setPickSport] = useState('NHL');
  const [groqSport, setGroqSport] = useState('NHL');
  const [preLog, setPreLog] = useState([]);
  const [preLogInput, setPreLogInput] = useState({pick:'',sport:'NHL',betType:'Moneyline',odds:'',stake:'10',notes:''});
  const [preLogLoading, setPreLogLoading] = useState(null);
  const [tuningLog, setTuningLog] = useState([]);
  const [lastTuneCount, setLastTuneCount] = useState(0);
  const [showTuning, setShowTuning] = useState(false);
  const [groqGames, setGroqGames] = useState([]);
  const [groqLoading, setGroqLoading] = useState(false);
  const [groqAnalyzing, setGroqAnalyzing] = useState(null);
  const [groqResults, setGroqResults] = useState({});
  const [pickContext, setPickContext] = useState('');
  const [aiFilter, setAiFilter] = useState('all');
  const [myFilter, setMyFilter] = useState('all');
  const [editingBankroll, setEditingBankroll] = useState(false);
  const [bankrollInput, setBankrollInput] = useState('');
  const [editingMyBankroll, setEditingMyBankroll] = useState(false);
  const [editingGroqBankroll, setEditingGroqBankroll] = useState(false);
  const [groqBankrollInput, setGroqBankrollInput] = useState('');
  const [myBankrollInput, setMyBankrollInput] = useState('');
  const [editingStartBankroll, setEditingStartBankroll] = useState(false);
  const [startBankrollInput, setStartBankrollInput] = useState('');
  const [editingMyStartBankroll, setEditingMyStartBankroll] = useState(false);
  const [myStartBankrollInput, setMyStartBankrollInput] = useState('');
  const [myPickModal, setMyPickModal] = useState(null);
  const [coachReport, setCoachReport] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [trackerSport, setTrackerSport] = useState('MLB');
  const [trackerPaste, setTrackerPaste] = useState('');
  const [trackerParsing, setTrackerParsing] = useState(false);
  const [trackerError, setTrackerError] = useState('');
  const [trackerAnalysis, setTrackerAnalysis] = useState('');
  const [trackerAnalyzing, setTrackerAnalyzing] = useState(false);
  const [manualTrack, setManualTrack] = useState({sport:'MLB',pick:'',modelProb:'',odds:-110,rating:'',result:'pending',score:''});
  const [showManualTrack, setShowManualTrack] = useState(false);
  const logEndRef = useRef(null);

  const driveThrottle = useRef(null);
  useEffect(()=>{
    const {bankroll,startingBankroll,myBankroll,myStartingBankroll,bets,lessons,sessionLog,trackedPicks} = state;
    const toSave = {bankroll,startingBankroll,myBankroll,myStartingBankroll,
    bets:bets.slice(0,150),
    lessons:lessons.slice(0,30),
    sessionLog:sessionLog.slice(0,50),
    trackedPicks:trackedPicks.slice(0,100)};
    persist(toSave);
    // Auto-save to Drive every 30 seconds max
    if (driveThrottle.current) clearTimeout(driveThrottle.current);
    driveThrottle.current = setTimeout(()=>saveToDrive(toSave), 30000);
  },[state]);

  // Load from Drive on first open
  useEffect(()=>{
    loadFromDrive();
  },[]);
  useEffect(()=>{ logEndRef.current?.scrollIntoView({behavior:'smooth'}); },[state.sessionLog]);

  const aiBets   = state.bets.filter(b=>b.source==='ai');
  const myBets   = state.bets.filter(b=>b.source==='paste');
  const [groqFilter, setGroqFilter] = useState('all');
  const groqBets = state.bets.filter(b=>b.source==='groq');
  const aiGraded = aiBets.filter(b=>b.result!=='pending');
  const myGraded = myBets.filter(b=>b.result!=='pending');
  const groqGraded = groqBets.filter(b=>b.result!=='pending');

  const computedGroqBankroll = (() => {
    const pendingStaked = groqBets.filter(b=>b.result==='pending').reduce((a,b)=>a+b.stake,0);
    const pnl = groqGraded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
    return parseFloat((state.groqStartingBankroll - pendingStaked + pnl).toFixed(2));
  })();

  const calcROI = graded => {
    const wins=graded.filter(b=>b.result==='win').length;
    const staked=graded.reduce((a,b)=>a+b.stake,0);
    const profit=graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
    return {wins,total:graded.length,staked,profit,roi:staked?profit/staked*100:0,wr:graded.length?wins/graded.length*100:0};
  };
  const aiStats=calcROI(aiGraded), myStats=calcROI(myGraded);

  // Streak tracker - auto calculated
  const calcStreak = (bets) => {
    const graded = [...bets].filter(b=>b.result!=='pending').sort((a,b)=>new Date(b.date)-new Date(a.date));
    if (!graded.length) return {current:0,type:'none',longest_win:0,longest_loss:0};
    let current=1, type=graded[0].result==='win'?'win':'loss';
    for (let i=1;i<graded.length;i++) {
      if(graded[i].result===graded[0].result) current++;
      else break;
    }
    let lw=0,ll=0,cw=0,cl=0;
    graded.forEach(b=>{
      if(b.result==='win'){cw++;cl=0;lw=Math.max(lw,cw);}
      else if(b.result==='loss'){cl++;cw=0;ll=Math.max(ll,cl);}
    });
    return {current,type,longest_win:lw,longest_loss:ll};
  };
  const aiStreak = calcStreak(aiBets);
  const myStreak = calcStreak(myBets);

  // Discipline tracker - compares model recommendations vs what was logged
  const calcDiscipline = () => {
    const modelPicks = state.trackedPicks.filter(p=>p.result!=='pending');
    const myGradedPicks = myBets.filter(b=>b.result!=='pending');
    if (!modelPicks.length || !myGradedPicks.length) return null;
    // Find picks where model said STRONG but user didn't take
    const strongModelPicks = modelPicks.filter(p=>p.rating&&(p.rating.includes('STRONG')||p.rating.includes('T1')));
    const takenStrong = strongModelPicks.filter(sp=>
      myGradedPicks.some(mp=>mp.pick.toLowerCase().includes(sp.pick.toLowerCase().slice(0,10)))
    );
    const skippedStrong = strongModelPicks.length - takenStrong.length;
    // Win rates
    const modelWR = modelPicks.length?modelPicks.filter(p=>p.result==='win').length/modelPicks.length*100:0;
    const myWR = myGradedPicks.length?myGradedPicks.filter(b=>b.result==='win').length/myGradedPicks.length*100:0;
    return {modelWR,myWR,strongModelPicks:strongModelPicks.length,skippedStrong,takenStrong:takenStrong.length};
  };
  const discipline = calcDiscipline();

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

  const analyzeGroqPick = useCallback(async (bet)=>{
    setTeaching(bet.id);
    try {
      const impliedProb = bet.odds > 0 ? Math.round(100/(bet.odds+100)*100) : Math.round(Math.abs(bet.odds)/(Math.abs(bet.odds)+100)*100);
      const wasOverconfident = bet.confidence > impliedProb + 10;
      const isPlayoff = bet.reasoning?.toLowerCase().includes('playoff')||bet.reasoning?.toLowerCase().includes('series');
      const sys = `You are a sharp betting coach reviewing a graded bet. Be brutally honest.
Tag your response with ONE category: [WRONG_PITCHER] [WRONG_GOALIE] [IGNORED_INJURIES] [OVERCONFIDENT] [BAD_SPOT] [PLAYOFF_MISTAKE] [GOOD_PROCESS] [LUCKY_WIN]
Then give 2-3 sentences on what specifically went wrong or right and what to do differently.`;
      const msg = `Bet: ${bet.pick} (${bet.sport} ${bet.betType})
Odds: ${bet.odds>0?'+':''}${bet.odds} | Result: ${bet.result?.toUpperCase()} | Confidence: ${bet.confidence}% | Market implied: ${impliedProb}%
Overconfident vs market: ${wasOverconfident?'YES by '+(bet.confidence-impliedProb)+'%':'no'} | Playoff game: ${isPlayoff?'YES':'no'}
Reasoning: ${bet.reasoning?.slice(0,400)||'none'}
Key factors cited: ${bet.keyFactors?.join(', ')||'none'}
Sim confidence: ${bet.simConfidence||'N/A'}%`;
      const raw = await callClaude([{role:'user',content:msg}], sys, false);
      const tag = raw.match(/\[([A-Z_]+)\]/)?.[1]||'ANALYSIS';
      const lesson = {
        id:uid(), date:new Date().toISOString().split('T')[0],
        sport:bet.sport, pick:bet.pick, result:bet.result,
        lesson:raw, source:'groq',
        category:tag,
        title:`${bet.pick} — ${bet.result?.toUpperCase()}`,
        body:raw.replace(/\[[A-Z_]+\]/,'').trim(),
        takeaway:raw.split('.')[0].replace(/\[[A-Z_]+\]/,'').trim(),
      };
      setState(s=>({...s, lessons:[lesson,...s.lessons], bets:s.bets.map(b=>b.id===bet.id?{...b,lesson:raw}:b)}));
      addLog(`🧠 Groq pick analyzed`);
    } catch(e) { addLog('❌ Analyze failed: '+e.message); }
    setTeaching(null);
  },[]);

  const tailGroqPick = useCallback((bet)=>{
    const newBet = {
      id:uid(), pick:bet.pick, sport:bet.sport, betType:bet.betType,
      betCategory:'straight', odds:bet.odds, stake:bet.stake,
      result:'pending', date:new Date().toISOString(),
      reasoning:'TAIL: '+bet.reasoning, keyFactors:bet.keyFactors||[],
      confidence:bet.confidence, edge:bet.edge, modelProb:bet.modelProb,
      lesson:null, source:'paste',
    };
    setState(s=>({...s, myBankroll:parseFloat((s.myBankroll-newBet.stake).toFixed(2)), bets:[newBet,...s.bets]}));
    addLog(`🐍 Tailed Groq pick: ${bet.pick}`);
    setTab('mine');
  },[]);


  const addGroqPick = useCallback(pickData=>{
    // Apply calibration filter for Groq
    const groqGradedBets = state.bets.filter(b=>b.result!=='pending'&&b.tracked&&b.source==='groq');
    const groqCalibFilter = getCalibrationFilter(groqGradedBets);
    const groqCalibResult = applyCalibrationToConfidence(pickData.confidence||60, groqCalibFilter);
    
    if (groqCalibResult.blocked) {
      addLog(`🚫 GROQ BLOCKED: ${pickData.pick} — confidence tier below break-even`);
      return;
    }
    if (groqCalibResult.warning) addLog(groqCalibResult.warning);

    const bet={id:uid(),pick:pickData.pick||'Unknown',sport:pickData.sport||'NHL',betType:pickData.betType||'Moneyline',betCategory:'straight',odds:parseInt(pickData.odds)||-110,stake:pickData.stake||10,result:'pending',date:new Date().toISOString(),reasoning:pickData.reasoning||'',keyFactors:pickData.keyFactors||[],confidence:groqCalibResult.confidence||60,edge:pickData.edge||'',modelProb:pickData.modelProb||null,lesson:null,source:'groq',simConfidence:pickData.simConfidence||null,simResult:pickData.simResult||null,tracked:true};
    setState(s=>({...s,groqBankroll:parseFloat((s.groqBankroll-bet.stake).toFixed(2)),bets:[bet,...s.bets]}));
    addLog(`🧠 Groq pick: ${bet.pick}`);
  },[]);

  const addAIPick = useCallback(pickData=>{
    // Apply calibration filter
    const gradedBets = state.bets.filter(b=>b.result!=='pending'&&b.tracked&&b.source==='ai');
    const calibFilter = getCalibrationFilter(gradedBets);
    const calibResult = applyCalibrationToConfidence(pickData.confidence||60, calibFilter);
    
    if (calibResult.blocked) {
      addLog(`🚫 BLOCKED: ${pickData.pick} — ${calibFilter[pickData.confidence>=75?'high':pickData.confidence>=65?'mid':'low']?.actualWR?.toFixed(0)}% actual win rate below break-even in this confidence tier`);
      return;
    }
    if (calibResult.warning) addLog(calibResult.warning);
    
    const adjustedConf = calibResult.confidence;
    const bet={id:uid(),pick:pickData.pick||'Unknown',sport:pickData.sport||'NHL',betType:pickData.betType||'Moneyline',betCategory:'straight',odds:parseInt(pickData.odds)||-110,stake:pickData.stake||25,result:'pending',date:new Date().toISOString(),reasoning:pickData.reasoning||'',keyFactors:pickData.keyFactors||[],confidence:adjustedConf,edge:pickData.edge||'',modelProb:pickData.modelProb||null,lesson:null,source:'ai',tracked:true};
    setState(s=>({...s,bankroll:parseFloat((s.bankroll-bet.stake).toFixed(2)),bets:[bet,...s.bets]}));
    addLog(`🤖 AI: ${bet.pick}`);
  },[]);

  const addMyPick = useCallback(pickData=>{
    const bet={id:uid(),pick:pickData.pick||'Unknown',sport:pickData.sport||'MLB',betType:pickData.betType||'Moneyline',betCategory:pickData.betCategory||'straight',odds:parseInt(pickData.odds)||-110,stake:pickData.stake||25,result:'pending',date:new Date().toISOString(),reasoning:pickData.reasoning||'',keyFactors:pickData.keyFactors||[],confidence:pickData.confidence||60,modelProb:pickData.modelProb||null,rating:pickData.rating||'',edge:pickData.edge||'',legs:pickData.legs||[],lesson:null,source:'paste',tracked:true};
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

  const fetchWeather = async (city, sport, team='') => {
    try {
      const r = await fetch(`/api/weather?city=${encodeURIComponent(city)}&sport=${sport}&team=${team}`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };

  const autoGrade = useCallback(async (dryRun=false) => {
    const pending = state.bets.filter(b=>b.result==='pending');
    const trackedPending = state.trackedPicks.filter(p=>p.result==='pending');
    addLog(`${dryRun?'👁 DRY RUN':'🔍'} Auto-grade check: ${pending.length} pending bets, ${trackedPending.length} tracked`);
    if (!pending.length && !trackedPending.length) { addLog('No pending bets to grade.'); return; }

    const sports = [...new Set([...pending.map(b=>b.sport),...trackedPending.map(p=>p.sport)])];
    const results = {};

    // Get all unique dates from pending bets plus today and yesterday
    // Convert ISO date to local date string
    const toLocalDate = (iso) => {
      if (!iso) return null;
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    const betDates = new Set([
      ...pending.map(b=>toLocalDate(b.date)).filter(Boolean),
      ...trackedPending.map(p=>toLocalDate(p.date)).filter(Boolean),
    ]);
    addLog(`📅 Bet dates: ${[...betDates].join(', ')}`);
    addLog(`📡 Pending bets: ${pending.map(b=>b.sport+':'+b.pick.slice(0,15)).join(' | ')}`);
    addLog(`📡 Pending tracked: ${trackedPending.map(p=>p.sport+':'+p.date+'|'+p.pick.slice(0,15)).join(' | ')}`);
    // Only add today as buffer for same-day bets placed before game starts
    const todayD = new Date();
    betDates.add(toLocalDate(todayD.toISOString()));
    const dates = [...betDates].sort().reverse();
    addLog(`🔍 Checking dates: ${dates.join(', ')}`);

    for (const sport of sports) {
      results[sport] = {games:[]};
      for (const date of dates) {
        try {
          const r = await fetch(`/api/results?sport=${sport}&date=${date}`);
          if (r.ok) {
            const data = await r.json();
            results[sport].games.push(...(data.games||[]));
          }
        } catch {}
      }
      addLog(`📡 ${sport}: ${results[sport].games.length} games loaded`);
    }

    // Comprehensive team lookup - maps any name/nickname to API abbreviation
    const TEAM_ALIASES = {
      // NHL
      'ANAHEIM':['ANA'],'DUCKS':['ANA'],'BOSTON':['BOS'],'BRUINS':['BOS'],
      'BUFFALO':['BUF'],'SABRES':['BUF'],'CALGARY':['CGY'],'FLAMES':['CGY'],
      'CAROLINA':['CAR'],'HURRICANES':['CAR'],'CHICAGO':['CHI'],'BLACKHAWKS':['CHI'],
      'COLORADO':['COL'],'AVALANCHE':['COL'],'COLUMBUS':['CBJ'],'BLUEJACKETS':['CBJ'],
      'DALLAS':['DAL'],'STARS':['DAL'],'DETROIT':['DET'],'REDWINGS':['DET'],
      'EDMONTON':['EDM'],'OILERS':['EDM'],'FLORIDA':['FLA'],'PANTHERS':['FLA'],
      'LOSANGELES':['LAK'],'KINGS':['LAK'],'MINNESOTA':['MIN'],'WILD':['MIN'],
      'MONTREAL':['MTL'],'CANADIENS':['MTL'],'HABS':['MTL'],
      'NASHVILLE':['NSH'],'PREDATORS':['NSH'],'PREDS':['NSH'],
      'NEWJERSEY':['NJD'],'DEVILS':['NJD'],'NEWYORKISLANDERS':['NYI'],'ISLANDERS':['NYI'],
      'NEWYORKRANGERS':['NYR'],'RANGERS':['NYR'],'OTTAWA':['OTT'],'SENATORS':['OTT'],
      'PHILADELPHIA':['PHI'],'FLYERS':['PHI'],'PITTSBURGH':['PIT'],'PENGUINS':['PIT'],
      'SANJOSE':['SJS'],'SHARKS':['SJS'],'SEATTLE':['SEA'],'KRAKEN':['SEA'],
      'STLOUIS':['STL'],'BLUES':['STL'],'TAMPABAY':['TBL'],'LIGHTNING':['TBL'],
      'TORONTO':['TOR'],'MAPLELEA':['TOR'],'LEAFS':['TOR'],
      'UTAH':['UTA'],'HOCKEYCLUB':['UTA'],
      'VANCOUVER':['VAN'],'CANUCKS':['VAN'],'VEGAS':['VGK'],'GOLDENKNIGHTS':['VGK'],
      'WASHINGTON':['WSH'],'CAPITALS':['WSH'],'CAPS':['WSH'],
      'WINNIPEG':['WPG'],'JETS':['WPG'],
      // MLB
      'ARIZONA':['ARI'],'DIAMONDBACKS':['ARI'],'DBACKS':['ARI'],
      'ATLANTA':['ATL'],'BRAVES':['ATL'],'BALTIMORE':['BAL'],'ORIOLES':['BAL'],
      'REDSOX':['BOS'],'CUBS':['CHC'],'WHITESOX':['CHW'],
      'CINCINNATI':['CIN'],'REDS':['CIN'],'CLEVELAND':['CLE'],'GUARDIANS':['CLE'],
      'COLORADO':['COL'],'ROCKIES':['COL'],'DETROIT':['DET'],'TIGERS':['DET'],
      'HOUSTON':['HOU'],'ASTROS':['HOU'],'KANSASCITY':['KCR'],'ROYALS':['KCR'],
      'ANGELS':['LAA'],'DODGERS':['LAD'],'MIAMI':['MIA'],'MARLINS':['MIA'],
      'MILWAUKEE':['MIL'],'BREWERS':['MIL'],'MINNESOTA':['MIN'],'TWINS':['MIN'],
      'METS':['NYM'],'YANKEES':['NYY'],'ATHLETICS':['OAK'],'PHILLIES':['PHI'],
      'PIRATES':['PIT'],'PADRES':['SDP'],'GIANTS':['SFG'],'MARINERS':['SEA'],
      'CARDINALS':['STL'],'RAYS':['TBR'],'RANGERS':['TEX'],'BLUEJAYS':['TOR'],
      'NATIONALS':['WSH'],
      // NBA
      'HAWKS':['ATL'],'CELTICS':['BOS'],'NETS':['BKN'],'HORNETS':['CHA'],
      'BULLS':['CHI'],'CAVALIERS':['CLE'],'CAVS':['CLE'],'MAVS':['DAL'],
      'MAVERICKS':['DAL'],'NUGGETS':['DEN'],'PISTONS':['DET'],'WARRIORS':['GSW'],
      'ROCKETS':['HOU'],'PACERS':['IND'],'CLIPPERS':['LAC'],'LAKERS':['LAL'],
      'GRIZZLIES':['MEM'],'HEAT':['MIA'],'BUCKS':['MIL'],'TIMBERWOLVES':['MIN'],
      'PELICANS':['NOP'],'KNICKS':['NYK'],'THUNDER':['OKC'],'MAGIC':['ORL'],
      'SIXERS':['PHI'],'76ERS':['PHI'],'SUNS':['PHX'],'TRAILBLAZERS':['POR'],
      'BLAZERS':['POR'],'KINGS':['SAC'],'SPURS':['SAS'],'RAPTORS':['TOR'],
      'JAZZ':['UTA'],'WIZARDS':['WAS'],
      // NFL
      'BEARS':['CHI'],'BENGALS':['CIN'],'BROWNS':['CLE'],'COWBOYS':['DAL'],
      'BRONCOS':['DEN'],'LIONS':['DET'],'PACKERS':['GB'],'TEXANS':['HOU'],
      'COLTS':['IND'],'JAGUARS':['JAX'],'CHIEFS':['KC'],'RAIDERS':['LV'],
      'CHARGERS':['LAC'],'RAMS':['LAR'],'DOLPHINS':['MIA'],'VIKINGS':['MIN'],
      'PATRIOTS':['NE'],'SAINTS':['NO'],'GIANTS':['NYG'],'JETS':['NYJ'],
      'EAGLES':['PHI'],'STEELERS':['PIT'],'49ERS':['SF'],'SEAHAWKS':['SEA'],
      'BUCCANEERS':['TB'],'BUCS':['TB'],'TITANS':['TEN'],'COMMANDERS':['WAS'],
      'REDSKINS':['WAS'],'RAVENS':['BAL'],'BILLS':['BUF'],'FALCONS':['ATL'],
      'PANTHERS':['CAR'],'CARDINALS':['ARI'],
    };

    const getTeamAbbr = (text) => {
      const upper = text.toUpperCase().replace(/[^A-Z0-9]/g,'');
      // Direct match
      if (TEAM_ALIASES[upper]) return TEAM_ALIASES[upper];
      // Partial match - find any alias that appears in the text
      const textUpper = text.toUpperCase();
      for (const [alias, abbrs] of Object.entries(TEAM_ALIASES)) {
        if (textUpper.includes(alias.replace(/([A-Z])/g,' $1').trim())) return abbrs;
        if (textUpper.includes(alias)) return abbrs;
      }
      return [];
    };

    const matchBet = (pick, sport, games, betDate) => {
      if (!games?.length) return null;
      const pickAbbrs = getTeamAbbr(pick);
      // Match by abbreviation found in pick text
      return games.find(g => {
        const away = (g.away||'').toUpperCase();
        const home = (g.home||'').toUpperCase();
        // Direct abbr match
        if (pickAbbrs.includes(away) || pickAbbrs.includes(home)) return true;
        // Also try direct string match on pick
        const pickUpper = pick.toUpperCase();
        if (away && pickUpper.includes(away)) return true;
        if (home && pickUpper.includes(home)) return true;
        return false;
      }) || null;
    };

    const gradeResult = (bet, game, sport) => {
      if (!game?.final) return null;
      const pickUpper = bet.pick.toUpperCase();
      const betType = (bet.betType||'').toUpperCase();
      const away = game.away_score;
      const home = game.home_score;
      if (away === null || home === null) return null;

      // NRFI/YRFI
      if (betType.includes('NRFI') || pickUpper.includes('NRFI')) {
        if (game.away_r1 === null || game.home_r1 === null) return null;
        const scored = (game.away_r1 + game.home_r1) > 0;
        return scored ? 'loss' : 'win';
      }
      if (betType.includes('YRFI') || pickUpper.includes('YRFI')) {
        if (game.away_r1 === null || game.home_r1 === null) return null;
        const scored = (game.away_r1 + game.home_r1) > 0;
        return scored ? 'win' : 'loss';
      }

      // Moneyline - also handle tracker format "STL @ UTA — HOME (UTA)" or "AWAY (LAK)"
      const isSpread = betType.includes('SPREAD') || betType.includes('PUCK') || betType.includes('RUN') || bet.pick.match(/[+-]\d{1,2}\.5/);
      const isML = !isSpread && (betType.includes('MONEYLINE') || betType.includes('ML') ||
        pickUpper.includes('— HOME') || pickUpper.includes('— AWAY') ||
        pickUpper.includes('HOME (') || pickUpper.includes('AWAY ('));
      if (isML) {
        const awayWin = away > home;
        if (away === home) return 'push';
        // Check for explicit HOME/AWAY in tracker format
        if (pickUpper.includes('— HOME') || pickUpper.match(/HOME \([A-Z]+\)/)) return awayWin ? 'loss' : 'win';
        if (pickUpper.includes('— AWAY') || pickUpper.match(/AWAY \([A-Z]+\)/)) return awayWin ? 'win' : 'loss';
        // Standard ML matching
        const awayAbbrs = getTeamAbbr(game.away_full||game.away);
        const homeAbbrs = getTeamAbbr(game.home_full||game.home);
        const awayPicked = pickUpper.includes(game.away.toUpperCase()) || awayAbbrs.some(a=>pickUpper.includes(a));
        const homePicked = pickUpper.includes(game.home.toUpperCase()) || homeAbbrs.some(a=>pickUpper.includes(a));
        if (awayPicked) return awayWin ? 'win' : 'loss';
        if (homePicked) return awayWin ? 'loss' : 'win';
      }

      // Totals - handle "OVER 6.5", "UNDER 6.5", "o6.5", "u6.5"
      if (betType.includes('OVER') || betType.includes('UNDER') || betType.includes('TOTAL') ||
          pickUpper.includes('OVER') || pickUpper.includes('UNDER')) {
        const totalMatch = bet.pick.match(/OVER\s+(\d+\.?\d*)/i) || bet.pick.match(/UNDER\s+(\d+\.?\d*)/i) ||
          bet.pick.match(/([ou])(\d+\.?\d*)/i) || bet.betType?.match(/([ou])(\d+\.?\d*)/i);
        const dir = bet.pick.match(/OVER/i) ? 'O' : bet.pick.match(/UNDER/i) ? 'U' : null;
        if (totalMatch) {
          const resolvedDir = dir || totalMatch[1].toUpperCase();
          const line = parseFloat(totalMatch[2] || totalMatch[1]);
          const total = away + home;
          if (total === line) return 'push';
          if (resolvedDir === 'O') return total > line ? 'win' : 'loss';
          if (resolvedDir === 'U') return total < line ? 'win' : 'loss';
        }
      }

      // Spread/Puck line/Run line
      if (betType.includes('SPREAD') || betType.includes('PUCK') || betType.includes('RUN') || bet.pick.match(/[+-]\d+\.5/)) {
        const spreadMatch = bet.pick.match(/([+-]\d{1,2}\.5)/);
        if (spreadMatch) {
          const spread = parseFloat(spreadMatch[1]);
          const pickBeforeSpread = bet.pick.toUpperCase().split(spreadMatch[1])[0];
          const awayAbbr = game.away.toUpperCase();
          const homeAbbr = game.home.toUpperCase();
          const awayAliases = [...getTeamAbbr(game.away_full||''), ...getTeamAbbr(game.away||''), game.away||''];
          const homeAliases = [...getTeamAbbr(game.home_full||''), ...getTeamAbbr(game.home||''), game.home||''];
          const awayInPick = pickBeforeSpread.includes(awayAbbr) || awayAliases.some(a=>pickBeforeSpread.includes(a));
          const homeInPick = pickBeforeSpread.includes(homeAbbr) || homeAliases.some(a=>pickBeforeSpread.includes(a));
          addLog('SPREAD DEBUG: before='+pickBeforeSpread+' away='+awayAbbr+' awayAliases='+JSON.stringify(awayAliases)+' awayInPick='+awayInPick+' home='+homeAbbr+' homeAliases='+JSON.stringify(homeAliases)+' homeInPick='+homeInPick);
          if (!awayInPick && !homeInPick) return null;
          const pickedScore = awayInPick ? away : home;
          const otherScore = awayInPick ? home : away;
          const covered = (pickedScore - otherScore) + spread;
          if (covered === 0) return 'push';
          return covered > 0 ? 'win' : 'loss';
        }
      }

      return null;
    };

    let autoGraded = 0;
    const newBets = state.bets.map(b => {
      if (b.result !== 'pending') return b;
      const sportResults = results[b.sport]?.games;
      if (!sportResults) { addLog(`⚠️ No ${b.sport} results fetched`); return b; }
      const game = matchBet(b.pick, b.sport, sportResults);
      if (!game) { addLog(`⚠️ No match for: ${b.pick} sport=${b.sport} (checked ${sportResults.filter(g=>g).length} ${b.sport} games, sample: ${sportResults.slice(0,3).map(g=>g.away+'-'+g.home).join(',')})`); return b; }
      if (!game.final) { addLog(`⏳ Game not final: ${b.pick} (${game.away}-${game.home} ${game.status})`); return b; }
      const result = gradeResult(b, game, b.sport);
      if (!result) { addLog(`⚠️ Could not determine result for: ${b.pick} (${game.away} ${game.away_score}-${game.home_score} ${game.home})`); return b; }
      autoGraded++;
      addLog(`🤖 Auto-graded: ${b.pick} → ${result.toUpperCase()} (${game.away} ${game.away_score}-${game.home_score} ${game.home})`);
      if (dryRun) addLog(`👁 PREVIEW: ${b.pick.slice(0,30)} → ${result.toUpperCase()} (${game.away} ${game.away_score}-${game.home_score} ${game.home})`);
      return {...b, result, score:`${game.away} ${game.away_score}-${game.home_score} ${game.home}`, autoGraded:true};
    });

    const newTracked = state.trackedPicks.map(p => {
      if (p.result !== 'pending') return p;
      const sportResults = results[p.sport]?.games;
      if (!sportResults || !sportResults.length) { addLog(`⚠️ Tracker: No ${p.sport} results for: ${p.pick}`); return p; }
      const game = matchBet(p.pick, p.sport, sportResults);
      if (!game) { addLog(`⚠️ Tracker: No match for: ${p.pick} (${p.sport}, ${sportResults.length} games, sample:${sportResults.slice(0,2).map(g=>g.away+'-'+g.home).join(',')})`); return p; }
      if (!game.final) { addLog(`⏳ Tracker: Not final: ${p.pick}`); return p; }
      const result = gradeResult(p, game, p.sport);
      if (!result) { addLog(`⚠️ Tracker: No result for: ${p.pick} (${game.away} ${game.away_score}-${game.home_score} ${game.home})`); return p; }
      autoGraded++;
      addLog(`🤖 Tracker graded: ${p.pick} → ${result.toUpperCase()}`);
      if (dryRun) addLog(`👁 PREVIEW TRACKER: ${p.pick.slice(0,30)} → ${result.toUpperCase()} (${game.away_score}-${game.home_score})`);
      return {...p, result, score:`${game.away_score}-${game.home_score}`, autoGraded:true};
    });

    if (dryRun) {
      addLog(`👁 DRY RUN complete — would grade ${autoGraded} picks (no changes made)`);
      return;
    }
    if (autoGraded > 0) {
      let aiDelta = 0, myDelta = 0;
      newBets.forEach(b => {
        if (!b.autoGraded) return;
        const payout = b.result==='win'?americanToDecimal(b.odds)*b.stake:b.result==='push'?b.stake:0;
        if (b.source==='ai') aiDelta += payout;
        else myDelta += payout;
      });
      // Use functional update to avoid stale closure
      setState(s=>{
        // Reapply grades to fresh state
        const freshBets = s.bets.map(b=>{
          const graded = newBets.find(nb=>nb.id===b.id&&nb.autoGraded);
          return graded ? {...b, result:graded.result, score:graded.score, autoGraded:true} : b;
        });
        const freshTracked = s.trackedPicks.map(p=>{
          const graded = newTracked.find(np=>np.id===p.id&&np.autoGraded);
          return graded ? {...p, result:graded.result, score:graded.score, autoGraded:true} : p;
        });
        return {
          ...s,
          bankroll: parseFloat((s.bankroll+aiDelta).toFixed(2)),
          myBankroll: parseFloat((s.myBankroll+myDelta).toFixed(2)),
          bets: freshBets,
          trackedPicks: freshTracked,
        };
      });
      addLog(`✅ Auto-graded ${autoGraded} bet${autoGraded!==1?'s':''}`);
    // Trigger self-learning after grading
    setTimeout(()=>runAutoTune(newState.bets, newState.simTuning, newState.betTypePerf, newState.confTiers), 500);
    }
  },[state.bets,state.trackedPicks,state.bankroll,state.myBankroll]);

  const confirmPicks = useCallback(async (picks,sport,stake)=>{
    // Try to get weather for MLB and NFL picks
    const weatherCache = {};
    if (sport==='MLB'||sport==='NFL') {
      for (const p of picks) {
        const cityMatch = p.pick.match(/([A-Z]{2,3})\s*[@v]\s*([A-Z]{2,3})/);
        if (cityMatch) {
          const homeTeam = cityMatch[2];
          const MLB_CITIES = {LAD:'Los Angeles',NYY:'New York',BOS:'Boston',CHC:'Chicago',HOU:'Houston',ATL:'Atlanta',PHI:'Philadelphia',MIL:'Milwaukee',STL:'St Louis',SFG:'San Francisco',SDP:'San Diego',COL:'Denver',CIN:'Cincinnati',PIT:'Pittsburgh',MIA:'Miami',NYM:'New York',WSH:'Washington DC',BAL:'Baltimore',TOR:'Toronto',MIN:'Minneapolis',CLE:'Cleveland',DET:'Detroit',KCR:'Kansas City',TEX:'Arlington',SEA:'Seattle',OAK:'Oakland',LAA:'Anaheim',TBR:'St Petersburg',ARI:'Phoenix',CHW:'Chicago'};
          const NFL_CITIES = {BUF:'Buffalo',NE:'Boston',NYJ:'New York',NYG:'New York',PHI:'Philadelphia',DAL:'Dallas',WAS:'Washington DC',BAL:'Baltimore',PIT:'Pittsburgh',CLE:'Cleveland',CIN:'Cincinnati',MIA:'Miami',JAX:'Jacksonville',TEN:'Nashville',HOU:'Houston',IND:'Indianapolis',KC:'Kansas City',LV:'Las Vegas',LAC:'Los Angeles',DEN:'Denver',MIN:'Minneapolis',GB:'Green Bay',CHI:'Chicago',DET:'Detroit',ATL:'Atlanta',CAR:'Charlotte',NO:'New Orleans',TB:'Tampa',SF:'San Francisco',SEA:'Seattle',LAR:'Los Angeles',ARI:'Phoenix'};
          const cities = sport==='MLB'?MLB_CITIES:NFL_CITIES;
          const city = cities[homeTeam];
          if (city && !weatherCache[homeTeam]) {
            weatherCache[homeTeam] = await fetchWeather(city, sport, homeTeam);
          }
          p._weather = weatherCache[homeTeam];
        }
      }
    }
    picks.forEach(p=>{
      const w = p._weather;
      const weatherNote = w?.notes?.length ? ` | Weather: ${w.notes[0]}` : '';
      addMyPick({pick:p.pick,sport,betType:p.betType||'Moneyline',betCategory:'straight',odds:parseInt(p.odds)||-110,stake,confidence:p.confidence||60,reasoning:(p.reasoning||'')+weatherNote,keyFactors:p.keyFactors||[],modelProb:p.modelProb||null,rating:p.rating||'',edge:p.edge||'',legs:[],weather:w||null,official:p.official||null,opponent:p.opponent||null,restTravel:p.restTravel||null});
    });
    addLog(`📋 Logged ${picks.length} ${sport} pick(s)`);
    setTab('mine');
  },[addMyPick,fetchWeather]);

  const buildHistorySummary = () => {
    const graded = state.bets.filter(b=>b.result!=='pending'&&b.tracked);
    if (!graded.length) return '';
    // Auto-tune sim parameters based on graded results
    const tuning = calcTuningParams(graded);
    const tuningNote = tuning.drift ? ` Sim calibration: ${tuning.drift>0?'underestimating':'overestimating'} by ${Math.abs(tuning.drift).toFixed(1)}% — adjust confidence accordingly.` : '';
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
    const recentLessons=state.lessons.slice(0,5).map(l=>l.takeaway||l.body).filter(Boolean).map(l=>l.slice(0,100)).join(' | ');
    return `

YOUR BETTING HISTORY (${graded.length} graded bets):
Record: ${wins}W-${graded.length-wins}L | ROI: ${roi.toFixed(1)}% | Net: ${formatMoney(profit)}
By sport: ${sportStr}
Recent: ${recent}
Use this history to adapt your picks — avoid bet types that are losing, favor what's working.${recentLessons?'\nLessons from past bets: '+recentLessons:''}${tuningNote}`;
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
    const tuningContext = buildTuningPrompt(state.simTuning||{}, state.betTypePerf||{}, state.confTiers||{}, []);
    // Dynamic confidence adjustments by sport
    const gradedAI = state.bets.filter(b=>b.result!=='pending'&&b.tracked&&b.source==='ai');
    const sportConfAdj = getDynamicConfidenceAdjustment(gradedAI);
    const sportAdjStr = Object.entries(sportConfAdj).filter(([,v])=>Math.abs(v)>2).map(([s,v])=>`${s}: ${v>0?'+':''}${v.toFixed(1)}% confidence adjustment`).join(', ');
    // Reasoning pattern analysis
    const reasoningPatterns = analyzeReasoningPatterns(gradedAI);
    const topPatterns = reasoningPatterns.slice(0,5).map(p=>`"${p.keyword}": ${p.winRate}% WR (${p.edge>0?'+':''}${p.edge}% edge vs baseline)`).join(', ');
    const avoidPatterns = reasoningPatterns.filter(p=>parseFloat(p.edge)<-5).map(p=>p.keyword).join(', ');
    // Add backtest results to context
    const backtestLessons = state.lessons
      .filter(l=>l.source==='backtest')
      .slice(0,3)
      .map(l=>l.lesson?.slice(0,800))
      .filter(Boolean)
      .join('\n---\n');

    // Fetch today's games with stats for Claude context
    let gamesWithStats = '';
    try {
      const gamesRes = await fetch(`/api/games?sport=${pickSport}`);
      const gamesData = await gamesRes.json();
      if (gamesData.success && gamesData.games?.length) {
        // Fetch stats for top 3 games
        const statPromises = gamesData.games.slice(0,3).map(g=>
          fetch('/api/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sport:pickSport,homeTeam:g.homeTeam,awayTeam:g.awayTeam,gameId:g.gameId})})
          .then(r=>r.json()).catch(()=>null)
        );
        const statsResults = await Promise.all(statPromises);
          gamesWithStats = statsResults.filter(r=>r?.success).map(r=>r.context).join('\n\n');

      }
    } catch(e) { console.warn('Games stats fetch failed:', e.message); }
    const sys=`You are a sharp sports bettor finding value in ${pickSport} games.

CRITICAL RULES:
- Only bet games CONFIRMED for TODAY in the stats data
- For each game, pick ONE SIDE ONLY — never bet both teams in the same game
- Process each game in order:
  1. Calculate TRUE win probability using stats (pitcher ERA, team form, injuries, home/away splits, rest days)
  2. Compare to MARKET implied probability from the odds
  3. Only recommend if your true probability EXCEEDS market by 4%+ 
  4. Pick the side with the HIGHEST edge — never recommend both sides
- For MLB: use CONFIRMED pitcher from stats, never guess
- For NHL: use CONFIRMED goalie from stats
- Never fabricate stats — only use what is provided
- Maximum 3 picks total — quality over quantity

PLAYOFF CONTEXT (NHL/NBA):
- Playoff games are fundamentally different from regular season
- Scoring drops 15-20% in playoffs due to tighter defense and better goaltending
- For NHL totals: adjust expected goals DOWN by 0.5-1.0 from regular season averages
- Home ice advantage is STRONGER in playoffs (crowd intensity, familiarity)
- Game 1s are often tight as teams feel each other out — favor unders and underdogs covering
- Goalie performance is MORE important in playoffs — a hot goalie can steal a series
- Teams with MORE playoff experience have a significant edge over first-timers
- Rest advantage matters — teams with extra days off perform better in Game 1
- Series history and head-to-head in current season matters more than overall record

REST & MATCHUP SCORING:
- Flag any team on 0 days rest vs opponent with 2+ days rest as significant disadvantage
- Pitcher/goalie matchup edge: if starter ERA difference > 1.0, that's a strong lean
- Home/away splits in playoffs matter more than regular season splits

LIVE ODDS:
${oddsText}
${gamesWithStats?'VERIFIED TEAM STATS & CONFIRMED STARTERS:\n'+gamesWithStats:''}
${history}
${tuningContext?tuningContext+'\n':''}
${backtestLessons?'\nBACKTEST FINDINGS (follow these rules):\n'+backtestLessons:''}
${sportAdjStr?'\nCALIBRATION ADJUSTMENTS (confidence is being auto-adjusted):\n'+sportAdjStr:''}
${topPatterns?'\nREASONING PATTERNS FROM YOUR HISTORY:\nWinning patterns: '+topPatterns:''}
${avoidPatterns?'AVOID reasoning around: '+avoidPatterns:''}

Return ONLY a JSON array of your best 1-3 picks. Each object must have:
{"pick","sport","betType","odds"(integer),"homeOdds"(integer),"awayOdds"(integer),"totalLine"(number),"reasoning","keyFactors"(3-5 strings),"confidence"(55-80),"edge"}
No markdown.${pickContext?`\nFocus: ${pickContext}`:''}`;
    setLoadingMsg('🧠 Finding value...');
    try {
      const raw=await callClaude([{role:'user',content:`Today ${new Date().toLocaleDateString()}. Review ${pickSport} odds, search injuries/news, return best value bets as JSON.`}],sys,false);
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
      if(!Array.isArray(picks)||picks.length===0){addLog('No strong value found.');setError(`No value found in today's ${pickSport} lines. Try a different sport or add focus context.`);setLoadingMsg('');setLoading(false);return;}
      picks.forEach(p=>{
        const odds=parseInt(p.odds)||-110;
        const dec=odds>0?odds/100+1:100/Math.abs(odds)+1;
        const imp=1/dec;
        const conf=(p.confidence||60)/100;
        const edge=conf-imp;
        let stake;
        if(edge>0){
          const kelly=((dec-1)*conf-(1-conf))/(dec-1)*0.25;
          stake=Math.max(5,Math.min(Math.round(state.bankroll*kelly/5)*5,Math.round(state.bankroll*0.05)));
        } else { stake=10; }
        // Run Monte Carlo simulation for this pick
        const simResult = runSim(pickSport, p.homeOdds||p.odds, p.awayOdds||p.odds, p.totalLine||null, 5000);
        const simConf = simResult ? getSimConfidence(simResult, p.betType||'', p.pick||'', p.odds) : null;
        addAIPick({...p,sport:pickSport,stake,simConfidence:simConf,simResult:simResult?{
          homeWinProb:Math.round(simResult.homeWinProb*100),
          awayWinProb:Math.round(simResult.awayWinProb*100),
          overProb:Math.round(simResult.overProb*100),
          underProb:Math.round(simResult.underProb*100),
          nrfiProb:simResult.nrfiProb?Math.round(simResult.nrfiProb*100):null,
        }:null});
      });
      addLog(`✅ AI placed ${picks.length} pick(s) with Monte Carlo sim`);setTab('ai');
    } catch(err){setError('Failed: '+err.message);addLog('❌ '+err.message);}
    setLoadingMsg('');setLoading(false);
  },[pickSport,pickContext,state.bankroll,addAIPick]);

  const gradeBet = useCallback(async (id,result,score='')=>{
    const bet=state.bets.find(b=>b.id===id);
    if(!bet)return;
    const payout=result==='win'?americanToDecimal(bet.odds)*bet.stake:result==='push'?bet.stake:0;
    const pl=result==='win'?(americanToDecimal(bet.odds)-1)*bet.stake:result==='loss'?-bet.stake:0;
    const key=bet.source==='paste'?'myBankroll':bet.source==='groq'?'groqBankroll':'bankroll';
    const updatedBets = state.bets.map(b=>b.id===id?{...b,result,score}:b);
    setState(s=>({...s,[key]:parseFloat((s[key]+payout).toFixed(2)),bets:updatedBets}));
    addLog(`Graded: ${bet.pick} → ${result.toUpperCase()}${score?' ('+score+')':''} (${formatMoney(pl)})`);

    // Auto-coach: run lightweight analysis in background after every 5th graded bet
    const newGraded = updatedBets.filter(b=>b.result!=='pending'&&(b.source==='ai'||b.source==='paste'));
    if (newGraded.length>=5 && newGraded.length%5===0) {
      try {
        const wins=newGraded.filter(b=>b.result==='win').length;
        const staked=newGraded.reduce((a,b)=>a+b.stake,0);
        const profit=newGraded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
        const recent=newGraded.slice(0,10).map(b=>({pick:b.pick,sport:b.sport,betType:b.betType,odds:b.odds,confidence:b.confidence,result:b.result,score:b.score||''}));
        const raw=await callClaude([{role:'user',content:`Quick coaching note after ${newGraded.length} bets:
Record: ${wins}W-${newGraded.length-wins}L | ROI: ${staked?(profit/staked*100).toFixed(1):0}%
Recent: ${JSON.stringify(recent)}

Return ONLY JSON: {"takeaway":"one specific actionable insight","pattern":"one pattern spotted","warning":"one thing to watch out for"}`}],
          'Sharp betting coach. Extremely concise. JSON only.',false);
        let note={};
        try{const c=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();const s=c.indexOf('{'),e=c.lastIndexOf('}');if(s!==-1&&e!==-1)note=JSON.parse(c.slice(s,e+1));}catch{}
        if(note.takeaway){
          setState(s=>({...s,lessons:[{
            id:uid(),date:new Date().toISOString(),
            title:`🎯 Auto-Coach Note (${newGraded.length} bets)`,
            category:'Auto-Coach',
            body:`Pattern: ${note.pattern||''}
Warning: ${note.warning||''}`,
            takeaway:note.takeaway,
          },...s.lessons]}));
          addLog(`🎯 Auto-coach updated after ${newGraded.length} bets`);
        }
      } catch(e){ console.warn('Auto-coach failed:',e); }
    }
  },[state.bets]);

  const addToPreLog = () => {
    if (!preLogInput.pick.trim()) return;
    const entry = {
      id: uid(),
      ...preLogInput,
      odds: parseInt(preLogInput.odds)||(-110),
      stake: parseFloat(preLogInput.stake)||10,
      date: new Date().toISOString(),
      coachOpinion: null,
      coachLoading: false,
    };
    setPreLog(p=>[entry,...p]);
    setPreLogInput({pick:'',sport:'NHL',betType:'Moneyline',odds:'',stake:'10',notes:''});
    addLog(`📋 Added to pre-log: ${entry.pick}`);
  };

  const askCoachAboutPick = async (id) => {
    const entry = preLog.find(p=>p.id===id);
    if (!entry) return;
    setPreLogLoading(id);
    try {
      const graded = state.bets.filter(b=>b.result!=='pending'&&b.tracked);
      const wins = graded.filter(b=>b.result==='win').length;
      const roi = graded.length ? graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0)/graded.reduce((a,b)=>a+b.stake,0)*100 : 0;
      
      // Sport-specific record
      const sportBets = graded.filter(b=>b.sport===entry.sport);
      const sportWins = sportBets.filter(b=>b.result==='win').length;
      
      // Bet type record
      const typeBets = graded.filter(b=>b.betType===entry.betType);
      const typeWins = typeBets.filter(b=>b.result==='win').length;

      const sys = `You are an elite sports betting coach running a 5-gate pre-bet decision framework. Be direct and data-driven.
GATE 1 — EDGE: Do sim edge AND model edge both agree on same side >5%?
GATE 2 — ODDS: Outside -109 to +109 dead zone? HOME ML needs >8% edge.
GATE 3 — CALIBRATION: Is this confidence tier historically profitable for this bettor?
GATE 4 — SITUATION: Key injuries? Back-to-back? Extreme weather?
GATE 5 — BANKROLL: Kelly <5% bankroll? Not chasing? Exposure <15% tonight?
Return: VERDICT (BET/WARN/PASS) | GATES (✅/❌) | REASONING (2-3 sentences with data) | ACTION (specific next step)`;
      const pendingTonight = state.bets.filter(b=>b.result==='pending');
      const totalExposure = pendingTonight.reduce((a,b)=>a+b.stake,0);
      const recentLosses = graded.slice(0,5).filter(b=>b.result==='loss').length;
      const tierWR = (() => {
        const conf = entry.confidence||entry.stake||60;
        const tier = conf>=75?'high':conf>=65?'mid':'low';
        const tierBets = graded.filter(b=>{ const c=b.confidence||60; const t=c>=75?'high':c>=65?'mid':'low'; return t===tier; });
        if (!tierBets.length) return 'no data';
        return `${(tierBets.filter(b=>b.result==='win').length/tierBets.length*100).toFixed(0)}% (${tierBets.length} bets)`;
      })();
      const msg = `PRE-BET GATE ANALYSIS:\n\nPICK: ${entry.pick} (${entry.sport} ${entry.betType})\nODDS: ${entry.odds>0?'+':''}${entry.odds} | CONFIDENCE: ${entry.confidence||'?'}%\nSTAKE: $${entry.stake} | NOTES: ${entry.notes||'none'}\n\nBANKROLL STATUS:\n- Bankroll: $${state.myBankroll}\n- Tonight exposure: $${totalExposure} (${state.myBankroll?(totalExposure/state.myBankroll*100).toFixed(1):0}%)\n- Pending bets: ${pendingTonight.length}\n\nCALIBRATION DATA:\n- Overall: ${wins}W-${graded.length-wins}L (${roi.toFixed(1)}% ROI)\n- ${entry.sport} record: ${sportWins}W-${sportBets.length-sportWins}L\n- ${entry.betType} record: ${typeWins}W-${typeBets.length-typeWins}L\n- This confidence tier WR: ${tierWR}\n- Recent 5: ${graded.slice(0,5).map(b=>b.result==='win'?'W':'L').join('')||'none'}\n- Recent losses streak: ${recentLosses}\n\nLESSONS:\n${state.lessons.slice(0,3).map(l=>l.lesson?.slice(0,100)).filter(Boolean).join(' | ')||'none'}\n\nRUN ALL 5 GATES. Give VERDICT: BET / WARN / PASS with specific reasoning.`;

      const opinion = await callClaude([{role:'user',content:msg}], sys, false);
      setPreLog(p=>p.map(e=>e.id===id?{...e,coachOpinion:opinion}:e));
    } catch(e) { addLog('❌ Coach error: '+e.message); }
    setPreLogLoading(null);
  };

  const lockPreLogPick = (id) => {
    const entry = preLog.find(p=>p.id===id);
    if (!entry) return;
    addMyPick({
      pick: entry.pick,
      sport: entry.sport,
      betType: entry.betType,
      odds: entry.odds,
      stake: entry.stake,
      reasoning: entry.coachOpinion||entry.notes||'',
      keyFactors: [],
      confidence: 60,
    });
    setPreLog(p=>p.filter(e=>e.id!==id));
    addLog(`✅ Locked: ${entry.pick} → My Picks`);
  };

  const deletePreLog = (id) => {
    setPreLog(p=>p.filter(e=>e.id!==id));
    addLog('🗑 Removed from pre-log');
  };

  const deleteBet = useCallback((id)=>{
    setState(s=>{
      const bet = s.bets.find(b=>b.id===id);
      if(!bet) return s;
      // Refund stake if pending
      const key = bet.source==='paste'?'myBankroll':bet.source==='groq'?'groqBankroll':'bankroll';
      const refund = bet.result==='pending' ? bet.stake : 0;
      return {...s, [key]:parseFloat((s[key]+refund).toFixed(2)), bets:s.bets.filter(b=>b.id!==id)};
    });
    addLog('🗑 Deleted bet');
  },[]);

  const deleteAIPick = useCallback((id)=>{
    setState(s=>{
      const bet = s.bets.find(b=>b.id===id);
      if(!bet||bet.result!=='pending') return s;
      return {...s, bankroll:parseFloat((s.bankroll+bet.stake).toFixed(2)), bets:s.bets.filter(b=>b.id!==id)};
    });
    addLog('🗑 Deleted pending AI pick');
  },[]);

  const tailBet = useCallback((bet)=>{
    addMyPick({
      pick:bet.pick, sport:bet.sport, betType:bet.betType,
      betCategory:bet.betCategory||'straight', odds:bet.odds,
      stake:bet.stake, confidence:bet.confidence, reasoning:bet.reasoning,
      keyFactors:bet.keyFactors||[], modelProb:bet.modelProb||null,
      rating:bet.rating||'', edge:bet.edge||'', legs:bet.legs||[],
      weather:bet.weather||null, official:bet.official||null,
      opponent:bet.opponent||null, restTravel:bet.restTravel||null,
    });
    addLog(`🐍 Tailed AI pick: ${bet.pick}`);
    setTab('mine');
  },[addMyPick]);

  const undoGrade = useCallback((id)=>{
    setState(s=>{
      const bet=s.bets.find(b=>b.id===id);
      if(!bet||bet.result==='pending') return s;
      const key=bet.source==='paste'?'myBankroll':bet.source==='groq'?'groqBankroll':'bankroll';
      const reversal = bet.result==='win'
        ? -(americanToDecimal(bet.odds)-1)*bet.stake
        : bet.result==='loss'
        ? bet.stake
        : -bet.stake;
      return {...s,[key]:parseFloat((s[key]+reversal).toFixed(2)),bets:s.bets.map(b=>b.id===id?{...b,result:'pending',score:''}:b)};
    });
    addLog(`↩ Undo grade: back to PENDING`);
  },[]);

  const teachLesson = useCallback(async betOrId=>{
    const betId = typeof betOrId === 'object' ? betOrId.id : betOrId;
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

  const runCoach = useCallback(async ()=>{
    const aiGradedBets = state.bets.filter(b=>b.source==='ai'&&b.result!=='pending');
    const myGradedBets = state.bets.filter(b=>b.source==='paste'&&b.result!=='pending');
    const totalGraded = aiGradedBets.length + myGradedBets.length;
    if (totalGraded < 10) { setError(`Need at least 10 graded bets for coach analysis (have ${totalGraded}).`); return; }
    setCoachLoading(true);

    const summarize = (bets, label) => {
      if (!bets.length) return `${label}: No graded bets yet.`;
      const wins=bets.filter(b=>b.result==='win').length;
      const staked=bets.reduce((a,b)=>a+b.stake,0);
      const profit=bets.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
      const roi=staked?profit/staked*100:0;
      const bySport={};
      bets.forEach(b=>{if(!bySport[b.sport])bySport[b.sport]={w:0,l:0};if(b.result==='win')bySport[b.sport].w++;else bySport[b.sport].l++;});
      const sportStr=Object.entries(bySport).map(([s,v])=>`${s}:${v.w}W-${v.l}L`).join(', ');
      return `${label}: ${wins}W-${bets.length-wins}L | ROI:${roi.toFixed(1)}% | Net:${formatMoney(profit)} | By sport: ${sportStr} | Recent: ${JSON.stringify(bets.slice(0,8).map(b=>({pick:b.pick,sport:b.sport,odds:b.odds,result:b.result,score:b.score||''})))}`;
    };

    const lessons = state.lessons.slice(0,8).map(l=>l.takeaway||l.body).filter(Boolean);

    // Build model tracker summary
    const trackerSummary = (() => {
      const graded = state.trackedPicks.filter(p=>p.result!=='pending');
      if (!graded.length) return 'No model tracker data yet.';
      const byRating={};
      graded.forEach(p=>{
        const r=p.rating||'Unknown';
        if(!byRating[r])byRating[r]={w:0,l:0,probs:[]};
        if(p.result==='win')byRating[r].w++;
        else if(p.result==='loss')byRating[r].l++;
        if(p.modelProb)byRating[r].probs.push(parseFloat(p.modelProb));
      });
      const ratingStr=Object.entries(byRating).map(([r,v])=>{
        const avgProb=v.probs.length?(v.probs.reduce((a,b)=>a+b,0)/v.probs.length).toFixed(1):'-';
        const wr=((v.w/(v.w+v.l))*100).toFixed(0);
        return `${r}: ${v.w}W-${v.l}L WR:${wr}% AvgProb:${avgProb}%`;
      }).join(', ');
      const bySport={};
      graded.forEach(p=>{
        if(!bySport[p.sport])bySport[p.sport]={w:0,l:0};
        if(p.result==='win')bySport[p.sport].w++;
        else bySport[p.sport].l++;
      });
      const sportStr=Object.entries(bySport).map(([s,v])=>`${s}:${v.w}W-${v.l}L`).join(', ');
      return `${graded.length} tracked picks | By rating: ${ratingStr} | By sport: ${sportStr}`;
    })();

    // Build calibration data
    const calibration = (() => {
      const graded = state.bets.filter(b=>b.result!=='pending'&&b.confidence);
      if (graded.length < 5) return 'Not enough data for calibration.';
      const buckets={};
      graded.forEach(b=>{
        const bucket=Math.floor(b.confidence/10)*10;
        if(!buckets[bucket])buckets[bucket]={pred:[],actual:[]};
        buckets[bucket].pred.push(b.confidence);
        buckets[bucket].actual.push(b.result==='win'?1:0);
      });
      return Object.entries(buckets).map(([b,d])=>{
        const pred=(d.pred.reduce((a,v)=>a+v,0)/d.pred.length).toFixed(0);
        const actual=(d.actual.reduce((a,v)=>a+v,0)/d.actual.length*100).toFixed(0);
        return `${b}-${+b+9}% conf: predicted ${pred}% actual ${actual}% (${d.pred.length} bets)`;
      }).join(' | ');
    })();

    try {
      // Build sport+betType breakdown
      const sportBetBreakdown = (() => {
        const all = [...aiGradedBets, ...myGradedBets];
        const map = {};
        all.forEach(b => {
          const key = `${b.sport} ${b.betType||'ML'}`;
          if (!map[key]) map[key] = {w:0,l:0};
          if (b.result==='win') map[key].w++;
          else map[key].l++;
        });
        return Object.entries(map)
          .filter(([,v])=>v.w+v.l>=3)
          .map(([k,v])=>`${k}: ${v.w}W-${v.l}L (${(v.w/(v.w+v.l)*100).toFixed(0)}%)`)
          .join(' | ');
      })();

      // Get pending picks with their reasoning
      const pendingPicks = state.bets.filter(b=>b.result==='pending'&&b.tracked)
        .slice(0,5)
        .map(b=>`${b.pick} (${b.sport} ${b.betType} ${b.odds>0?'+':''}${b.odds} conf:${b.confidence}%)`);

      // Lesson categories
      const lessonCategories = state.lessons
        .filter(l=>l.lesson&&l.source!=='backtest')
        .slice(0,10)
        .map(l=>{
          const tag = l.lesson.match(/\[([A-Z_]+)\]/)?.[1]||'GENERAL';
          return `[${tag}] ${l.lesson.slice(0,100)}`;
        });
      const backtestReports = state.lessons
        .filter(l=>l.source==='backtest')
        .map(l=>`${l.pick}: ${l.lesson?.slice(0,300)}`);

      // Recent losing picks with reasoning
      const recentLosses = [...aiGradedBets,...myGradedBets]
        .filter(b=>b.result==='loss')
        .slice(0,5)
        .map(b=>`${b.pick} (${b.sport} ${b.odds>0?'+':''}${b.odds}): ${b.reasoning?.slice(0,150)||'no reasoning'}`);

      const msg = `SPORTS BETTING COACH REPORT

=== YOUR BETTING HISTORY ===
${summarize(aiGradedBets,'CLAUDE AI PICKS')}
${summarize(myGradedBets,'MY OWN PICKS')}
${summarize(groqGraded,'GROQ AI PICKS')}

=== SPORT + BET TYPE BREAKDOWN ===
${sportBetBreakdown||'Not enough data'}

=== CONFIDENCE CALIBRATION ===
${calibration}

=== RECENT LOSSES (what went wrong) ===
${recentLosses.join('\n')||'None'}

=== LESSONS LEARNED SO FAR ===
${lessonCategories.join('\n')||'None yet'}

=== PENDING PICKS TONIGHT ===
${pendingPicks.join('\n')||'None'}

=== SELF-TUNING STATUS ===
${buildTuningPrompt(state.simTuning||{}, state.betTypePerf||{}, state.confTiers||{}, [])}

=== PREVIOUS BACKTEST FINDINGS ===
${backtestReports.length?backtestReports.join('\n'):'No backtests run yet — run backtest buttons above'}

Based ONLY on this data, provide a coaching report. Do NOT make up stats or reference games you don't have data for. Return ONLY this JSON:
{
  "grade": "A/B/C/D/F",
  "headline": "one sharp sentence summarizing current performance",
  "strengths": ["2-3 specific strengths with actual numbers from the data"],
  "weaknesses": ["2-3 specific weaknesses with actual numbers from the data"],
  "patterns": ["2-3 betting patterns identified — good or bad"],
  "rules": ["3 specific rules to follow going forward based on the data — e.g. stop betting NHL totals, increase stake on MLB ML underdogs"],
  "pending_opinion": "brief opinion on tonight's pending picks if any",
  "next_focus": "single most important thing to change right now"
}`;

      const raw = await callClaude([{role:'user',content:msg}],
      'You are a sharp sports betting coach. Analyze ONLY the data provided. Never hallucinate stats or reference games not in the data. Be specific with numbers. JSON only.',false);
      let report={};
      try {
        const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
        const s=clean.indexOf('{'),e=clean.lastIndexOf('}');
        if(s!==-1&&e!==-1) report=JSON.parse(clean.slice(s,e+1));
      } catch{}
      setCoachReport({...report, date:new Date().toISOString(), betsAnalyzed:totalGraded});
      addLog(`🎯 Coach analysis complete — ${totalGraded} bets analyzed`);
    } catch(err){setError('Coach failed: '+err.message);}
    setCoachLoading(false);
  },[state.bets,state.lessons]);

  const parseTrackerOutput = async () => {
    if (!trackerPaste.trim()) { setTrackerError('Paste model output first.'); return; }
    setTrackerParsing(true); setTrackerError('');
    const sys = `You are parsing sports model terminal output. Extract ALL actionable picks/recommendations.

For NHL output look for:
  KELLY BETS section: AWAY | Edge:+12.08% | Kelly:5.34% | STRONG BET
  WIN%: Home:44.5% Away:55.5%, ML odds: Home:-154 Away:+130

For MLB NRFI output look for:
  STRONG NRFI, LEAN NRFI ratings with probability %

For MLB HR PROP output look for:
  ACTIONABLE PLAYS section with batter name, CORR%, FAIR odds
  Format: "Kyle Schwarber vs Edward Cabrera  41.5%  32.4%  +209"
  Only extract players in ACTIONABLE PLAYS section (not watch list)

Return a JSON array where each object has:
  pick - string: e.g. "PHI @ PIT — AWAY ML" or "Kyle Schwarber HR" or "DET@BOS NRFI"
  sport - string: NHL or MLB
  modelProb - number: probability % e.g. 32.4 (use CORR% for HR props)
  odds - integer: American odds e.g. +209 (use FAIR odds for HR props)
  rating - string: STRONG BET, VALUE BET, LEAN, or HR PROP
  edge - string: edge % if present
  keyStats - string: key stats (for HR: raw%, corr%, season HR, recent AB)
  recommendation - string: HOME/AWAY/OVER/UNDER/NRFI/HR
  confidence - number: confidence % (use corr% for HR props)

Only extract actionable picks. Respond ONLY with a JSON array.`;
    try {
      // Try direct regex parse for HR prop model first
      if (trackerSport==='MLB' && trackerPaste.includes('ACTIONABLE PLAYS')) {
        const hrPicks = [];
        const lines = trackerPaste.split('\n');
        let inActionable = false;
        for (const line of lines) {
          if (line.includes('ACTIONABLE PLAYS')) { inActionable = true; continue; }
          if (inActionable && line.includes('WATCH LIST')) break;
          if (inActionable && line.trim() && !line.includes('---') && !line.includes('BATTER') && !line.includes('===')) {
            // Parse: "Kyle Schwarber  vs Edward Cabrera  41.5%  32.4%  +209  8HR  2HR/24AB  CHC(1.05)"
            const match = line.match(/([A-Za-z\s]+?)\s+vs\s+([A-Za-z\s]+?)\s+([\d.]+)%\s+([\d.]+)%\s+(\+[\d]+)/);
            if (match) {
              hrPicks.push({
                id: uid(),
                date: new Date().toISOString().split('T')[0],
                sport: 'MLB',
                pick: `${match[1].trim()} — HR PROP`,
                modelProb: parseFloat(match[4]),
                odds: parseInt(match[5]),
                rating: 'HR PROP',
                keyStats: `Raw: ${match[3]}% | Corr: ${match[4]}% | vs ${match[2].trim()}`,
                recommendation: 'HR',
                result: 'pending',
                score: '',
                source: 'model',
              });
            }
          }
        }
        if (hrPicks.length > 0) {
          setState(s=>({...s, trackedPicks:[...hrPicks,...s.trackedPicks]}));
          setTrackerPaste('');
          addLog(`📡 Tracked ${hrPicks.length} HR prop picks`);
          setTrackerParsing(false);
          return;
        }
      }

      const raw = await callClaude([{role:'user',content:`Sport: ${trackerSport}

${trackerPaste.slice(0,10000)}`}],sys,false);
      let picks=[];
      const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const s=clean.indexOf('['),e=clean.lastIndexOf(']');
      if(s!==-1&&e!==-1) picks=JSON.parse(clean.slice(s,e+1));
      if(!picks.length){setTrackerError('No picks found.');setTrackerParsing(false);return;}
      const newPicks = picks.map(p=>({
        id:uid(), date:new Date().toISOString().split('T')[0],
        sport:trackerSport, pick:p.pick||'', modelProb:p.modelProb||null,
        odds:parseInt(p.odds)||null, rating:p.rating||'', pitchers:p.pitchers||'',
        keyStats:p.keyStats||'', recommendation:p.recommendation||'',
        result:'pending', score:'', source:'model',
      }));
      setState(s=>({...s,trackedPicks:[...newPicks,...s.trackedPicks]}));
      setTrackerPaste('');
      addLog(`📡 Tracked ${newPicks.length} ${trackerSport} model picks`);
    } catch(e){setTrackerError('Parse failed: '+e.message);}
    setTrackerParsing(false);
  };

  const runTrackerBacktest = async () => {
    const sportPicks = state.trackedPicks.filter(p=>p.sport===trackerSport);
    const graded = sportPicks.filter(p=>p.result!=='pending');
    if (graded.length < 5) { setTrackerError('Need at least 5 graded picks to backtest'); return; }
    setTrackerAnalyzing(true);
    addLog(`🔬 Running ${trackerSport} model backtest on ${graded.length} picks...`);
    try {
      const wins = graded.filter(p=>p.result==='win').length;
      
      // By rating
      const byRating = {};
      graded.forEach(p=>{
        const r = p.rating?.includes('STRONG')?'STRONG BET':p.rating?.includes('VALUE')?'VALUE BET':'LEAN';
        if(!byRating[r]) byRating[r]={wins:0,total:0,probs:[]};
        byRating[r].total++;
        if(p.result==='win') byRating[r].wins++;
        if(p.modelProb) byRating[r].probs.push(parseFloat(p.modelProb));
      });

      // By bet type
      const byType = {};
      graded.forEach(p=>{
        const t = p.recommendation||'OTHER';
        if(!byType[t]) byType[t]={wins:0,total:0};
        byType[t].total++;
        if(p.result==='win') byType[t].wins++;
      });

      // By odds range
      const byOdds = {'heavy fav (<-150)':{w:0,l:0},'fav (-110 to -150)':{w:0,l:0},'pick':{w:0,l:0},'dog (+110+)':{w:0,l:0}};
      graded.forEach(p=>{
        const o = p.odds||0;
        const tier = o<-150?'heavy fav (<-150)':o<=-110?'fav (-110 to -150)':o<=109?'pick':'dog (+110+)';
        if(p.result==='win') byOdds[tier].w++;
        else byOdds[tier].l++;
      });

      const ratingStr = Object.entries(byRating).map(([r,v])=>{
        const wr=(v.wins/v.total*100).toFixed(0);
        const avgP=v.probs.length?(v.probs.reduce((a,b)=>a+b,0)/v.probs.length).toFixed(0):'?';
        return `${r}: ${v.wins}W-${v.total-v.wins}L (${wr}% actual vs ${avgP}% model)`;
      }).join(' | ');

      const typeStr = Object.entries(byType).filter(([,v])=>v.total>0).map(([t,v])=>`${t}: ${v.wins}W-${v.total-v.wins}L (${(v.wins/v.total*100).toFixed(0)}%)`).join(' | ');
      const oddsStr = Object.entries(byOdds).filter(([,v])=>v.w+v.l>0).map(([t,v])=>`${t}: ${v.w}W-${v.l}L (${(v.w/(v.w+v.l)*100).toFixed(0)}%)`).join(' | ');

      const losses = graded.filter(p=>p.result==='loss').slice(0,8).map(p=>`${p.pick} | prob:${p.modelProb}% | ${p.rating} | score:${p.score||'?'}`);
      const wins_list = graded.filter(p=>p.result==='win').slice(0,5).map(p=>`${p.pick} | prob:${p.modelProb}% | ${p.rating}`);

      const msg = `You are analyzing a ${trackerSport} prediction model (Dixon-Coles/Monte Carlo) to identify specific parameter tweaks.

OVERALL: ${graded.length} picks | ${wins}W-${graded.length-wins}L | ${(wins/graded.length*100).toFixed(1)}% win rate

BY RATING TIER (model prob vs actual):
${ratingStr}

BY BET TYPE:
${typeStr}

BY ODDS RANGE:
${oddsStr}

WINNING PICKS:
${wins_list.join('\n')}

LOSING PICKS:
${losses.join('\n')}

Provide specific ${trackerSport} model calibration recommendations:
1. Which rating thresholds need adjustment and by how much?
2. Which bet types to focus on or eliminate?
3. Specific parameter changes (lambda multiplier, home advantage, Kelly threshold)?
4. Filter rules to add before placing bets?
5. Overall grade A-F

Be specific with numbers. This is for the model developer.`;

      const analysis = await callClaude([{role:'user',content:msg}],
        `You are a quantitative ${trackerSport} model analyst. Give specific parameter recommendations with numbers. Plain text.`,false);
      
      setTrackerAnalysis(analysis);
      addLog(`✅ ${trackerSport} model backtest complete`);
    } catch(e) { setTrackerError('Backtest failed: '+e.message); addLog('❌ Backtest error: '+e.message); }
    setTrackerAnalyzing(false);
  };

  const gradeTracked = (id, result, score='') => {
    setState(s=>({...s,trackedPicks:s.trackedPicks.map(p=>p.id===id?{...p,result,score}:p)}));
    addLog(`📡 Graded tracked pick: ${result.toUpperCase()}`);
  };

  const deleteTracked = (id) => {
    setState(s=>({...s,trackedPicks:s.trackedPicks.filter(p=>p.id!==id)}));
  };

  const analyzeTracker = async () => {
    const sportPicks = state.trackedPicks.filter(p=>p.sport===trackerSport);
    const graded = sportPicks.filter(p=>p.result!=='pending');
    if(graded.length<5){setTrackerError('Need at least 5 graded picks for analysis.');return;}
    setTrackerAnalyzing(true); setTrackerAnalysis('');
    const wins=graded.filter(p=>p.result==='win').length;
    const byRating={};
    graded.forEach(p=>{
      const r=p.rating||'Unknown';
      if(!byRating[r])byRating[r]={w:0,l:0,probs:[]};
      if(p.result==='win')byRating[r].w++;
      else if(p.result==='loss')byRating[r].l++;
      if(p.modelProb)byRating[r].probs.push(p.modelProb);
    });
    const ratingStr=Object.entries(byRating).map(([r,v])=>`${r}: ${v.w}W-${v.l}L avg_prob=${v.probs.length?((v.probs.reduce((a,b)=>a+b,0)/v.probs.length).toFixed(1)):'-'}%`).join(', ');
    try {
      // Build bet type breakdown
      const byType = {};
      graded.forEach(p=>{
        const t = p.recommendation||'OTHER';
        if(!byType[t]) byType[t]={w:0,l:0};
        byType[t][p.result==='win'?'w':'l']++;
      });
      const typeStr = Object.entries(byType).map(([t,v])=>`${t}: ${v.w}W-${v.l}L (${(v.w/(v.w+v.l)*100).toFixed(0)}%)`).join(' | ');

      const analysis = await callClaude([{role:'user',content:`You are analyzing a Dixon-Coles NHL prediction model to identify specific parameter tweaks needed.

MODEL: ${trackerSport} Dixon-Coles with Bayesian updating, Monte Carlo simulation, temporal decay
TOTAL: ${graded.length} graded picks | ${wins}W-${graded.length-wins}L | ${(wins/graded.length*100).toFixed(1)}% actual win rate

BY RATING TIER (model predicted prob vs actual):
${ratingStr}

BY BET TYPE:
${typeStr}

RECENT PICKS (pick, model prob, rating, result):
${graded.slice(0,20).map(p=>`${p.pick} | prob:${p.modelProb}% | ${p.rating} | ${p.result} | score:${p.score||'?'}`).join('\n')}

Based on this data provide SPECIFIC model tweaks:
1. CALIBRATION: Is the model over/underconfident? By how much? What lambda multiplier adjustment is needed?
2. HOME/AWAY BIAS: Is the model biased toward home or away teams? How to fix?
3. RATING THRESHOLDS: Should STRONG BET threshold be raised/lowered? Current edge cutoffs?
4. BET TYPE PERFORMANCE: Which bet types to focus on or eliminate?
5. SPECIFIC PARAMETER CHANGES: e.g. "Increase temporal decay weight", "Reduce home ice advantage factor by X%", "Raise Kelly threshold from 3% to 5%"
6. FILTER RULES: What filters to add before placing a bet (e.g. only bet when confidence>65% AND data quality>80%)

Be specific with numbers. This goes directly to the model developer.`}],
      'You are a quantitative sports model analyst. Give specific, actionable parameter recommendations with numbers. Plain text, no JSON.',false);
      setTrackerAnalysis(analysis);
      // Feed into lessons for AI coach
      setState(s=>({...s,lessons:[{id:uid(),date:new Date().toISOString(),title:`📡 Model Analysis (${graded.length} picks)`,category:'Model Tracker',body:analysis,takeaway:analysis.split('.')[0]},...s.lessons]}));
      addLog('📡 Model analysis complete');
    } catch(e){setTrackerError('Analysis failed: '+e.message);}
    setTrackerAnalyzing(false);
  };

  const loadGroqGames = async () => {
    setGroqLoading(true); setGroqGames([]);
    try {
      const r = await fetch(`/api/games?sport=${groqSport}`);
      const data = await r.json();
      if (data.success && data.games?.length) {
        setGroqGames(data.games);
        addLog(`📡 Loaded ${data.games.length} ${groqSport} games from ESPN`);
      } else {
        addLog(`⚠️ No ${groqSport} games found today`);
      }
    } catch(e) { setError('Failed to load games: '+e.message); addLog('❌ '+e.message); }
    setGroqLoading(false);
  };

  const generateGroqPicks = async () => {
    setGroqLoading(true);
    addLog(`🧠 Groq finding value in ${groqSport}...`);
    try {
      // Step 1: Load today's games
      const gamesRes = await fetch(`/api/games?sport=${groqSport}`);
      const gamesData = await gamesRes.json();
      if (!gamesData.success || !gamesData.games?.length) {
        addLog(`⚠️ No ${groqSport} games today`);
        setGroqLoading(false);
        return;
      }
      setGroqGames(gamesData.games);
      addLog(`📡 ${gamesData.games.length} games loaded from ${gamesData.source||'unknown'}`);
      addLog(`📡 Sample odds: ${gamesData.games[0]?.homeTeam} ${gamesData.games[0]?.homeML} vs ${gamesData.games[0]?.awayTeam} ${gamesData.games[0]?.awayML}`);

      // Step 2: Fetch stats then run sims on all games
      const simResults = await Promise.all(
        gamesData.games.map(async g => {
          try {
            // Fetch team stats first for independent lambda calculation
            let homeStats = null, awayStats = null;
            try {
              const statsR = await fetch(`/api/stats/${g.sport.toLowerCase()}?home=${encodeURIComponent(g.homeTeam)}&away=${encodeURIComponent(g.awayTeam)}`);
              const statsD = await statsR.json();
              if (statsD.success) { homeStats = statsD.home?.stats; awayStats = statsD.away?.stats; }
            } catch {}

            const r = await fetch('/api/simulate', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({sport:g.sport, homeTeam:g.homeTeam, awayTeam:g.awayTeam, homeOdds:g.homeML||g.homeOdds, awayOdds:g.awayML||g.awayOdds, homeStats, awayStats}),
            });
            const sim = await r.json();
            return {...g, sim, homeStats, awayStats};
          } catch { return {...g, sim:null}; }
        })
      );

      // Step 3: Use all games with successful sims
      addLog(`📊 Sims complete: ${simResults.filter(g=>g.sim?.success).length}/${simResults.length} successful`);
      
      const withEdge = simResults
        .filter(g=>g.sim?.success && g.sim?.simulation?.homeWinProb != null)
        .map(g=>({
          ...g,
          homeEdge: (g.sim.simulation.homeWinProb||50) - (g.sim.homeNoVigProb||50),
          awayEdge: (g.sim.simulation.awayWinProb||50) - (g.sim.awayNoVigProb||50),
        }))
        .sort((a,b)=>Math.max(b.homeEdge,b.awayEdge)-Math.max(a.homeEdge,a.awayEdge));

      addLog(`📊 Analyzing all ${withEdge.length} games...`);

      if (!withEdge.length) {
        addLog(`⚠️ No games with successful sims in ${groqSport} today`);
        setGroqLoading(false);
        return;
      }

      addLog(`📊 Found ${withEdge.length} games with edge — sending to Groq...`);

      // Step 4: Get stats and send to Groq for final analysis
      const appContext = buildTuningPrompt(state.simTuning||{}, state.betTypePerf||{}, state.confTiers||{}, []);

      for (const g of withEdge) {
        try {
          // Get stats context
          let statsContext = '';
          try {
            const ctxRes = await fetch('/api/context', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({sport:g.sport, homeTeam:g.homeTeam, awayTeam:g.awayTeam}),
            });
            const ctxData = await ctxRes.json();
            if (ctxData.success) statsContext = ctxData.context;
          } catch {}

          if (!g.sim?.success) { addLog(`⚠️ Skipping ${g.homeTeam} — sim failed`); continue; }

          const analyzeRes = await fetch('/api/analyze', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
              gameData:{...g, homeImpliedProb:g.sim?.homeImpliedProb||50, awayImpliedProb:g.sim?.awayImpliedProb||50},
              simulationData:g.sim,
              statsContext,
              appContext,
              betType:'ML',
              nrfiProb:g.sim?.simulation?.nrfiProb,
              yrfiProb:g.sim?.simulation?.yrfiProb,
            }),
          });
          const analyzeData = await analyzeRes.json();
          addLog(`📊 ${g.homeTeam}: verdict=${analyzeData.analysis?.verdict} side=${analyzeData.analysis?.side}`);

          if (analyzeData.analysis?.verdict==='BET' && analyzeData.analysis?.side) {
            const odds = analyzeData.analysis.side===g.homeTeam ? parseInt(g.homeML||g.homeOdds) : parseInt(g.awayML||g.awayOdds);
            const dec = odds>0?odds/100+1:100/Math.abs(odds)+1;
            const simWinProb = (analyzeData.analysis.side===g.homeTeam ? g.sim?.simulation?.homeWinProb : g.sim?.simulation?.awayWinProb)||50;
            const kellyFrac = Math.max(0,((dec-1)*(simWinProb/100)-(1-simWinProb/100))/(dec-1));
            const halfKelly = kellyFrac/2;
            // Use half Kelly capped at 10% bankroll, min $5
            const currentGroqBankroll = parseFloat(computedGroqBankroll||state.groqBankroll)||252;
            const kellyStake = currentGroqBankroll * Math.min(halfKelly, 0.10);
            const stake = Math.max(5, Math.min(Math.round(kellyStake/5)*5, Math.round(currentGroqBankroll*0.10)));

            addGroqPick({
              pick:`${analyzeData.analysis.side} — ${g.awayTeam} @ ${g.homeTeam}`,
              sport:g.sport, betType:'Moneyline', odds, stake,
              confidence:analyzeData.analysis.confidence,
              reasoning:analyzeData.analysis.edge_summary+' | '+(analyzeData.analysis.full_analysis?.slice(0,300)||''),
              keyFactors:[analyzeData.analysis.sharp_factors||'',analyzeData.analysis.risk_factors||''].filter(Boolean),
              modelProb:analyzeData.analysis.side===g.homeTeam?g.sim.simulation?.homeWinProb:g.sim.simulation?.awayWinProb,
              edge:`${analyzeData.analysis.confidence}% conf`,
              simConfidence:analyzeData.analysis.confidence,
            });
            addLog(`🤖 Groq: ${analyzeData.analysis.side} (${analyzeData.analysis.confidence}% conf)`);
          }
        } catch(e) { addLog(`❌ Analysis failed for ${g.homeTeam}: ${e.message}`); }
      }

      addLog(`✅ Groq analysis complete`);
      setTab('groq');
    } catch(e) { addLog(`❌ Groq error: ${e.message}`); }
    setGroqLoading(false);
  };

  const runGroqAnalysis = async (game, betType='ML') => {
    const key = game.homeTeam+game.awayTeam+(betType||'ML');
    setGroqAnalyzing(key);
    addLog(`🧠 Groq analyzing: ${game.awayTeam} @ ${game.homeTeam} (${betType})`);
    try {
      // Step 1: Fetch stats context
      let statsContext = '';
      try {
        const ctxRes = await fetch('/api/context', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sport:game.sport, homeTeam:game.homeTeam, awayTeam:game.awayTeam, gameId:game.gameId}),
        });
        const ctxData = await ctxRes.json();
        if (ctxData.success) statsContext = ctxData.context;
      } catch(e) { console.warn('Stats fetch failed:', e.message); }

      // Step 2: Run Monte Carlo simulation
      let simData = null;
      try {
        const simRes = await fetch('/api/simulate', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sport:game.sport, homeTeam:game.homeTeam, awayTeam:game.awayTeam, homeOdds:game.homeML||game.homeOdds, awayOdds:game.awayML||game.awayOdds}),
        });
        simData = await simRes.json();
        addLog(`📡 Sim OK: ${simData?.simulation?.homeWinProb}% home`);
      } catch(e) { addLog(`❌ Sim failed: ${e.message}`); simData = {simulation:{homeWinProb:50,awayWinProb:50},analysis:{homeEdge:0,awayEdge:0,homeEV:0,awayEV:0,homeKelly:{halfKelly:0},awayKelly:{halfKelly:0}},recommendation:'PASS',homeImpliedProb:50,awayImpliedProb:50}; }

      // Step 3: Build app context (betting history + tuning)
      const appContext = buildTuningPrompt(state.simTuning||{}, state.betTypePerf||{}, state.confTiers||{}, []);
      const groqBacktest = state.lessons.filter(l=>l.source==='backtest').slice(0,2).map(l=>l.lesson?.slice(0,200)).filter(Boolean).join('\n');

      // Step 4: Run Groq AI analysis with full context
      const analyzeRes = await fetch('/api/analyze', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          gameData:{...game, homeImpliedProb:simData.homeImpliedProb, awayImpliedProb:simData.awayImpliedProb},
          simulationData:simData,
          statsContext,
          appContext,
          betType,
          nrfiProb:simData.simulation?.nrfiProb,
          backtestContext:groqBacktest||'',
          yrfiProb:simData.simulation?.yrfiProb,
        }),
      });
      const analyzeData = await analyzeRes.json();

      addLog(`🧠 Groq response: success=${analyzeData.success} verdict=${analyzeData.analysis?.verdict} side=${analyzeData.analysis?.side} conf=${analyzeData.analysis?.confidence} error=${analyzeData.error||'none'}`);
      if (analyzeData.raw) addLog(`🧠 Groq raw: ${analyzeData.raw?.slice(0,100)}`);
      setGroqResults(r=>({...r,[key]:{sim:simData,analysis:analyzeData.analysis,game}}));
      addLog(`✅ Stored result for key: ${key} verdict: ${analyzeData.analysis?.verdict}`);

      // If BET, add to AI picks
      if (analyzeData.analysis?.verdict==='BET' && analyzeData.analysis?.side) {
        const odds = analyzeData.analysis.side===game.homeTeam ? parseInt(game.homeOdds) : parseInt(game.awayOdds);
        const dec = odds>0?odds/100+1:100/Math.abs(odds)+1;
        const kelly = Math.max(0,((dec-1)*(analyzeData.analysis.confidence/100)-(1-analyzeData.analysis.confidence/100))/(dec-1)*0.25);
        const stake = Math.max(5,Math.min(Math.round(state.bankroll*kelly/5)*5,Math.round(state.bankroll*0.05)));
        addGroqPick({
          pick:`${analyzeData.analysis.side} — ${game.awayTeam} @ ${game.homeTeam}`,
          sport:game.sport, betType:'Moneyline', odds, stake,
          confidence:analyzeData.analysis.confidence,
          reasoning:analyzeData.analysis.edge_summary+' | '+analyzeData.analysis.full_analysis?.slice(0,200)||'',
          keyFactors:[analyzeData.analysis.sharp_factors||'',analyzeData.analysis.risk_factors||''].filter(Boolean),
          modelProb:analyzeData.analysis.side===game.homeTeam?simData.simulation?.homeWinProb:simData.simulation?.awayWinProb,
          edge:`${analyzeData.analysis.confidence}% conf`,
          simConfidence:analyzeData.analysis.confidence,
        });
        addLog(`🤖 Groq AI: ${analyzeData.analysis.side} (${analyzeData.analysis.confidence}% conf)`);
      }
    } catch(e) { addLog(`❌ Groq error: ${e.message}`); } finally { setGroqAnalyzing(null); }
  };

  const runBacktest = async (source) => {
    const sourceBets = state.bets.filter(b=>b.source===source&&b.result!=='pending');
    if (sourceBets.length < 3) { setError(`Need at least 3 graded ${source} picks to backtest`); return; }
    setCoachLoading(true);
    addLog(`🔬 Running ${source} backtest on ${sourceBets.length} picks...`);
    try {
      // Group by sport
      const bySport = {};
      sourceBets.forEach(b=>{
        if(!bySport[b.sport]) bySport[b.sport]={wins:0,losses:0,bets:[]};
        if(b.result==='win') bySport[b.sport].wins++;
        else bySport[b.sport].losses++;
        bySport[b.sport].bets.push(b);
      });

      // Group by confidence tier
      const byConf = {'55-64':{w:0,l:0},'65-74':{w:0,l:0},'75+':{w:0,l:0}};
      sourceBets.forEach(b=>{
        const tier = b.confidence>=75?'75+':b.confidence>=65?'65-74':'55-64';
        if(b.result==='win') byConf[tier].w++;
        else byConf[tier].l++;
      });

      // Group by odds range
      const byOdds = {'heavy fav (<-150)':{w:0,l:0},'fav (-110 to -150)':{w:0,l:0},'pick (-109 to +109)':{w:0,l:0},'dog (+110 to +200)':{w:0,l:0},'big dog (>+200)':{w:0,l:0}};
      sourceBets.forEach(b=>{
        const o = b.odds;
        const tier = o<-150?'heavy fav (<-150)':o<=-110?'fav (-110 to -150)':o<=109?'pick (-109 to +109)':o<=200?'dog (+110 to +200)':'big dog (>+200)';
        if(b.result==='win') byOdds[tier].w++;
        else byOdds[tier].l++;
      });

      // Recent reasoning patterns in losses
      const losses = sourceBets.filter(b=>b.result==='loss')
        .map(b=>`${b.pick} (${b.sport} ${b.odds>0?'+':''}${b.odds} conf:${b.confidence}%): ${b.reasoning?.slice(0,200)||'no reasoning'}`);

      const wins = sourceBets.filter(b=>b.result==='win')
        .map(b=>`${b.pick} (${b.sport} ${b.odds>0?'+':''}${b.odds} conf:${b.confidence}%): ${b.reasoning?.slice(0,150)||'no reasoning'}`);

      const sportStr = Object.entries(bySport).map(([s,v])=>`${s}: ${v.wins}W-${v.losses}L (${(v.wins/(v.wins+v.losses)*100).toFixed(0)}%)`).join(' | ');
      const confStr = Object.entries(byConf).map(([t,v])=>v.w+v.l>0?`${t}%: ${v.w}W-${v.l}L (${(v.w/(v.w+v.l)*100).toFixed(0)}% actual)`:null).filter(Boolean).join(' | ');
      const oddsStr = Object.entries(byOdds).map(([t,v])=>v.w+v.l>0?`${t}: ${v.w}W-${v.l}L (${(v.w/(v.w+v.l)*100).toFixed(0)}%)`:null).filter(Boolean).join(' | ');

      const msg = `BACKTEST ANALYSIS for ${source.toUpperCase()} PICKS (${sourceBets.length} graded bets)

PERFORMANCE BY SPORT:
${sportStr}

CONFIDENCE CALIBRATION (predicted% vs actual win rate):
${confStr}

PERFORMANCE BY ODDS RANGE:
${oddsStr}

SAMPLE WINNING REASONING (what worked):
${wins.slice(0,5).join('\n')}

SAMPLE LOSING REASONING (what failed):
${losses.slice(0,5).join('\n')}

Based ONLY on this backtest data, identify:
1. Where is this model over/underperforming vs expected?
2. What reasoning patterns appear in wins vs losses?
3. Which sports/odds ranges should this model focus on or avoid?
4. Is the confidence calibration accurate?

Return ONLY this JSON:
{
  "overall_grade": "A/B/C/D/F",
  "calibration": "is confidence% matching actual win rate? specific numbers",
  "best_spots": ["top 2-3 specific situations where model performs well with data"],
  "avoid": ["top 2-3 specific situations to stop betting with data"],
  "reasoning_patterns": ["2-3 patterns found in wins vs losses"],
  "rules": ["3-5 specific rules this model should follow going forward"],
  "summary": "2-3 sentence honest assessment"
}`;

      const raw = await callClaude([{role:'user',content:msg}],
        'You are a quantitative sports betting analyst running a backtest. Analyze ONLY the provided data. Never reference games not in the data. Output specific actionable rules. JSON only.',false);

      let report = {};
      try {
        const clean = raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
        const s=clean.indexOf('{'), e=clean.lastIndexOf('}');
        if(s!==-1&&e!==-1) report = JSON.parse(clean.slice(s,e+1));
      } catch {}

      // Store as a special lesson
      const lesson = {
        id: uid(),
        date: new Date().toISOString().split('T')[0],
        sport: 'ALL',
        pick: `${source.toUpperCase()} BACKTEST (${sourceBets.length} picks)`,
        result: 'backtest',
        lesson: `BACKTEST REPORT

Grade: ${report.overall_grade}
${report.summary}

Best spots: ${report.best_spots?.join(', ')}
Avoid: ${report.avoid?.join(', ')}
Rules: ${report.rules?.join(' | ')}`,
        source: 'backtest',
        report,
      };
      setState(s=>({...s, lessons:[lesson,...s.lessons]}));
      addLog(`✅ ${source} backtest complete — grade: ${report.overall_grade}`);

    } catch(e) { addLog(`❌ Backtest failed: ${e.message}`); }
    setCoachLoading(false);
  };

  const resetAll=()=>{if(!confirm('Reset ALL data?'))return;setState({...EMPTY_STATE});};

  const runAutoTune = useCallback((bets, currentTuning, currentBetTypePerf, currentConfTiers) => {
    const graded = bets.filter(b=>b.result!=='pending'&&b.tracked);
    if (!shouldRetune(graded, lastTuneCount)) return;

    const { tuning, log } = analyzeSimTuning(graded, currentTuning);
    const betTypePerf = analyzeBetTypePerf(graded);
    const confTiers = analyzeConfTiers(graded);
    const insights = getBettingInsights(graded, betTypePerf, confTiers);

    setState(s=>({...s, simTuning:tuning, betTypePerf, confTiers}));
    setLastTuneCount(graded.length);
    setTuningLog(prev=>[{
      date: new Date().toISOString(),
      log,
      insights,
      totalGraded: graded.length,
    }, ...prev.slice(0,9)]);
    addLog(`🧠 Model self-tuned on ${graded.length} graded picks`);
  },[lastTuneCount]);
  // JSONBin.io cloud sync
  const JSONBIN_KEY = JSONBIN_MASTER_KEY;
  const JSONBIN_URL = 'https://api.jsonbin.io/v3/b';

  const saveToDrive = async (stateToSave) => {
    addLog('☁️ Saving to cloud...');
    try {
      const binId = localStorage.getItem('betlab_bin_id');
      const dataToSave = {
        bankroll:stateToSave.bankroll, startingBankroll:stateToSave.startingBankroll,
        myBankroll:stateToSave.myBankroll, myStartingBankroll:stateToSave.myStartingBankroll,
        groqBankroll:stateToSave.groqBankroll, groqStartingBankroll:stateToSave.groqStartingBankroll,
        bets:stateToSave.bets.slice(0,100), lessons:stateToSave.lessons,
        trackedPicks:stateToSave.trackedPicks, simTuning:stateToSave.simTuning,
        betTypePerf:stateToSave.betTypePerf, confTiers:stateToSave.confTiers,
        savedAt:new Date().toISOString(),
      };
      const url = binId ? `/api/context?action=save&binId=${binId}` : '/api/context?action=save';
      const res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(dataToSave),
      });
      const data = await res.json();
      if (data.success) {
        if (!binId && data.metadata?.id) {
          localStorage.setItem('betlab_bin_id', data.metadata.id);
          addLog('☁️ Cloud backup created! ID: '+data.metadata.id);
        } else {
          addLog('☁️ Saved to cloud: '+new Date().toLocaleTimeString());
        }
      } else {
        addLog('❌ Cloud save failed: '+JSON.stringify(data));
      }
    } catch(e) { addLog('❌ Cloud save error: '+e.message); }
  };

  const loadFromDrive = async () => {
    try {
      const binId = localStorage.getItem('betlab_bin_id');
      if (!binId) { addLog('⚠️ No cloud backup found — save first'); return false; }
      const res = await fetch(`/api/context?action=load&binId=${binId}`);
      const data = await res.json();
      if (data.success && data.record) {
        setState(s=>({...s,...data.record}));
        addLog('☁️ Loaded from cloud ('+new Date(data.record.savedAt).toLocaleString()+')');
        return true;
      }
      addLog('❌ Cloud load failed');
    } catch(e) { addLog('❌ Cloud load error: '+e.message); }
    return false;
  };


  const exportData = () => {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `betlab-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('💾 Data exported to file');
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setState(s=>({...s,...data}));
        addLog('✅ Data imported from file');
      } catch(err) { alert('Import failed: '+err.message); }
    };
    reader.readAsText(file);
  };

  const importDraftKings = (text) => {
    // Join all lines and split by date pattern to get individual bets
    const lines = text.trim().split('\n').map(l=>l.trim()).filter(l=>l);
    const bets = [];
    
    // Reconstruct single-line bets from multi-line format
    // Group lines into bet records - each bet starts with a date or month
    const betLines = [];
    let current = [];
    
    for (const line of lines) {
      // New bet starts with date pattern like "Mar 24," or "Feb 28,"
      const isDate = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/.test(line);
      if (isDate && current.length > 0) {
        betLines.push(current.join(' '));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) betLines.push(current.join(' '));

    for (const line of betLines) {
      if (!line.trim()) continue;
      
      // Extract status
      const status = line.match(/(Won|Lost|Cashed Out|Push|Void)/i)?.[1]||'';
      if (!status) continue;
      const result = /won|cashed/i.test(status)?'win':/lost/i.test(status)?'loss':'push';
      
      // Extract all dollar amounts
      const dollars = [...line.matchAll(/\$([\d,]+\.\d{2})/g)].map(m=>parseFloat(m[1].replace(',','')));
      const stake = dollars[0]||5;
      
      // Extract odds
      const oddsMatch = line.match(/([+-]\d{2,4})(?=\s)/);
      const odds = oddsMatch ? parseInt(oddsMatch[1]) : -110;
      
      // Extract bet type
      const typeMatch = line.match(/(SGPx|SGP|Parlay|Single|Live)/i);
      const betType = typeMatch?.[1]||'Single';
      const isParlay = /parlay|sgp/i.test(betType);
      
      // Extract pick - remove date, type, odds, dollar amounts, status
      let pick = line
        .replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+:\d+\s+(AM|PM)/i,'')
        .replace(/(SGPx|SGP|Parlay|Single|Live)\s*(\(\d+-Leg\))?/gi,'')
        .replace(/[+-]\d{2,4}/g,'')
        .replace(/\$[\d,]+\.\d{2}/g,'')
        .replace(/(Won|Lost|Cashed Out|Push|Void)/gi,'')
        .replace(/\s+/g,' ').trim();
      
      if (!pick || pick.length < 3) continue;
      
      const sport = /\b(NBA|MLB|NFL)\b/i.test(pick)?pick.match(/\b(NBA|MLB|NFL)\b/i)[1].toUpperCase():'NHL';
      
      bets.push({
        id:uid(), pick, sport,
        betType: isParlay?'Parlay':'Moneyline',
        betCategory: isParlay?'parlay':'straight',
        odds: isNaN(odds)?-110:odds,
        stake: isNaN(stake)?5:stake,
        result, date:new Date().toISOString(), source:'paste',
        reasoning:'Imported from DraftKings', keyFactors:[], confidence:60,
        modelProb:null, rating:'', edge:'', legs:[],
      });
    }
    
    if (!bets.length) { alert('No bets parsed. Try pasting more of the history including dates.'); return; }
    setState(s=>({...s, bets:[...bets,...s.bets]}));
    addLog(`✅ Imported ${bets.length} bets from DraftKings`);
    setTab('mine');
  };


  // Auto-grade when opening dashboard - only once per session
  // Auto-grade disabled - use manual CHECK button to save API calls

  const TABS=['dashboard','ai','groq','paste','mine','tracker','lessons','log'];
  const TLABELS={dashboard:'📊 Dash',ai:'🤖 Claude',groq:'🧠 Groq',paste:'📋 Paste',mine:'📈 My Picks',tracker:'📡 Tracker',lessons:`🎓 (${state.lessons.length})`,log:'🪵 Log'};

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
            <h1 style={{fontFamily:"'Orbitron',sans-serif",fontSize:30,fontWeight:900,color:'#f1f5f9',letterSpacing:2}}>BET<span style={{color:'#1d4ed8'}}>LAB</span></h1>
          </div>

          {/* Groq Bankroll Card */}


          {/* Self-Learning Tuning Panel */}
          {tuningLog.length>0&&(
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:14,padding:'14px 16px',marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:10,color:'#fbbf24',letterSpacing:2}}>🧠 SELF-LEARNING STATUS</div>
                <button onClick={()=>setShowTuning(!showTuning)} style={{fontSize:10,color:'#475569',background:'none',border:'none',cursor:'pointer'}}>{showTuning?'▲ HIDE':'▼ SHOW'}</button>
              </div>
              {showTuning&&tuningLog[0]&&(
                <div>
                  <div style={{fontSize:10,color:'#475569',marginBottom:8}}>Last tuned on {tuningLog[0].totalGraded} picks · {new Date(tuningLog[0].date).toLocaleDateString()}</div>
                  {/* Sim multipliers */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4,marginBottom:8}}>
                    {tuningLog[0].log.filter(l=>l.status==='updated').map(l=>(
                      <div key={l.sport} style={{background:'rgba(5,8,16,0.8)',borderRadius:6,padding:'6px 8px',border:'1px solid #1e293b'}}>
                        <div style={{fontSize:9,color:'#fbbf24',fontWeight:700}}>{l.sport}</div>
                        <div style={{fontSize:12,color:l.newMultiplier>l.oldMultiplier?'#22c55e':l.newMultiplier<l.oldMultiplier?'#ef4444':'#475569',fontWeight:700}}>{l.newMultiplier}x</div>
                        <div style={{fontSize:9,color:'#334155'}}>sim {l.avgSimConf}% → actual {l.actualWR}%</div>
                        <div style={{fontSize:9,color:l.drift>0?'#22c55e':'#ef4444'}}>{l.drift>0?'+':''}{l.drift}% drift</div>
                      </div>
                    ))}
                    {tuningLog[0].log.filter(l=>l.status==='insufficient').map(l=>(
                      <div key={l.sport} style={{background:'rgba(5,8,16,0.8)',borderRadius:6,padding:'6px 8px',border:'1px solid #1e293b',opacity:0.5}}>
                        <div style={{fontSize:9,color:'#475569',fontWeight:700}}>{l.sport}</div>
                        <div style={{fontSize:9,color:'#334155'}}>{l.count}/{l.needed} picks</div>
                      </div>
                    ))}
                  </div>
                  {/* Insights */}
                  {tuningLog[0].insights?.map((ins,i)=>(
                    <div key={i} style={{fontSize:10,color:ins.type==='positive'?'#22c55e':'#f59e0b',marginBottom:3}}>{ins.msg}</div>
                  ))}
                  {/* Bet type performance */}
                  <div style={{marginTop:8,fontSize:9,color:'#475569',letterSpacing:1,marginBottom:4}}>BET TYPE PERFORMANCE</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {Object.entries(state.betTypePerf||{}).filter(([,p])=>p.total>=5).map(([type,p])=>{
                      const wr=p.wins/p.total*100;
                      return <span key={type} style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'rgba(5,8,16,0.8)',color:wr>55?'#22c55e':wr<48?'#ef4444':'#94a3b8'}}>{type}: {wr.toFixed(0)}% ({p.total})</span>;
                    })}
                  </div>
                  {/* Confidence tiers */}
                  <div style={{marginTop:6,fontSize:9,color:'#475569',letterSpacing:1,marginBottom:4}}>CONFIDENCE TIERS</div>
                  <div style={{display:'flex',gap:4}}>
                    {Object.entries(state.confTiers||{}).filter(([,t])=>t.total>=5).map(([tier,t])=>{
                      const wr=t.wins/t.total*100;
                      const label=tier==='high'?'75%+':tier==='mid'?'65-74%':'55-64%';
                      return <span key={tier} style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'rgba(5,8,16,0.8)',color:wr>55?'#22c55e':wr<48?'#ef4444':'#94a3b8'}}>{label}: {wr.toFixed(0)}% ({t.total})</span>;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3-Way AI Comparison */}
          {(()=>{
            const systems = [
              {label:'🤖 Claude', bets:aiBets, color:'#38bdf8', bankroll:state.bankroll, startBankroll:state.startingBankroll},
              {label:'🧠 Groq', bets:groqBets, color:'#8b5cf6', bankroll:computedGroqBankroll, startBankroll:state.groqStartingBankroll},
              {label:'📈 My Picks', bets:myBets, color:'#f97316', bankroll:state.myBankroll, startBankroll:state.myStartingBankroll},
            ];
            return (
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px',marginBottom:10}}>
                <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:10,color:'#475569',letterSpacing:2,marginBottom:10}}>⚡ AI COMPARISON</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
                  {systems.map(({label,bets,color,bankroll,startBankroll})=>{
                    const graded=bets.filter(b=>b.result!=='pending');
                    const wins=graded.filter(b=>b.result==='win').length;
                    const staked=graded.reduce((a,b)=>a+b.stake,0);
                    const profit=graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
                    const roi=staked?profit/staked*100:0;
                    const wr=graded.length?wins/graded.length*100:0;
                    const bankrollDiff=bankroll&&startBankroll?bankroll-startBankroll:null;
                    return (
                      <div key={label} style={{background:'rgba(5,8,16,0.8)',borderRadius:8,padding:'8px 10px',border:`1px solid ${color}22`}}>
                        <div style={{fontSize:10,color,fontWeight:700,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:13,color:wr>=55?'#22c55e':wr>0?'#ef4444':'#475569',fontWeight:700}}>{graded.length?`${wins}W-${graded.length-wins}L (${(wins/graded.length*100).toFixed(0)}%)`:'—'}</div>
                        {bankroll&&<div style={{fontFamily:"'Orbitron',sans-serif",fontSize:14,color:bankrollDiff>=0?'#22c55e':'#ef4444',fontWeight:700,marginTop:2}}>${bankroll.toFixed(0)}</div>}
                        <div style={{fontSize:10,color:roi>=0?'#22c55e':'#ef4444'}}>{graded.length?`${roi>=0?'+':''}${roi.toFixed(1)}% ROI`:'No data'}</div>
                        <div style={{fontSize:9,color:'#334155',marginTop:2}}>{bets.filter(b=>b.result==='pending').length} pending</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom: editingBankroll||editingMyBankroll?4:14}}>
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px'}}>
              <div style={{fontSize:9,color:'#60a5fa',letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>🤖 AI Bankroll</div>
              <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:22,color:state.bankroll>=state.startingBankroll?'#22c55e':'#ef4444',fontWeight:700,marginTop:2}}>${state.bankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569',marginTop:2}}>start ${state.startingBankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569'}}>{aiBets.filter(b=>b.result==='pending').length} pending</div>
              <button onClick={()=>{setBankrollInput('');setStartBankrollInput('');setEditingBankroll(true);setEditingMyBankroll(false);}} style={{marginTop:6,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #1d4ed844',background:'rgba(29,78,216,.1)',color:'#60a5fa',fontSize:10,fontWeight:700,cursor:'pointer'}}>EDIT</button>
            </div>
            <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:'14px 16px'}}>
              <div style={{fontSize:9,color:'#f97316',letterSpacing:2,textTransform:'uppercase',fontWeight:700}}>📋 My Picks</div>
              <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:22,color:state.myBankroll>=state.myStartingBankroll?'#22c55e':'#ef4444',fontWeight:700,marginTop:2}}>${state.myBankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569',marginTop:2}}>start ${state.myStartingBankroll.toFixed(0)}</div>
              <div style={{fontSize:10,color:'#475569'}}>{myBets.filter(b=>b.result==='pending').length} pending</div>
              <button onClick={()=>{setMyBankrollInput('');setMyStartBankrollInput('');setEditingMyBankroll(true);setEditingBankroll(false);setEditingGroqBankroll(false);}} style={{marginTop:6,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #f9731644',background:'rgba(249,115,22,.1)',color:'#f97316',fontSize:10,fontWeight:700,cursor:'pointer'}}>EDIT</button>
              <button onClick={()=>{setEditingGroqBankroll(true);setEditingBankroll(false);setEditingMyBankroll(false);}} style={{marginTop:6,width:'100%',padding:'5px 0',borderRadius:6,border:'1px solid #8b5cf644',background:'rgba(139,92,246,.1)',color:'#8b5cf6',fontSize:10,fontWeight:700,cursor:'pointer'}}>EDIT GROQ</button>
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
              <div style={{fontSize:10,color:'#f97316',fontWeight:700,marginBottom:10}}>📋 EDIT MY PICKS BANKROLL</div>
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
              {/* 3-way stat grid */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:14}}>
                {[
                  {label:'🤖 CLAUDE', graded:aiGraded, wins:aiStats.wins, pnl:state.bankroll-state.startingBankroll, color:'#60a5fa'},
                  {label:'🧠 GROQ', graded:groqGraded, wins:groqGraded.filter(b=>b.result==='win').length, pnl:computedGroqBankroll-state.groqStartingBankroll, color:'#8b5cf6'},
                  {label:'📋 MY PICKS', graded:myGraded, wins:myStats.wins, pnl:state.myBankroll-state.myStartingBankroll, color:'#f97316'},
                ].map(({label,graded,wins,pnl,color})=>{
                  const staked = graded.reduce((a,b)=>a+b.stake,0);
                  const roi = staked ? pnl/staked*100 : 0;
                  const roiC = roi>5?'#22c55e':roi>0?'#86efac':roi>-5?'#fbbf24':'#ef4444';
                  return (
                    <div key={label} style={{background:'rgba(10,18,35,0.9)',border:`1px solid ${color}33`,borderRadius:12,padding:'12px 10px',textAlign:'center'}}>
                      <div style={{fontSize:9,color,fontWeight:700,letterSpacing:1,marginBottom:6}}>{label}</div>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:16,color:pnl>=0?'#22c55e':'#ef4444',fontWeight:700,marginBottom:2}}>{pnl>=0?'+':''}{pnl.toFixed(0)}</div>
                      <div style={{fontSize:10,color:roiC,fontWeight:700}}>{roi>=0?'+':''}{roi.toFixed(1)}%</div>
                      <div style={{fontSize:10,color:'#64748b',marginTop:2}}>{graded.length?`${wins}W-${graded.length-wins}L`:'no picks'}</div>
                    </div>
                  );
                })}
              </div>
              <ROIComparison bets={state.bets} bankroll={state.bankroll} startingBankroll={state.startingBankroll} myBankroll={state.myBankroll} myStartingBankroll={state.myStartingBankroll} groqBankroll={computedGroqBankroll} groqStartingBankroll={state.groqStartingBankroll}/>

              {/* Streak Tracker */}
              {(aiStreak.current>0||myStreak.current>0)&&(
                <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#fbbf24',letterSpacing:2,marginBottom:10}}>🔥 STREAK TRACKER</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div style={{padding:'10px 12px',background:'rgba(5,8,16,0.5)',borderRadius:8,border:`1px solid ${aiStreak.type==='win'?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'}`}}>
                      <div style={{fontSize:9,color:'#60a5fa',fontWeight:700,marginBottom:4}}>🤖 AI BETS</div>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:aiStreak.type==='win'?'#22c55e':'#ef4444',fontWeight:700}}>{aiStreak.current} {aiStreak.type==='win'?'W':'L'}</div>
                      <div style={{fontSize:10,color:'#475569',marginTop:2}}>Best win streak: {aiStreak.longest_win} · Worst loss: {aiStreak.longest_loss}</div>
                    </div>
                    <div style={{padding:'10px 12px',background:'rgba(5,8,16,0.5)',borderRadius:8,border:`1px solid ${myStreak.type==='win'?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'}`}}>
                      <div style={{fontSize:9,color:'#f97316',fontWeight:700,marginBottom:4}}>📋 MY PICKS</div>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:myStreak.type==='win'?'#22c55e':'#ef4444',fontWeight:700}}>{myStreak.current} {myStreak.type==='win'?'W':'L'}</div>
                      <div style={{fontSize:10,color:'#475569',marginTop:2}}>Best win streak: {myStreak.longest_win} · Worst loss: {myStreak.longest_loss}</div>
                    </div>
                    {(()=>{
                      const gs=groqGraded;
                      let cur=0,type='win',lw=0,ll=0,cw=0,cl=0;
                      gs.slice().reverse().forEach(b=>{if(b.result==='win'){cw++;cl=0;}else{cl++;cw=0;}lw=Math.max(lw,cw);ll=Math.max(ll,cl);});
                      const last=gs[0];
                      cur=last?.result==='win'?gs.filter((b,i)=>i<gs.findIndex(x=>x.result!=='win')+1||gs.findIndex(x=>x.result!=='win')===-1).length:gs.filter((b,i)=>i<gs.findIndex(x=>x.result!=='loss')+1||gs.findIndex(x=>x.result!=='loss')===-1).length;
                      type=last?.result||'win';
                      return cur>0?(
                        <div style={{padding:'10px 12px',background:'rgba(5,8,16,0.5)',borderRadius:8,border:`1px solid ${type==='win'?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'}`}}>
                          <div style={{fontSize:9,color:'#8b5cf6',fontWeight:700,marginBottom:4}}>🧠 GROQ</div>
                          <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:type==='win'?'#22c55e':'#ef4444',fontWeight:700}}>{cur} {type==='win'?'W':'L'}</div>
                          <div style={{fontSize:10,color:'#475569',marginTop:2}}>Best win: {lw} · Worst loss: {ll}</div>
                        </div>
                      ):null;
                    })()}
                  </div>
                  {aiStreak.type==='loss'&&aiStreak.current>=3&&<div style={{marginTop:8,padding:'6px 10px',background:'rgba(239,68,68,0.05)',borderRadius:6,border:'1px solid rgba(239,68,68,0.2)',fontSize:11,color:'#fca5a5'}}>⚠️ AI on {aiStreak.current}-game loss streak — review recent picks before continuing</div>}
                  {myStreak.type==='loss'&&myStreak.current>=3&&<div style={{marginTop:8,padding:'6px 10px',background:'rgba(239,68,68,0.05)',borderRadius:6,border:'1px solid rgba(239,68,68,0.2)',fontSize:11,color:'#fca5a5'}}>⚠️ Your scripts on {myStreak.current}-game loss streak — check model calibration</div>}
                  {aiStreak.type==='win'&&aiStreak.current>=5&&<div style={{marginTop:8,padding:'6px 10px',background:'rgba(251,191,36,0.05)',borderRadius:6,border:'1px solid rgba(251,191,36,0.2)',fontSize:11,color:'#fbbf24'}}>🔥 AI on {aiStreak.current}-game win streak — variance may be inflating results</div>}
                </div>
              )}

              {/* Discipline Tracker */}
              {discipline&&(
                <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#a78bfa',letterSpacing:2,marginBottom:10}}>🎯 DISCIPLINE TRACKER</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                    <div style={{textAlign:'center'}}>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:'#38bdf8'}}>{discipline.modelWR.toFixed(0)}%</div>
                      <div style={{fontSize:9,color:'#475569'}}>MODEL WIN RATE</div>
                    </div>
                    <div style={{textAlign:'center'}}>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:20,color:'#f97316'}}>{discipline.myWR.toFixed(0)}%</div>
                      <div style={{fontSize:9,color:'#475569'}}>YOUR WIN RATE</div>
                    </div>
                  </div>
                  {discipline.skippedStrong>0&&(
                    <div style={{padding:'8px 10px',background:'rgba(251,191,36,0.05)',borderRadius:6,border:'1px solid rgba(251,191,36,0.2)',fontSize:11,color:'#fbbf24'}}>
                      📋 You skipped {discipline.skippedStrong} STRONG model pick{discipline.skippedStrong!==1?'s':''} — check tracker to see what happened
                    </div>
                  )}
                  {discipline.myWR>discipline.modelWR&&(
                    <div style={{marginTop:6,padding:'8px 10px',background:'rgba(34,197,94,0.05)',borderRadius:6,border:'1px solid rgba(34,197,94,0.2)',fontSize:11,color:'#22c55e'}}>
                      ✅ Your instincts are outperforming the model — trust your reads
                    </div>
                  )}
                  {discipline.modelWR>discipline.myWR+10&&(
                    <div style={{marginTop:6,padding:'8px 10px',background:'rgba(239,68,68,0.05)',borderRadius:6,border:'1px solid rgba(239,68,68,0.2)',fontSize:11,color:'#fca5a5'}}>
                      ⚠️ Model is beating your picks by {(discipline.modelWR-discipline.myWR).toFixed(0)}% — consider following model more closely
                    </div>
                  )}
                </div>
              )}
              <button onClick={runReview} disabled={loading||aiGraded.length<3} style={{width:'100%',padding:'12px 0',borderRadius:10,border:'1px solid #1e40af44',background:'rgba(29,78,216,.1)',color:aiGraded.length>=3?'#60a5fa':'#475569',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:8}}>
                📊 AI PERFORMANCE REVIEW {aiGraded.length<3?`(${3-aiGraded.length} more needed)`:''}
              </button>

              <button onClick={()=>autoGrade(false)} style={{width:'100%',padding:'10px 0',borderRadius:10,border:'1px solid #38bdf844',background:'rgba(56,189,248,0.1)',color:'#38bdf8',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:4}}>
                🔄 CHECK & AUTO-GRADE RESULTS
              </button>
              <button onClick={()=>autoGrade(true)} style={{width:'100%',padding:'8px 0',borderRadius:10,border:'1px solid #f59e0b44',background:'rgba(245,158,11,0.1)',color:'#f59e0b',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:8}}>
                👁 DRY RUN (preview only)
              </button>

              <button onClick={runCoach} disabled={coachLoading||state.bets.filter(b=>b.result!=='pending').length<10} style={{width:'100%',padding:'12px 0',borderRadius:10,border:'1px solid #a78bfa44',background:'rgba(167,139,250,.1)',color:state.bets.filter(b=>b.result!=='pending').length>=10?'#a78bfa':'#475569',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:14}}>
                {coachLoading?'🎯 ANALYZING...':'🎯 AI COACH'} {state.bets.filter(b=>b.result!=='pending').length<10?`(${10-state.bets.filter(b=>b.result!=='pending').length} more bets needed)`:''}
              </button>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:14}}>
                  <button onClick={()=>runBacktest('ai')} disabled={coachLoading} style={{padding:'8px 0',borderRadius:8,border:'1px solid #38bdf844',background:'rgba(56,189,248,0.1)',color:'#38bdf8',fontSize:10,fontWeight:700,cursor:'pointer'}}>🔬 CLAUDE BT</button>
                  <button onClick={()=>runBacktest('groq')} disabled={coachLoading} style={{padding:'8px 0',borderRadius:8,border:'1px solid #8b5cf644',background:'rgba(139,92,246,0.1)',color:'#8b5cf6',fontSize:10,fontWeight:700,cursor:'pointer'}}>🔬 GROQ BT</button>
                  <button onClick={()=>runBacktest('paste')} disabled={coachLoading} style={{padding:'8px 0',borderRadius:8,border:'1px solid #f9731644',background:'rgba(249,115,22,0.1)',color:'#f97316',fontSize:10,fontWeight:700,cursor:'pointer'}}>🔬 MY BT</button>
                </div>

              {coachReport&&(
                <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #a78bfa44',borderRadius:14,padding:18,marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                    <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#a78bfa',letterSpacing:2}}>🎯 AI COACH REPORT</div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:28,color:coachReport.grade==='A'?'#22c55e':coachReport.grade==='B'?'#86efac':coachReport.grade==='C'?'#fbbf24':coachReport.grade==='D'?'#f97316':'#ef4444',fontWeight:700}}>{coachReport.grade}</div>
                      <div style={{fontSize:10,color:'#475569'}}>{coachReport.betsAnalyzed} bets</div>
                    </div>
                  </div>
                  <div style={{fontSize:13,color:'#e2e8f0',fontWeight:700,marginBottom:12,lineHeight:1.4}}>{coachReport.headline}</div>

                  {coachReport.ai_analysis&&(
                    <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(56,189,248,0.05)',borderRadius:8,border:'1px solid rgba(56,189,248,0.15)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                        <div style={{fontSize:10,color:'#60a5fa',fontWeight:700,letterSpacing:1}}>🤖 AI PAPER BETS</div>
                        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:14,color:'#60a5fa'}}>{coachReport.ai_analysis.grade}</div>
                      </div>
                      {coachReport.ai_analysis.strengths?.map((s,i)=><div key={i} style={{fontSize:11,color:'#94a3b8',marginBottom:3,paddingLeft:8,borderLeft:'2px solid #22c55e44'}}>✅ {s}</div>)}
                      {coachReport.ai_analysis.weaknesses?.map((w,i)=><div key={i} style={{fontSize:11,color:'#94a3b8',marginBottom:3,paddingLeft:8,borderLeft:'2px solid #ef444444'}}>❌ {w}</div>)}
                    </div>
                  )}

                  {coachReport.script_analysis&&(
                    <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(249,115,22,0.05)',borderRadius:8,border:'1px solid rgba(249,115,22,0.15)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                        <div style={{fontSize:10,color:'#f97316',fontWeight:700,letterSpacing:1}}>📋 MY SCRIPT PICKS</div>
                        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:14,color:'#f97316'}}>{coachReport.script_analysis.grade}</div>
                      </div>
                      {coachReport.script_analysis.strengths?.map((s,i)=><div key={i} style={{fontSize:11,color:'#94a3b8',marginBottom:3,paddingLeft:8,borderLeft:'2px solid #22c55e44'}}>✅ {s}</div>)}
                      {coachReport.script_analysis.weaknesses?.map((w,i)=><div key={i} style={{fontSize:11,color:'#94a3b8',marginBottom:3,paddingLeft:8,borderLeft:'2px solid #ef444444'}}>❌ {w}</div>)}
                    </div>
                  )}

                  {coachReport.comparison&&(
                    <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(167,139,250,0.05)',borderRadius:8,border:'1px solid rgba(167,139,250,0.15)'}}>
                      <div style={{fontSize:10,color:'#a78bfa',fontWeight:700,letterSpacing:1,marginBottom:6}}>⚖️ COMPARISON</div>
                      <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6}}>{coachReport.comparison}</div>
                    </div>
                  )}

                  {coachReport.recommendations?.length>0&&(
                    <div style={{marginBottom:12}}>
                      <div style={{fontSize:10,color:'#38bdf8',fontWeight:700,letterSpacing:1,marginBottom:6}}>🎯 RECOMMENDATIONS</div>
                      {coachReport.recommendations.map((r,i)=><div key={i} style={{fontSize:12,color:'#94a3b8',marginBottom:4,paddingLeft:8,borderLeft:'2px solid #38bdf844'}}>• {r}</div>)}
                    </div>
                  )}

                  {coachReport.sizing&&(
                    <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(251,191,36,0.05)',borderRadius:8,border:'1px solid rgba(251,191,36,0.2)'}}>
                      <div style={{fontSize:10,color:'#fbbf24',fontWeight:700,letterSpacing:1,marginBottom:4}}>💰 SIZING ADVICE</div>
                      <div style={{fontSize:12,color:'#94a3b8'}}>{coachReport.sizing}</div>
                    </div>
                  )}

                  {coachReport.next_focus&&(
                    <div style={{padding:'10px 12px',background:'rgba(167,139,250,0.05)',borderRadius:8,border:'1px solid rgba(167,139,250,0.2)'}}>
                      <div style={{fontSize:10,color:'#a78bfa',fontWeight:700,letterSpacing:1,marginBottom:4}}>🎯 FOCUS ON THIS NEXT</div>
                      <div style={{fontSize:12,color:'#e2e8f0',fontWeight:700}}>{coachReport.next_focus}</div>
                    </div>
                  )}

                  <div style={{marginTop:10,fontSize:10,color:'#334155',textAlign:'right'}}>Generated {new Date(coachReport.date).toLocaleDateString()}</div>
                </div>
              )}

              {(()=>{
                const graded=state.bets.filter(b=>b.result!=='pending'&&b.confidence);
                if(graded.length<5) return null;
                const buckets={};
                graded.forEach(b=>{
                  const bucket=Math.floor(b.confidence/10)*10;
                  if(!buckets[bucket])buckets[bucket]={pred:[],actual:[]};
                  buckets[bucket].pred.push(b.confidence/100);
                  buckets[bucket].actual.push(b.result==='win'?1:0);
                });
                const rows=Object.entries(buckets).sort(([a],[b])=>+a-+b).map(([bucket,data])=>({
                  bucket:+bucket,
                  pred:(data.pred.reduce((a,b)=>a+b,0)/data.pred.length*100).toFixed(0),
                  actual:(data.actual.reduce((a,b)=>a+b,0)/data.actual.length*100).toFixed(0),
                  n:data.pred.length,
                }));
                return (
                  <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
                    <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#38bdf8',letterSpacing:2,marginBottom:14}}>📊 CONFIDENCE CALIBRATION</div>
                    <div style={{fontSize:10,color:'#475569',marginBottom:10}}>Are your confidence scores accurate? Predicted % vs actual win rate.</div>
                    {rows.map(r=>{
                      const diff=r.actual-r.pred;
                      const barW=Math.min(100,+r.actual);
                      return (
                        <div key={r.bucket} style={{marginBottom:10}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                            <span style={{color:'#64748b'}}>{r.bucket}-{r.bucket+9}% conf ({r.n} bets)</span>
                            <span style={{color:Math.abs(diff)>10?'#ef4444':'#22c55e',fontWeight:700}}>{r.actual}% actual {diff>=0?'↑':'↓'}{Math.abs(diff)}%</span>
                          </div>
                          <div style={{height:8,background:'#1e293b',borderRadius:4,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${barW}%`,background:Math.abs(diff)>10?'#ef4444':'#22c55e',borderRadius:4}}/>
                          </div>
                          <div style={{height:2,background:'#334155',borderRadius:4,marginTop:2,position:'relative'}}>
                            <div style={{position:'absolute',left:`${Math.min(100,+r.pred)}%`,top:-3,width:2,height:8,background:'#38bdf8',borderRadius:1}}/>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{fontSize:10,color:'#334155',marginTop:6}}>🔵 blue line = predicted · bar = actual</div>
                  </div>
                );
              })()}

              {(()=>{
                const graded=state.bets.filter(b=>b.result!=='pending');
                if(graded.length<5) return null;
                const wins=graded.filter(b=>b.result==='win').length;
                const wr=wins/graded.length;
                const avgOdds=graded.reduce((a,b)=>a+(b.odds>0?b.odds/100+1:100/Math.abs(b.odds)+1),0)/graded.length;
                const expectedWR=1/avgOdds;
                const staked=graded.reduce((a,b)=>a+b.stake,0);
                const profit=graded.reduce((a,b)=>b.result==='win'?a+(americanToDecimal(b.odds)-1)*b.stake:b.result==='loss'?a-b.stake:a,0);
                const expectedProfit=graded.reduce((a,b)=>{
                  const dec=b.odds>0?b.odds/100+1:100/Math.abs(b.odds)+1;
                  return a+(dec-1)*b.stake*expectedWR-b.stake*(1-expectedWR);
                },0);
                const variance=profit-expectedProfit;
                return (
                  <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
                    <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#fbbf24',letterSpacing:2,marginBottom:14}}>📈 VARIANCE TRACKER</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,textAlign:'center'}}>
                      <div>
                        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#e2e8f0'}}>{(wr*100).toFixed(0)}%</div>
                        <div style={{fontSize:10,color:'#475569'}}>Actual WR</div>
                      </div>
                      <div>
                        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#64748b'}}>{(expectedWR*100).toFixed(0)}%</div>
                        <div style={{fontSize:10,color:'#475569'}}>Expected WR</div>
                      </div>
                      <div>
                        <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:variance>=0?'#22c55e':'#ef4444'}}>{variance>=0?'+':''}{formatMoney(variance)}</div>
                        <div style={{fontSize:10,color:'#475569'}}>Luck Factor</div>
                      </div>
                    </div>
                    <div style={{marginTop:12,padding:'10px 12px',background:variance>20?'rgba(34,197,94,0.05)':variance<-20?'rgba(239,68,68,0.05)':'rgba(251,191,36,0.05)',borderRadius:8,border:`1px solid ${variance>20?'rgba(34,197,94,0.2)':variance<-20?'rgba(239,68,68,0.2)':'rgba(251,191,36,0.2)'}`}}>
                      <div style={{fontSize:12,color:'#94a3b8'}}>
                        {variance>20?`Running hot — ${formatMoney(variance)} above expected. Results likely to regress.`:variance<-20?`Running cold — ${formatMoney(Math.abs(variance))} below expected. Results likely to improve.`:'Results are close to expectation. Variance is normal.'}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {tab==='ai'&&(
            <div style={{animation:'slideIn .3s ease'}}>
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
                :aiBets.filter(b=>aiFilter==='all'||b.result===aiFilter).map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} onUndoGrade={undoGrade} onTail={tailBet} onDelete={(id)=>deleteBet(id)} teaching={teaching} allowEdit={true} bankroll={state.bankroll}/>)
              }
            </div>
          )}

          {tab==='paste'&&<PasteTab onConfirmPicks={confirmPicks} callClaude={callClaude}/>}

          {tab==='mine'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              {/* Pre-Log Section */}
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:14,padding:16,marginBottom:14}}>
                <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:10,color:'#fbbf24',letterSpacing:2,marginBottom:10}}>📋 PRE-LOG — ASK COACH BEFORE PLACING</div>
                <div style={{display:'flex',gap:6,marginBottom:6}}>
                  <input value={preLogInput.pick} onChange={e=>setPreLogInput(p=>({...p,pick:e.target.value}))} placeholder="Pick (e.g. Boston Red Sox ML)" style={{flex:2,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'8px 10px',fontSize:12}}/>
                  <select value={preLogInput.sport} onChange={e=>setPreLogInput(p=>({...p,sport:e.target.value}))} style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'8px',fontSize:12}}>
                    {['NHL','MLB','NBA','NFL'].map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{display:'flex',gap:6,marginBottom:6}}>
                  <select value={preLogInput.betType} onChange={e=>setPreLogInput(p=>({...p,betType:e.target.value}))} style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'8px',fontSize:12}}>
                    {['Moneyline','Spread','Total','NRFI','YRFI','Parlay'].map(t=><option key={t}>{t}</option>)}
                  </select>
                  <input value={preLogInput.odds} onChange={e=>setPreLogInput(p=>({...p,odds:e.target.value}))} placeholder="Odds e.g. -110" style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'8px 10px',fontSize:12}}/>
                  <input value={preLogInput.stake} onChange={e=>setPreLogInput(p=>({...p,stake:e.target.value}))} placeholder="Stake" style={{flex:1,background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'8px 10px',fontSize:12}}/>
                </div>
                <input value={preLogInput.notes} onChange={e=>setPreLogInput(p=>({...p,notes:e.target.value}))} placeholder="Your reasoning or notes..." style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#94a3b8',padding:'8px 10px',fontSize:12,marginBottom:6,boxSizing:'border-box'}}/>
                <button onClick={addToPreLog} style={{width:'100%',padding:'10px 0',borderRadius:8,border:'none',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',color:'#000',fontSize:12,fontWeight:700,cursor:'pointer',letterSpacing:1}}>
                  + ADD TO PRE-LOG
                </button>

                {/* Pre-log entries */}
                {preLog.map(entry=>(
                  <div key={entry.id} style={{marginTop:10,padding:'12px 14px',background:'rgba(5,8,16,0.8)',borderRadius:10,border:'1px solid rgba(251,191,36,0.2)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                      <div style={{fontSize:13,color:'#f1f5f9',fontWeight:700}}>{entry.pick}</div>
                      <div style={{fontSize:10,color:'#64748b'}}>{entry.sport} · {entry.betType} · {entry.odds>0?'+':''}{entry.odds}</div>
                    </div>
                    {entry.notes&&<div style={{fontSize:11,color:'#475569',marginBottom:6}}>{entry.notes}</div>}
                    {entry.coachOpinion&&(
                      <div style={{background:'rgba(34,197,94,0.05)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:6,padding:'8px 10px',marginBottom:8,fontSize:11,color:'#94a3b8',lineHeight:1.5}}>
                        <div style={{fontSize:9,color:'#22c55e',fontWeight:700,marginBottom:4,letterSpacing:1}}>🤖 COACH SAYS</div>
                        {entry.coachOpinion}
                      </div>
                    )}
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={()=>askCoachAboutPick(entry.id)} disabled={preLogLoading===entry.id} style={{flex:1,padding:'7px 0',borderRadius:6,border:'1px solid #38bdf844',background:'rgba(56,189,248,0.1)',color:'#38bdf8',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                        {preLogLoading===entry.id?'🤔 THINKING...':'🤖 ASK COACH'}
                      </button>
                      <button onClick={()=>lockPreLogPick(entry.id)} style={{flex:1,padding:'7px 0',borderRadius:6,border:'none',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#fff',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                        🔒 LOCK IN
                      </button>
                      <button onClick={()=>deletePreLog(entry.id)} style={{padding:'7px 12px',borderRadius:6,border:'1px solid #7f1d1d44',background:'transparent',color:'#ef444488',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
                :myBets.filter(b=>myFilter==='all'||b.result===myFilter).map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={teachLesson} onDelete={(id)=>deleteBet(id)} onEdit={b=>setMyPickModal(b)} onUndoGrade={undoGrade} teaching={teaching} allowEdit={true} bankroll={state.myBankroll}/>)
              }
            </div>
          )}

          {tab==='tracker'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              {/* Sport selector */}
              <div style={{display:'flex',gap:4,marginBottom:14,background:'rgba(10,18,35,0.8)',padding:4,borderRadius:10,border:'1px solid #1e293b'}}>
                {['NHL','MLB','NBA','NFL'].map(s=>{
                  const c={NHL:'#38bdf8',MLB:'#f97316',NBA:'#a78bfa',NFL:'#22c55e'}[s];
                  return <button key={s} onClick={()=>setTrackerSport(s)} style={{flex:1,padding:'8px 0',borderRadius:7,border:'none',cursor:'pointer',background:trackerSport===s?`rgba(${s==='NHL'?'56,189,248':s==='MLB'?'249,115,22':s==='NBA'?'167,139,250':'34,197,94'},0.15)`:'transparent',color:trackerSport===s?c:'#64748b',fontSize:12,fontWeight:700,letterSpacing:1,transition:'all .2s'}}>{s}</button>;
                })}
              </div>

              {/* Paste model output */}
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
                <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#38bdf8',letterSpacing:2,marginBottom:12}}>📡 PASTE {trackerSport} MODEL OUTPUT</div>
                <textarea value={trackerPaste} onChange={e=>setTrackerPaste(e.target.value)} placeholder={`Paste full ${trackerSport} model terminal output here — all picks will be extracted and tracked`} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#64748b',padding:'10px 12px',fontSize:12,resize:'vertical',minHeight:150,lineHeight:1.6,fontFamily:"'Rajdhani',sans-serif"}}/>
                <button onClick={parseTrackerOutput} disabled={trackerParsing||!trackerPaste.trim()} style={{width:'100%',marginTop:10,padding:'12px 0',borderRadius:8,border:'none',cursor:trackerParsing||!trackerPaste.trim()?'not-allowed':'pointer',background:trackerParsing||!trackerPaste.trim()?'#1e293b':'linear-gradient(135deg,#38bdf8,#0ea5e9)',color:trackerParsing||!trackerPaste.trim()?'#475569':'#000',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
                  {trackerParsing?'PARSING...':'📡 TRACK ALL PICKS'}
                </button>
                {trackerError&&<div style={{marginTop:8,padding:'8px 12px',background:'rgba(127,29,29,0.4)',borderRadius:6,fontSize:12,color:'#fca5a5'}}>{trackerError}</div>}
              </div>

              {/* Manual add */}
              <button onClick={()=>setShowManualTrack(t=>!t)} style={{width:'100%',padding:'10px 0',borderRadius:10,border:'1px solid #334155',background:'rgba(51,65,85,0.3)',color:'#94a3b8',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1,marginBottom:14}}>
                {showManualTrack?'▲ HIDE':'✏️ ADD MANUAL PICK TO TRACK'}
              </button>

              {showManualTrack&&(
                <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #334155',borderRadius:14,padding:18,marginBottom:14}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                    <div>
                      <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4}}>SPORT</div>
                      <select style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13}} value={manualTrack.sport} onChange={e=>setManualTrack(p=>({...p,sport:e.target.value}))}>
                        {['MLB','NHL','NBA','NFL'].map(s=><option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4}}>MODEL PROB %</div>
                      <input type="number" value={manualTrack.modelProb} onChange={e=>setManualTrack(p=>({...p,modelProb:e.target.value}))} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13}} placeholder="e.g. 81.7"/>
                    </div>
                  </div>
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4}}>PICK</div>
                    <input value={manualTrack.pick} onChange={e=>setManualTrack(p=>({...p,pick:e.target.value}))} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13}} placeholder="e.g. TBR @ CHW — NRFI"/>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                    <div>
                      <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4}}>ODDS</div>
                      <input type="number" value={manualTrack.odds} onChange={e=>setManualTrack(p=>({...p,odds:+e.target.value}))} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13}}/>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,textTransform:'uppercase',marginBottom:4}}>RATING</div>
                      <input value={manualTrack.rating} onChange={e=>setManualTrack(p=>({...p,rating:e.target.value}))} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'8px 12px',fontSize:13}} placeholder="STRONG NRFI"/>
                    </div>
                  </div>
                  <button onClick={()=>{
                    setState(s=>({...s,trackedPicks:[{id:uid(),date:new Date().toISOString().split('T')[0],...manualTrack,source:'manual',result:'pending',score:''},...s.trackedPicks]}));
                    setManualTrack({sport:'MLB',pick:'',modelProb:'',odds:-110,rating:'',result:'pending',score:''});
                    setShowManualTrack(false);
                    addLog('📡 Manual pick tracked');
                  }} style={{width:'100%',padding:'10px 0',borderRadius:8,border:'none',background:'#334155',color:'#e2e8f0',fontFamily:"'Orbitron',sans-serif",fontSize:11,fontWeight:700,cursor:'pointer'}}>ADD TO TRACKER</button>
                </div>
              )}

              {/* Stats summary */}
              {(()=>{
                const sportPicks=state.trackedPicks.filter(p=>p.sport===trackerSport);
                if(!sportPicks.length) return null;
                const graded=sportPicks.filter(p=>p.result!=='pending');
                const wins=graded.filter(p=>p.result==='win').length;
                const pending=sportPicks.filter(p=>p.result==='pending').length;
                const avgProb=graded.filter(p=>p.modelProb).reduce((a,p)=>a+parseFloat(p.modelProb),0)/(graded.filter(p=>p.modelProb).length||1);
                const actualWR=graded.length?wins/graded.length*100:0;
                return (
                  <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid #1e293b',borderRadius:14,padding:18,marginBottom:14}}>
                    <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#38bdf8',letterSpacing:2,marginBottom:12}}>📊 MODEL PERFORMANCE</div>
                    {/* Overall */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,textAlign:'center',marginBottom:12}}>
                      <div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#e2e8f0'}}>{sportPicks.length}</div><div style={{fontSize:9,color:'#475569'}}>{trackerSport} TOTAL</div></div>
                      <div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:'#f59e0b'}}>{pending}</div><div style={{fontSize:9,color:'#475569'}}>PENDING</div></div>
                      <div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:actualWR>=55?'#22c55e':'#ef4444'}}>{actualWR.toFixed(0)}%</div><div style={{fontSize:9,color:'#475569'}}>ACTUAL WR</div></div>
                      <div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:18,color:actualWR>=avgProb?'#22c55e':'#ef4444'}}>{(actualWR-avgProb).toFixed(1)}%</div><div style={{fontSize:9,color:'#475569'}}>DRIFT</div></div>
                    </div>

                    {/* Calibration by tier */}
                    {graded.length>=3&&(()=>{
                      const tiers = [
                        {label:'STRONG BET', min:75, color:'#22c55e'},
                        {label:'VALUE BET', min:60, max:74, color:'#f59e0b'},
                        {label:'LEAN', min:0, max:59, color:'#64748b'},
                      ];
                      const byRating = {};
                      graded.forEach(p=>{
                        const r = p.rating?.includes('STRONG')?'STRONG BET':p.rating?.includes('VALUE')?'VALUE BET':'LEAN';
                        if(!byRating[r]) byRating[r]={wins:0,total:0,probs:[]};
                        byRating[r].total++;
                        if(p.result==='win') byRating[r].wins++;
                        if(p.modelProb) byRating[r].probs.push(parseFloat(p.modelProb));
                      });
                      return (
                        <div style={{marginBottom:12}}>
                          <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,marginBottom:6}}>CALIBRATION BY TIER</div>
                          {Object.entries(byRating).filter(([,v])=>v.total>0).map(([tier,v])=>{
                            const wr = (v.wins/v.total*100).toFixed(0);
                            const avgP = v.probs.length?(v.probs.reduce((a,b)=>a+b,0)/v.probs.length).toFixed(0):'?';
                            const drift = v.probs.length?(parseFloat(wr)-parseFloat(avgP)).toFixed(1):'?';
                            const color = parseFloat(wr)>=55?'#22c55e':parseFloat(wr)>=45?'#f59e0b':'#ef4444';
                            return (
                              <div key={tier} style={{display:'flex',justifyContent:'space-between',padding:'4px 8px',background:'rgba(5,8,16,0.5)',borderRadius:6,marginBottom:4,fontSize:11}}>
                                <span style={{color:'#94a3b8'}}>{tier}</span>
                                <span style={{color}}>{v.wins}W-{v.total-v.wins}L ({wr}%)</span>
                                <span style={{color:'#64748b'}}>Model: {avgP}% | Drift: {drift}%</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* By bet type */}
                    {graded.length>=3&&(()=>{
                      const byType = {};
                      graded.forEach(p=>{
                        const t = p.recommendation||'OTHER';
                        if(!byType[t]) byType[t]={wins:0,total:0};
                        byType[t].total++;
                        if(p.result==='win') byType[t].wins++;
                      });
                      return (
                        <div style={{marginBottom:12}}>
                          <div style={{fontSize:9,color:'#475569',letterSpacing:1.5,marginBottom:6}}>BY BET TYPE</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {Object.entries(byType).map(([type,v])=>{
                              const wr=(v.wins/v.total*100).toFixed(0);
                              const c=parseFloat(wr)>=55?'#22c55e':parseFloat(wr)>=45?'#f59e0b':'#ef4444';
                              return <span key={type} style={{fontSize:10,padding:'3px 8px',borderRadius:20,background:'rgba(5,8,16,0.8)',border:`1px solid ${c}44`,color:c}}>{type}: {wr}% ({v.total})</span>;
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    <div style={{display:'flex',gap:8}}>
                      <button onClick={analyzeTracker} disabled={trackerAnalyzing||graded.length<5} style={{flex:1,padding:'10px 0',borderRadius:8,border:'none',cursor:trackerAnalyzing||graded.length<5?'not-allowed':'pointer',background:graded.length>=5?'linear-gradient(135deg,#a78bfa,#7c3aed)':'#1e293b',color:graded.length>=5?'#fff':'#475569',fontFamily:"'Orbitron',sans-serif",fontSize:11,fontWeight:700,letterSpacing:1}}>
                        {trackerAnalyzing?'ANALYZING...':'🤖 AI ANALYZE MODEL'}
                      </button>
                      <button onClick={runTrackerBacktest} disabled={trackerAnalyzing||graded.length<5} style={{flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #38bdf844',background:graded.length>=5?'rgba(56,189,248,0.1)':'#1e293b',color:graded.length>=5?'#38bdf8':'#475569',fontFamily:"'Orbitron',sans-serif",fontSize:11,fontWeight:700,letterSpacing:1,cursor:trackerAnalyzing||graded.length<5?'not-allowed':'pointer'}}>
                        {trackerAnalyzing?'RUNNING...':'🔬 BACKTEST MODEL'}
                      </button>
                    </div>
                    {trackerAnalysis&&(
                      <div style={{marginTop:12,padding:12,background:'rgba(167,139,250,0.05)',borderRadius:8,border:'1px solid rgba(167,139,250,0.2)',fontSize:12,color:'#cbd5e1',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{trackerAnalysis}</div>
                    )}
                  </div>
                );
              })()}

              {/* Picks list */}
              {(()=>{
                const visiblePicks=state.trackedPicks.filter(p=>p.sport===trackerSport);
                return visiblePicks.length===0?(
                <div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}>
                  <div style={{fontSize:32,marginBottom:10}}>📡</div>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO {trackerSport} PICKS TRACKED</div>
                  <div style={{fontSize:12,marginTop:6}}>Paste your {trackerSport} model output above</div>
                </div>
              ):(
                <div>
                  <div style={{fontSize:10,color:'#475569',marginBottom:8,letterSpacing:1}}>{visiblePicks.filter(p=>p.result==='pending').length} PENDING · {visiblePicks.filter(p=>p.result!=='pending').length} GRADED</div>
                  {visiblePicks.map(pick=>(
                    <div key={pick.id} style={{background:'rgba(10,18,35,0.9)',border:`1px solid ${pick.result==='win'?'#22c55e44':pick.result==='loss'?'#ef444444':'#1e293b'}`,borderLeft:`3px solid ${pick.result==='win'?'#22c55e':pick.result==='loss'?'#ef4444':pick.result==='push'?'#94a3b8':'#38bdf8'}`,borderRadius:10,padding:'12px 14px',marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:'#f1f5f9',fontWeight:700,marginBottom:4}}>{pick.pick}</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:4}}>
                            <span style={{fontSize:9,background:'#1e293b',color:'#64748b',padding:'2px 6px',borderRadius:20}}>{pick.sport}</span>
                            {pick.rating&&<span style={{fontSize:9,background:'rgba(56,189,248,0.15)',color:'#38bdf8',padding:'2px 6px',borderRadius:20,border:'1px solid rgba(56,189,248,0.25)'}}>{pick.rating}</span>}
                            <span style={{fontSize:9,color:'#475569'}}>{pick.date}</span>
                          </div>
                          {pick.pitchers&&<div style={{fontSize:11,color:'#64748b',marginBottom:2}}>{pick.pitchers}</div>}
                          {pick.keyStats&&<div style={{fontSize:10,color:'#475569'}}>{pick.keyStats}</div>}
                          {pick.score&&<div style={{fontSize:11,color:'#38bdf8',marginTop:4}}>📊 {pick.score}</div>}
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          {pick.modelProb&&<div style={{fontFamily:"'Orbitron',sans-serif",fontSize:16,color:'#e2e8f0'}}>{pick.modelProb}%</div>}
                          {pick.odds&&<div style={{fontSize:11,color:'#64748b'}}>{pick.odds>0?'+':''}{pick.odds}</div>}
                          <div style={{fontSize:10,color:pick.result==='win'?'#22c55e':pick.result==='loss'?'#ef4444':pick.result==='push'?'#94a3b8':'#f59e0b',fontWeight:700,marginTop:4}}>{pick.result.toUpperCase()}</div>
                        </div>
                      </div>
                      {pick.result==='pending'&&(
                        <div style={{marginTop:8}}>
                          <input value={pick.score||''} onChange={e=>setState(s=>({...s,trackedPicks:s.trackedPicks.map(p=>p.id===pick.id?{...p,score:e.target.value}:p)}))} placeholder="Enter score e.g. 3-0 YRFI or 4-2 OT" style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:6,color:'#e2e8f0',padding:'5px 8px',fontSize:11,marginBottom:6,fontFamily:"'Rajdhani',sans-serif"}}/>
                          <div style={{display:'flex',gap:4}}>
                            {['win','loss','push'].map(r=>(
                              <button key={r} onClick={()=>gradeTracked(pick.id,r,pick.score||'')} style={{flex:1,padding:'6px 0',borderRadius:6,border:'none',cursor:'pointer',background:r==='win'?'#14532d':r==='loss'?'#7f1d1d':'#1e293b',color:r==='win'?'#86efac':r==='loss'?'#fca5a5':'#94a3b8',fontSize:10,fontWeight:700,textTransform:'uppercase'}}>{r}</button>
                            ))}
                            <button onClick={()=>deleteTracked(pick.id)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid #7f1d1d44',background:'transparent',color:'#ef444466',fontSize:10,fontWeight:700,cursor:'pointer'}}>🗑</button>
                          </div>
                        </div>
                      )}
                      {pick.result!=='pending'&&(
                        <button onClick={()=>gradeTracked(pick.id,'pending','')} style={{marginTop:6,width:'100%',padding:'4px 0',borderRadius:6,border:'1px solid #f59e0b44',background:'rgba(245,158,11,0.1)',color:'#f59e0b',fontSize:10,fontWeight:700,cursor:'pointer'}}>↩ UNDO</button>
                      )}
                    </div>
                  ))}
                </div>
              );})()}
            </div>
          )}

          {tab==='groq'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid rgba(139,92,246,0.3)',borderRadius:14,padding:18,marginBottom:14}}>
                <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#8b5cf6',letterSpacing:2,marginBottom:12}}>🧠 GROQ AI + MONTE CARLO</div>
                <div style={{fontSize:11,color:'#475569',marginBottom:10}}>Llama 3.3 70B + 10,000 Monte Carlo sims — independent second opinion</div>
                <select value={groqSport} onChange={e=>setGroqSport(e.target.value)} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'10px 12px',fontSize:13,marginBottom:8,cursor:'pointer'}}>
                  {['NHL','MLB','NBA','NFL'].map(s=><option key={s}>{s}</option>)}
                </select>
                <div style={{display:'flex',gap:8,marginBottom:8}}>
                  <button onClick={generateGroqPicks} disabled={groqLoading} style={{flex:2,padding:'12px 0',borderRadius:8,border:'none',cursor:groqLoading?'not-allowed':'pointer',background:groqLoading?'#1e293b':'linear-gradient(135deg,#8b5cf6,#7c3aed)',color:groqLoading?'#475569':'#fff',fontFamily:"'Orbitron',sans-serif",fontSize:12,fontWeight:700,letterSpacing:1}}>
                    {groqLoading?'🧠 FINDING VALUE...':'🧠 FIND VALUE'}
                  </button>
                  <button onClick={loadGroqGames} disabled={groqLoading} style={{flex:1,padding:'12px 0',borderRadius:8,border:'1px solid #8b5cf644',background:'rgba(139,92,246,0.05)',color:'#8b5cf6',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                    📡 LOAD GAMES
                  </button>
                  {groqGames.length>0&&<button onClick={()=>setGroqGames([])} style={{padding:'12px 14px',borderRadius:8,border:'1px solid #334155',background:'transparent',color:'#475569',fontSize:11,fontWeight:700,cursor:'pointer'}}>🗑</button>}
                </div>
                {groqGames.length>0&&(
                  <div>
                    <div style={{fontSize:10,color:'#475569',marginBottom:8}}>{groqGames.length} games — tap ANALYZE to run 10K sims + Llama 3.3</div>
                    {groqGames.map((game,gi)=>{
                      const key=game.homeTeam+game.awayTeam+'ML';
                      const isAnalyzing=groqAnalyzing===key;
                      // Find if this game already has a Groq pick logged
                      const existingPick = groqBets.find(b=>b.pick&&b.pick.includes(game.homeTeam)&&b.pick.includes(game.awayTeam));
                      return (
                        <div key={`${key}-${existingPick?.id||'none'}`} style={{marginBottom:10,padding:'12px 14px',background:'rgba(5,8,16,0.8)',borderRadius:10,border:`1px solid ${existingPick?'rgba(139,92,246,0.4)':'#1e293b'}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                            <div style={{fontSize:13,color:'#f1f5f9',fontWeight:700}}>{game.awayTeam} @ {game.homeTeam}</div>
                            <div style={{fontSize:10,color:'#64748b'}}>{game.awayOdds>0?'+':''}{game.awayOdds} / {game.homeOdds>0?'+':''}{game.homeOdds}</div>
                          </div>
                          {!existingPick&&!isAnalyzing&&(
                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button onClick={()=>runGroqAnalysis(game,'ML')} disabled={!!groqAnalyzing} style={{flex:1,padding:'8px 0',borderRadius:6,border:'1px solid #8b5cf644',background:'rgba(139,92,246,0.1)',color:'#8b5cf6',fontSize:11,fontWeight:700,cursor:groqAnalyzing?'not-allowed':'pointer'}}>
                                {isAnalyzing?'🧠 RUNNING...':'🧠 ML'}
                              </button>
                              {game.sport==='MLB'&&<button onClick={()=>runGroqAnalysis(game,'NRFI')} disabled={!!groqAnalyzing} style={{flex:1,padding:'8px 0',borderRadius:6,border:'1px solid #22c55e44',background:'rgba(34,197,94,0.1)',color:'#22c55e',fontSize:11,fontWeight:700,cursor:groqAnalyzing?'not-allowed':'pointer'}}>{isAnalyzing?'...':'⚾ NRFI'}</button>}
                              {game.sport==='MLB'&&<button onClick={async()=>{await runGroqAnalysis(game,'ML');await runGroqAnalysis(game,'NRFI');}} disabled={!!groqAnalyzing} style={{flex:1,padding:'8px 0',borderRadius:6,border:'1px solid #fbbf2444',background:'rgba(251,191,36,0.1)',color:'#fbbf24',fontSize:11,fontWeight:700,cursor:groqAnalyzing?'not-allowed':'pointer'}}>{isAnalyzing?'...':'⚡ BOTH'}</button>}
                            </div>
                          )}
                          {isAnalyzing&&<div style={{fontSize:11,color:'#8b5cf6',padding:'6px',textAlign:'center'}}>🧠 Running 10K sims + Llama 3.3...</div>}
                          {existingPick&&!isAnalyzing&&(
                            <div style={{padding:'8px 10px',background:'rgba(34,197,94,0.05)',borderRadius:6,border:'1px solid rgba(34,197,94,0.2)'}}>
                              <div style={{fontSize:12,color:'#22c55e',fontWeight:700}}>✅ {existingPick.pick}</div>
                              <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>{existingPick.reasoning?.slice(0,120)}</div>
                              <div style={{fontSize:10,color:'#8b5cf6',marginTop:2}}>{existingPick.confidence}% conf · {existingPick.odds>0?'+':''}{existingPick.odds}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Groq picks list */}
              <div style={{background:'rgba(10,18,35,0.95)',border:'1px solid rgba(139,92,246,0.2)',borderRadius:14,padding:18,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:11,color:'#8b5cf6',letterSpacing:2}}>🧠 GROQ PICKS</div>
                  <div style={{fontSize:11,color:'#475569'}}>{groqGraded.length} graded · {groqBets.filter(b=>b.result==='pending').length} pending</div>
                </div>
                {groqBets.length===0
                  ?<div style={{textAlign:'center',padding:'30px 0',color:'#334155',fontSize:12}}>No Groq picks yet — load games and analyze</div>
                  :<>{filterBar(groqFilter,setGroqFilter)}
                    {groqBets
                      .filter(b=>groqFilter==='all'||(groqFilter==='pending'&&b.result==='pending')||(groqFilter==='win'&&b.result==='win')||(groqFilter==='loss'&&b.result==='loss')||(groqFilter==='push'&&b.result==='push'))
                      .map(bet=><BetCard key={bet.id} bet={bet} onGrade={gradeBet} onTeach={bet.result!=='pending'?analyzeGroqPick:null} onUndoGrade={undoGrade} onTail={tailGroqPick} onDelete={(id)=>deleteBet(id)} teaching={teaching} allowEdit={false} bankroll={state.groqBankroll}/>)}
                  </>
                }
              </div>
            </div>
          )}

          {tab==='lessons'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              {/* Backtest reports */}
              {state.lessons.filter(l=>l.source==='backtest').length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontFamily:"'Orbitron',sans-serif",fontSize:10,color:'#38bdf8',letterSpacing:2,marginBottom:8}}>🔬 BACKTEST REPORTS</div>
                  {state.lessons.filter(l=>l.source==='backtest').map(l=>(
                    <div key={l.id} style={{background:'rgba(10,18,35,0.95)',border:'1px solid rgba(56,189,248,0.2)',borderRadius:12,padding:14,marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                        <div style={{fontSize:11,color:'#38bdf8',fontWeight:700}}>{l.pick}</div>
                        <div style={{fontSize:10,color:'#475569'}}>{l.date}</div>
                      </div>
                      {l.report?.overall_grade&&<div style={{fontFamily:"'Orbitron',sans-serif",fontSize:24,color:l.report.overall_grade==='A'?'#22c55e':l.report.overall_grade==='B'?'#86efac':l.report.overall_grade==='C'?'#fbbf24':'#ef4444',fontWeight:700,marginBottom:6}}>{l.report.overall_grade}</div>}
                      {l.report?.summary&&<div style={{fontSize:11,color:'#94a3b8',marginBottom:8,lineHeight:1.5}}>{l.report.summary}</div>}
                      {l.report?.best_spots?.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:9,color:'#22c55e',letterSpacing:1,marginBottom:4}}>✅ BEST SPOTS</div>{l.report.best_spots.map((s,i)=><div key={i} style={{fontSize:11,color:'#86efac',marginBottom:2}}>• {s}</div>)}</div>}
                      {l.report?.avoid?.length>0&&<div style={{marginBottom:6}}><div style={{fontSize:9,color:'#ef4444',letterSpacing:1,marginBottom:4}}>🔴 AVOID</div>{l.report.avoid.map((s,i)=><div key={i} style={{fontSize:11,color:'#fca5a5',marginBottom:2}}>• {s}</div>)}</div>}
                      {l.report?.rules?.length>0&&<div><div style={{fontSize:9,color:'#f59e0b',letterSpacing:1,marginBottom:4}}>📋 RULES</div>{l.report.rules.map((s,i)=><div key={i} style={{fontSize:11,color:'#fcd34d',marginBottom:2}}>• {s}</div>)}</div>}
                    </div>
                  ))}
                </div>
              )}
              {state.lessons.filter(l=>l.lesson&&l.lesson.trim().length>10&&l.source!=='backtest').length===0&&state.lessons.filter(l=>l.source==='backtest').length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#475569'}}><div style={{fontSize:32,marginBottom:10}}>🎓</div><div style={{fontFamily:"'Orbitron',sans-serif",fontSize:12,letterSpacing:2}}>NO LESSONS YET</div><div style={{fontSize:12,marginTop:6}}>Grade AI bets → Analyze This Bet</div></div>
                :state.lessons.filter(l=>l.lesson&&l.lesson.trim().length>10&&l.source!=='backtest').map(l=><LessonCard key={l.id} lesson={l}/>)
              }
            </div>
          )}

          {tab==='log'&&(
            <div style={{animation:'slideIn .3s ease'}}>
              <div style={{background:'rgba(249,115,22,0.05)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:12,padding:14,marginBottom:14}}>
                <div style={{fontSize:11,color:'#f97316',fontWeight:700,marginBottom:8,letterSpacing:1}}>📊 DRAFTKINGS IMPORT</div>
                <textarea id="dk-import" placeholder={'Paste DraftKings bet history here...'} style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',padding:'10px 12px',fontSize:12,resize:'vertical',minHeight:120,fontFamily:'monospace',boxSizing:'border-box'}}/>
                <button onClick={()=>{const t=document.getElementById('dk-import')?.value;if(t&&t.trim())importDraftKings(t);else alert('Paste your DraftKings history first');}} style={{width:'100%',marginTop:8,padding:'12px 0',borderRadius:8,border:'none',background:'linear-gradient(135deg,#f97316,#ea580c)',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',letterSpacing:1}}>
                  📊 IMPORT ALL BETS
                </button>
              </div>
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <button onClick={()=>saveToDrive(state)} style={{flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #22c55e44',background:'rgba(34,197,94,0.1)',color:'#22c55e',fontSize:11,fontWeight:700,cursor:'pointer'}}>☁️ SAVE TO DRIVE</button>
                <button onClick={loadFromDrive} style={{flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #38bdf844',background:'rgba(56,189,248,0.1)',color:'#38bdf8',fontSize:11,fontWeight:700,cursor:'pointer'}}>☁️ LOAD FROM DRIVE</button>
              </div>
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <button onClick={exportData} style={{flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #a78bfa44',background:'rgba(167,139,250,0.1)',color:'#a78bfa',fontSize:11,fontWeight:700,cursor:'pointer'}}>💾 EXPORT FILE</button>
                <label style={{flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #fbbf2444',background:'rgba(251,191,36,0.1)',color:'#fbbf24',fontSize:11,fontWeight:700,cursor:'pointer',textAlign:'center'}}>
                  📂 IMPORT FILE
                  <input type="file" accept=".json" onChange={importData} style={{display:'none'}}/>
                </label>
              </div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:10,color:'#475569',marginBottom:6,letterSpacing:1}}>DRAFTKINGS IMPORT</div>
                <textarea id="dk-import" placeholder="Paste DraftKings bet history here (tab-separated from their website)..." style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,color:'#64748b',padding:'10px 12px',fontSize:11,resize:'vertical',minHeight:80,fontFamily:"'Rajdhani',sans-serif"}}/>
                <button onClick={()=>{const t=document.getElementById('dk-import').value;if(t.trim())importDraftKings(t);}} style={{width:'100%',marginTop:6,padding:'10px 0',borderRadius:8,border:'none',background:'linear-gradient(135deg,#f97316,#ea580c)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Orbitron',sans-serif",letterSpacing:1}}>
                  📊 IMPORT DRAFTKINGS HISTORY
                </button>
              </div>
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

export default App;
// Mon Apr 13 17:35:05 CDT 2026
