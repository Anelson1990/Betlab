import { useState, useEffect } from "react";

// ── Matchup scoring ──────────────────────────────────────────
function pitcherMU({ oppOPS, oppKpct }) {
  let s = 0;
  if (oppOPS <= 0.680) s += 2; else if (oppOPS <= 0.740) s += 1; else s -= 1;
  if (oppKpct >= 25) s += 2; else if (oppKpct >= 22) s += 1; else s -= 1;
  return s >= 3 ? "green" : s >= 1 ? "yellow" : "red";
}
function batterMU({ era, handAdv }) {
  let s = 0;
  if (era >= 5.0) s += 2; else if (era >= 4.0) s += 1; else s -= 1;
  if (handAdv === "favor") s += 2; else if (handAdv === "neutral") s += 0; else s -= 1;
  return s >= 3 ? "green" : s >= 1 ? "yellow" : "red";
}
const MU = {
  green:  { dot:"#00e676", bg:"rgba(0,230,118,0.12)",  border:"rgba(0,230,118,0.35)",  label:"Good"    },
  yellow: { dot:"#ffd600", bg:"rgba(255,214,0,0.12)",  border:"rgba(255,214,0,0.35)",  label:"Neutral" },
  red:    { dot:"#ff1744", bg:"rgba(255,23,68,0.12)",  border:"rgba(255,23,68,0.35)",  label:"Bad"     },
};

function Pill({ color }) {
  const c = MU[color] || MU.yellow;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:"0.6rem",fontWeight:700,letterSpacing:"0.06em",padding:"2px 7px",borderRadius:20,border:`1px solid ${c.border}`,background:c.bg,color:c.dot,whiteSpace:"nowrap",textTransform:"uppercase"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:c.dot,flexShrink:0}}/>
      {c.label}
    </span>
  );
}

// ── Build cheat sheet from props_v2.1 JSON ────────────────────
function buildSheet(json) {
  // Support both props_v2.1 format and old master_predictions format
  const isPropsFormat = json.version && json.version.startsWith('props_');

  if (isPropsFormat) {
    // ── NEW FORMAT: props_v2.1 ──
    const toRow = (p) => ({
      name: p.name,
      line: p.line,
      fraction: p.fraction || p.pct,
      pct: p.pct,
      rate: p.rate,
      matchup: p.matchup || 'yellow',
      oppOPS: p.oppOPS || 0.720,
      oppKpct: p.oppKpct || 22,
    });

    const toBatterRow = (p) => ({
      name: p.name,
      line: p.fraction_1 ? 'O0.5 hits' : 'O0.5 hits',
      fraction: p.fraction_1 || p.pct,
      pct: p.rate_1_display || p.pct,
      rate: p.rate_1 || 0,
      badge: p.badge || null,
      matchup: p.matchup || 'yellow',
      pitcherERA: p.opp_era || 4.5,
      handAdv: 'neutral',
      opp_pitcher: p.opp_pitcher || '',
    });

    const kLocks  = (json.k_locks  || []).map(toRow);
    const kHot    = (json.k_hot    || []).map(toRow);
    const kParlay = (json.k_parlay || []).map(toRow);
    const kUnders = (json.k_unders || []).map(p => ({
      name: p.name,
      line: p.line,
      fraction: p.fraction || p.pct,
      pct: p.pct,
      rate: p.rate,
      matchup: p.matchup || 'yellow',
      oppOPS: p.oppOPS || 0.720,
      oppKpct: p.oppKpct || 22,
    }));
    const hits    = (json.hits     || []).map(toBatterRow);
    const hits2   = (json.hits_2   || []).map(toBatterRow);

    return { kLocks, kHot, kParlay, kUnders, hits, hits2, hrs: [] };
  }

  // ── OLD FORMAT: master_predictions ──
  const preds = json.predictions || [];
  const kLocks = [], kHot = [], kUnders = [], hits = [], hrs = [];

  preds.forEach(p => {
    const props = p.props || [];
    const homeERA = p.home_sp_era || 4.5;
    const awayERA = p.away_sp_era || 4.5;
    const homeOPS = p.home_ops || 0.720;
    const awayOPS = p.away_ops || 0.720;
    const homeRPG = p.home_rpg || 4.5;
    const awayRPG = p.away_rpg || 4.5;

    props.filter(pr => pr.type === 'K_OVER').forEach(pr => {
      const isHome = pr.team === p.home_team;
      const oppOPS = isHome ? awayOPS : homeOPS;
      const oppRPG = isHome ? awayRPG : homeRPG;
      const spName = isHome ? p.home_sp : p.away_sp;
      const conf = Math.round((pr.conf || 0.55) * 100);
      const mu = pitcherMU({ oppOPS, oppKpct: oppRPG > 4.8 ? 20 : 24 });
      const displayName = (spName && spName !== 'TBD') ? spName : pr.player;
      if (conf >= 70) {
        kLocks.push({ name: displayName, line: pr.line, fraction: `${conf}%`, pct: `${conf}%`, oppOPS, oppKpct: oppRPG > 4.8 ? 20 : 24, matchup: mu });
      } else if (conf >= 58) {
        kHot.push({ name: displayName, line: pr.line, fraction: `${conf}%`, pct: `${conf}%`, oppOPS, oppKpct: oppRPG > 4.8 ? 20 : 24, matchup: mu });
      }
    });

    props.filter(pr => pr.type === 'HIT_OVER').forEach(pr => {
      const isHome = pr.team === p.home_team;
      const oppERA = isHome ? awayERA : homeERA;
      const handAdv = oppERA > 4.5 ? "favor" : oppERA < 3.5 ? "against" : "neutral";
      const conf = Math.round((pr.conf || 0.65) * 100);
      const mu = batterMU({ era: oppERA, handAdv });
      hits.push({
        name: pr.player, line: pr.line,
        fraction: `${conf}%`, pct: `${conf}%`,
        badge: null, pitcherERA: oppERA, handAdv, matchup: mu,
      });
    });
  });

  kLocks.sort((a,b) => parseFloat(b.pct) - parseFloat(a.pct));
  kHot.sort((a,b) => parseFloat(b.pct) - parseFloat(a.pct));
  hits.sort((a,b) => parseFloat(b.pct) - parseFloat(a.pct));

  return { kLocks, kHot: kHot.slice(0,8), kParlay: [], kUnders: [], hits: hits.slice(0,8), hits2: [], hrs: [] };
}

// ── Styles ───────────────────────────────────────────────────
const S = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&display=swap');
  .pcs { font-family:'Barlow Condensed',sans-serif; color:#f5f5f5; }
  .pcs-title { font-family:'Bebas Neue',sans-serif; font-size:1.8rem; letter-spacing:.06em; text-align:center; color:#fff; margin-bottom:2px; }
  .pcs-date  { text-align:center; font-size:.75rem; letter-spacing:.14em; color:#9e9e9e; text-transform:uppercase; margin-bottom:16px; }
  .pcs-paste-box { background:rgba(10,18,35,0.95); border:1px solid #1e293b; border-radius:12px; padding:16px; margin-bottom:16px; }
  .pcs-paste-label { font-family:'Bebas Neue',sans-serif; font-size:.9rem; letter-spacing:.14em; color:#f97316; margin-bottom:10px; }
  .pcs-paste-hint  { font-size:.7rem; color:#475569; margin-bottom:8px; line-height:1.5; }
  .pcs-textarea { width:100%; background:#0f172a; border:1px solid #334155; border-radius:8px; color:#94a3b8; padding:10px 12px; font-size:11px; resize:vertical; min-height:120px; font-family:monospace; }
  .pcs-btn-build { width:100%; margin-top:10px; padding:12px 0; border-radius:8px; border:none; cursor:pointer; background:linear-gradient(135deg,#f97316,#ea580c); color:#fff; font-family:'Bebas Neue',sans-serif; font-size:1rem; letter-spacing:.1em; }
  .pcs-btn-build:disabled { background:#1e293b; color:#475569; cursor:not-allowed; }
  .pcs-err { margin-top:8px; padding:8px 12px; background:rgba(127,29,29,0.4); border-radius:6px; font-size:11px; color:#fca5a5; }
  .pcs-btn-reset { width:100%; padding:8px 0; border-radius:8px; border:1px solid #334155; background:transparent; color:#64748b; font-size:.72rem; font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.08em; cursor:pointer; margin-bottom:14px; }
  .pcs-cols { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
  @media(max-width:900px){ .pcs-cols { grid-template-columns:repeat(2,1fr); } }
  @media(max-width:480px){ .pcs-cols { grid-template-columns:1fr; } }
  .pcs-card { border-radius:10px; overflow:hidden; border:2px solid; }
  .pcs-green  { border-color:#1b5e20; background:#0d1a0d; }
  .pcs-gold   { border-color:#f57f17; background:#1a1400; }
  .pcs-red    { border-color:#b71c1c; background:#1a0505; }
  .pcs-purple { border-color:#6a1b9a; background:#120a1a; }
  .pcs-orange { border-color:#bf360c; background:#1a0d00; }
  .pcs-ch { padding:10px 12px 8px; border-bottom:1px solid rgba(255,255,255,.07); text-align:center; }
  .pcs-ct { font-family:'Bebas Neue',sans-serif; font-size:1.2rem; letter-spacing:.05em; display:flex; align-items:center; justify-content:center; gap:6px; }
  .pcs-green  .pcs-ct { color:#00e676; }
  .pcs-gold   .pcs-ct { color:#ffd600; }
  .pcs-red    .pcs-ct { color:#ff1744; }
  .pcs-purple .pcs-ct { color:#ce93d8; }
  .pcs-orange .pcs-ct { color:#ff6d00; }
  .pcs-cs { font-size:.65rem; letter-spacing:.1em; text-transform:uppercase; color:#9e9e9e; margin-top:2px; }
  .pcs-th { display:grid; grid-template-columns:1fr 44px 70px; padding:4px 10px; font-size:.6rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#9e9e9e; border-bottom:1px solid rgba(255,255,255,.06); }
  .pcs-th span:not(:first-child) { text-align:center; }
  .pcs-row { display:grid; grid-template-columns:1fr 44px 70px; align-items:center; padding:7px 10px; border-bottom:1px solid rgba(255,255,255,.04); gap:4px; }
  .pcs-row:last-child { border-bottom:none; }
  .pcs-name { font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:.88rem; color:#fff; }
  .pcs-line { font-size:.64rem; color:#9e9e9e; margin-top:1px; }
  .pcs-pct  { font-family:'Bebas Neue',sans-serif; font-size:.9rem; text-align:center; }
  .pcs-green  .pcs-pct { color:#00e676; }
  .pcs-gold   .pcs-pct { color:#ffd600; }
  .pcs-red    .pcs-pct { color:#ff1744; }
  .pcs-purple .pcs-pct { color:#ce93d8; }
  .pcs-orange .pcs-pct { color:#ff6d00; }
  .pcs-empty { padding:14px; text-align:center; color:#475569; font-size:.74rem; }
  .pcs-badge-hot  { display:inline-block; font-size:.52rem; font-weight:700; padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle; background:rgba(255,214,0,.12); color:#ffd600; border:1px solid rgba(255,214,0,.3); text-transform:uppercase; }
  .pcs-badge-lock { display:inline-block; font-size:.52rem; font-weight:700; padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle; background:rgba(0,230,118,.1); color:#00e676; border:1px solid rgba(0,230,118,.3); text-transform:uppercase; }
  .pcs-hr-inner { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); }
  .pcs-legend { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  .pcs-leg-label { font-size:.66rem; color:#9e9e9e; letter-spacing:.1em; text-transform:uppercase; }
  .pcs-leg-item { display:flex; align-items:center; gap:4px; font-size:.66rem; color:#9e9e9e; }
  .pcs-leg-dot { width:7px; height:7px; border-radius:50%; }
  .pcs-section { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
  .pcs-section::after { content:''; flex:1; height:1px; background:rgba(255,255,255,.06); }
  .pcs-section-text { font-family:'Bebas Neue',sans-serif; font-size:.9rem; letter-spacing:.14em; color:#9e9e9e; text-transform:uppercase; white-space:nowrap; }
  .pcs-tabs { display:flex; border-bottom:1px solid rgba(255,255,255,.07); }
  .pcs-tab { flex:1; padding:6px 4px; font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:.7rem; letter-spacing:.08em; text-transform:uppercase; text-align:center; background:none; border:none; cursor:pointer; color:#9e9e9e; border-bottom:2px solid transparent; margin-bottom:-1px; transition:color .15s,border-color .15s; }
  .pcs-tab.active { color:#ce93d8; border-bottom-color:#ce93d8; }
`;

const PITCHER_SECTIONS = [
  { key:"kLocks",  label:"100% Club",    icon:"👑", subtitle:"Lock It In",     cls:"pcs-green"  },
  { key:"kHot",    label:"Hot K Lines",  icon:"🔥", subtitle:"Strong Plays",   cls:"pcs-gold"   },
  { key:"kUnders", label:"K Unders",     icon:"⬇️", subtitle:"Fade These",     cls:"pcs-red"    },
];

export default function PropsCheatSheet({ sheetData, onSheetBuilt }) {
  const today = new Date().toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric'});
  const [paste, setPaste] = useState('');
  const [sheet, setSheet] = useState(sheetData || null);
  const [err, setErr]     = useState('');
  const [activeHit, setActiveHit] = useState('hits');

  const build = () => {
    setErr('');
    try {
      let raw = paste.trim();
      // Extract JSON object
      const start = raw.indexOf('{');
      const end   = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1) raw = raw.slice(start, end+1);
      // Fix NaN values that Python writes (not valid JSON)
      raw = raw.replace(/:\s*NaN/g, ': 0');
      raw = raw.replace(/:\s*Infinity/g, ': 0');
      raw = raw.replace(/:\s*-Infinity/g, ': 0');
      const json = JSON.parse(raw);
      const result = buildSheet(json);
      setSheet(result);
      if (onSheetBuilt) onSheetBuilt(result);
    } catch(e) {
      setErr('Could not parse JSON: ' + e.message);
    }
  };

  if (!sheet) return (
    <>
      <style>{S}</style>
      <div className="pcs">
        <div className="pcs-title">⚾ Props Cheat Sheet</div>
        <div className="pcs-date">{today}</div>
        <div className="pcs-paste-box">
          <div className="pcs-paste-label">📋 Paste Props JSON</div>
          <div className="pcs-paste-hint">
            After running MLB Props Calculator in Colab, copy the JSON from the bottom of the output and paste below.
          </div>
          <textarea
            className="pcs-textarea"
            value={paste}
            onChange={e=>setPaste(e.target.value)}
            placeholder='Paste props JSON here (copy from BETLAB JSON section at bottom of Colab output)...'
          />
          <button className="pcs-btn-build" disabled={!paste.trim()} onClick={build}>
            ⚾ BUILD CHEAT SHEET
          </button>
          {err && <div className="pcs-err">{err}</div>}
        </div>
      </div>
    </>
  );

  // Sheet is loaded — show cheat sheet

  const { kLocks, kHot, kParlay, kUnders, hits, hits2, hrs } = sheet;
  const hitRows = activeHit === 'hits' ? hits : (hits2 || []);

  return (
    <>
      <style>{S}</style>
      <div className="pcs">
        <div className="pcs-title">⚾ Props Cheat Sheet</div>
        <div className="pcs-date">{today}</div>

        <button className="pcs-btn-reset" onClick={()=>{ setSheet(null); if(onSheetBuilt) onSheetBuilt(null); }}>
          🔄 Load New Day
        </button>

        {/* Legend */}
        <div className="pcs-legend">
          <span className="pcs-leg-label">Matchup:</span>
          {["green","yellow","red"].map(c=>(
            <span className="pcs-leg-item" key={c}>
              <span className="pcs-leg-dot" style={{background:MU[c].dot}}/>
              {MU[c].label}
            </span>
          ))}
        </div>

        {/* Pitcher K Props */}
        <div className="pcs-section"><span className="pcs-section-text">⚾ Pitcher Strikeout Props</span></div>
        <div className="pcs-cols">
          {PITCHER_SECTIONS.map(({key,label,icon,subtitle,cls})=>(
            <div className={`pcs-card ${cls}`} key={key}>
              <div className="pcs-ch">
                <div className="pcs-ct">{icon} {label}</div>
                <div className="pcs-cs">{subtitle}</div>
              </div>
              <div className="pcs-th"><span>Pitcher</span><span>Conf</span><span>Matchup</span></div>
              {sheet[key].length===0
                ? <div className="pcs-empty">No picks today</div>
                : sheet[key].map((r,i)=>(
                  <div className="pcs-row" key={i}>
                    <div>
                      <div className="pcs-name">{r.name}</div>
                      <div className="pcs-line">{r.line}</div>
                    </div>
                    <div className="pcs-pct">{r.pct}</div>
                    <Pill color={r.matchup}/>
                  </div>
                ))
              }
            </div>
          ))}

          {/* Hits + HR */}
          <div className="pcs-card pcs-purple">
            <div className="pcs-ch">
              <div className="pcs-ct">🎯 Batter Props</div>
              <div className="pcs-cs">Hits & Home Runs</div>
            </div>
            <div className="pcs-tabs">
              <button className={`pcs-tab ${activeHit==='hits'?'active':''}`} onClick={()=>setActiveHit('hits')}>1+ Hits</button>
              <button className={`pcs-tab ${activeHit==='hits2'?'active':''}`} onClick={()=>setActiveHit('hits2')}>2+ Hits</button>
            </div>
            <div className="pcs-th"><span>Batter</span><span>Conf</span><span>Matchup</span></div>
            {hitRows.length===0
              ? <div className="pcs-empty">No picks today</div>
              : hitRows.map((r,i)=>(
                <div className="pcs-row" key={i}>
                  <div>
                    <div className="pcs-name">
                      {r.name}
                      {r.badge==="hot"  && <span className="pcs-badge-hot">Hot</span>}
                      {r.badge==="lock" && <span className="pcs-badge-lock">Lock</span>}
                    </div>
                    <div className="pcs-line">{r.line}</div>
                  </div>
                  <div className="pcs-pct">{r.pct}</div>
                  <Pill color={r.matchup}/>
                </div>
              ))
            }
          </div>
        </div>

        {/* Parlay Legs */}
        {(kParlay||[]).length > 0 && (
          <div style={{marginBottom:12}}>
            <div className="pcs-section"><span className="pcs-section-text">🎯 Parlay Legs — High Rate Any Odds</span></div>
            <div className="pcs-card pcs-gold">
              <div className="pcs-ch">
                <div className="pcs-ct">🎯 Parlay Legs</div>
                <div className="pcs-cs">75%+ Hit Rate — Good SGP Legs</div>
              </div>
              <div className="pcs-th"><span>Pitcher</span><span>Conf</span><span>Matchup</span></div>
              {(kParlay||[]).map((row,i)=>{
                const mu = pitcherMU({oppOPS:row.oppOPS||0.720,oppKpct:row.oppKpct||22});
                return (
                  <div className="pcs-row" key={i}>
                    <div><div className="pcs-name">{row.name}</div><div className="pcs-line">{row.line} · {row.fraction}</div></div>
                    <div className="pcs-pct">{row.pct}</div>
                    <Pill color={mu}/>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary counts */}
        <div style={{background:'rgba(10,18,35,0.8)',border:'1px solid #1e293b',borderRadius:10,padding:'12px 16px',textAlign:'center'}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'0.85rem',letterSpacing:'.14em',color:'#9e9e9e',marginBottom:6}}>TODAY'S SUMMARY</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {[
              {label:'K Locks',  val:kLocks.length,  color:'#00e676'},
              {label:'K Hot',    val:kHot.length,    color:'#ffd600'},
              {label:'K Unders', val:kUnders.length, color:'#ff1744'},
              {label:'Hits',     val:hits.length,    color:'#ce93d8'},
            ].map(({label,val,color})=>(
              <div key={label}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'1.4rem',color}}>{val}</div>
                <div style={{fontSize:'.62rem',color:'#475569',letterSpacing:'.1em',textTransform:'uppercase'}}>{label}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
