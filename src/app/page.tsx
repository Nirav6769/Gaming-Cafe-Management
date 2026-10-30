"use client";

import { useCallback, useEffect, useState } from "react";

type PC = { pc_id:number; pc_name:string; status:string; hourly_rate:string; session_id:number|null; start_time:string|null; customer_name:string|null };
type Customer = { customer_id:number; name:string; email:string; phone:string|null; join_date:string };
type Session = { session_id:number; customer_name:string; pc_name:string; start_time:string; end_time:string|null; total_cost:string|null; status:string };
type Game = { game_id:number; title:string; description:string|null; category_name:string|null };
type Category = { category_id:number; category_name:string };
type Dashboard = { pcs:{total:number;available:number;occupied:number;maintenance:number}; activeSessions:number; todayRevenue:string };

async function api<T>(url:string, options?:RequestInit):Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type":"application/json", ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
const money = (value:string|number) => "₹" + Number(value || 0).toFixed(2);
const dateTime = (value:string) => new Date(value).toLocaleString();

export default function Home() {
  const [tab,setTab] = useState("Overview");
  const [dashboard,setDashboard] = useState<Dashboard|null>(null);
  const [pcs,setPcs] = useState<PC[]>([]);
  const [customers,setCustomers] = useState<Customer[]>([]);
  const [sessions,setSessions] = useState<Session[]>([]);
  const [games,setGames] = useState<Game[]>([]);
  const [categories,setCategories] = useState<Category[]>([]);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const [customerSearch,setCustomerSearch] = useState("");
  const [customerForm,setCustomerForm] = useState({name:"",email:"",phone:""});
  const [gameForm,setGameForm] = useState({title:"",categoryId:"",description:""});
  const [sessionForm,setSessionForm] = useState({customerId:"",pcId:""});
  const [busy,setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [d,p,c,s,g] = await Promise.all([
      api<Dashboard>("/api/dashboard"), api<PC[]>("/api/pcs"),
      api<Customer[]>(`/api/customers?search=${encodeURIComponent(customerSearch)}`),
      api<Session[]>("/api/sessions"), api<{games:Game[];categories:Category[]}>("/api/games")
    ]);
    setDashboard(d); setPcs(p); setCustomers(c); setSessions(s); setGames(g.games); setCategories(g.categories);
  },[customerSearch]);

  useEffect(() => { refresh().catch(e => setError(e.message)); },[refresh]);
  async function run(action:()=>Promise<unknown>, success:string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); setNotice(success); }
    catch(e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">GC</div><div><strong>GAMEHUB</strong><small>CAFE MANAGEMENT</small></div></div>
      <div className="side-label">WORKSPACE</div>
      {["Overview","PC Management","Customers","Sessions","Games"].map(item=><button key={item} className={tab===item?"nav-item active":"nav-item"} onClick={()=>setTab(item)}><span>{({Overview:"▦","PC Management":"▣",Customers:"♙",Sessions:"◷",Games:"▤"} as Record<string,string>)[item]}</span>{item}</button>)}
      <div className="sidebar-bottom"><span className="live-dot"/> SYSTEM ONLINE<small>Gaming Cafe · Admin</small></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div><span className="eyebrow">MANAGEMENT CONSOLE</span><h1>{tab}</h1></div><button className="refresh-btn" onClick={()=>refresh().catch(e=>setError(e.message))}>↻ Refresh</button></header>
      {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {!dashboard && !error ? <div className="loading">Connecting to your cafe database…</div> : <>
      {tab==="Overview" && <div className="content">
        <div className="welcome"><div><span className="eyebrow">LIVE OPERATIONS</span><h2>Your cafe, at a glance.</h2><p>Real-time status from your PostgreSQL database.</p></div><div className="welcome-icon">⌘</div></div>
        <div className="stats-grid">
          <Stat label="TOTAL GAMING PCS" value={dashboard?.pcs.total??0} note="Registered machines" icon="▣"/>
          <Stat label="AVAILABLE PCS" value={dashboard?.pcs.available??0} note="Ready for a session" icon="✓"/>
          <Stat label="ACTIVE SESSIONS" value={dashboard?.activeSessions??0} note="Players currently gaming" icon="◷"/>
          <Stat label="TODAY'S REVENUE" value={money(dashboard?.todayRevenue??0)} note="Completed sessions today" icon="₹"/>
        </div>
        <div className="section-heading"><div><span className="eyebrow">FLOOR STATUS</span><h2>PC availability</h2></div><button className="text-btn" onClick={()=>setTab("PC Management")}>Manage PCs →</button></div>
        <div className="pc-grid">{pcs.map(pc=><PCtile key={pc.pc_id} pc={pc}/>)}</div>
        <div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Latest sessions</h2></div><button className="text-btn" onClick={()=>setTab("Sessions")}>All sessions →</button></div>
        <SessionTable sessions={sessions.slice(0,5)}/>
      </div>}
      {tab==="PC Management" && <div className="content"><div className="section-heading"><div><span className="eyebrow">HARDWARE</span><h2>Manage your gaming stations</h2></div></div><div className="pc-grid">{pcs.map(pc=><div className="pc-card" key={pc.pc_id}><PCtile pc={pc}/><div className="pc-actions">{pc.status==="maintenance"?<button disabled={busy} onClick={()=>run(()=>api("/api/pcs",{method:"PATCH",body:JSON.stringify({pcId:pc.pc_id,status:"available"})}),"PC marked available.")}>Mark available</button>:pc.status==="available"?<button disabled={busy} onClick={()=>run(()=>api("/api/pcs",{method:"PATCH",body:JSON.stringify({pcId:pc.pc_id,status:"maintenance"})}),"PC moved to maintenance.")}>Set maintenance</button>:<span className="muted">End active session first</span>}</div></div>)}</div></div>}
      {tab==="Customers" && <div className="content"><div className="section-heading"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>Customers</h2></div></div><form className="panel form-grid" onSubmit={e=>{e.preventDefault();run(async()=>{await api("/api/customers",{method:"POST",body:JSON.stringify(customerForm)});setCustomerForm({name:"",email:"",phone:""});},"Customer added successfully.");}}><h3>Add a customer</h3><input placeholder="Full name" required value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/><input placeholder="Email address" type="email" required value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/><input placeholder="Phone (optional)" value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/><button className="primary-btn" disabled={busy}>Add customer</button></form><div className="table-tools"><input placeholder="Search name, email or phone…" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)}/><span>{customers.length} results</span></div><div className="table-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>PHONE</th><th>JOINED</th></tr></thead><tbody>{customers.map(c=><tr key={c.customer_id}><td>{c.name}</td><td>{c.email}</td><td>{c.phone||"—"}</td><td>{new Date(c.join_date).toLocaleDateString()}</td></tr>)}</tbody></table></div></div>}
      {tab==="Sessions" && <div className="content"><div className="section-heading"><div><span className="eyebrow">PLAYTIME & BILLING</span><h2>Gaming sessions</h2></div></div><form className="panel form-grid" onSubmit={e=>{e.preventDefault();run(async()=>{await api("/api/sessions",{method:"POST",body:JSON.stringify(sessionForm)});setSessionForm({customerId:"",pcId:""});},"Session started.");}}><h3>Start a session</h3><select required value={sessionForm.customerId} onChange={e=>setSessionForm({...sessionForm,customerId:e.target.value})}><option value="">Choose customer</option>{customers.map(c=><option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}</select><select required value={sessionForm.pcId} onChange={e=>setSessionForm({...sessionForm,pcId:e.target.value})}><option value="">Choose available PC</option>{pcs.filter(p=>p.status==="available").map(p=><option key={p.pc_id} value={p.pc_id}>{p.pc_name} · {money(p.hourly_rate)}/hr</option>)}</select><button className="primary-btn" disabled={busy}>Start session</button></form><SessionTable sessions={sessions} onEnd={id=>run(()=>api("/api/sessions",{method:"PATCH",body:JSON.stringify({sessionId:id})}),"Session ended and bill calculated.")} busy={busy}/></div>}
      {tab==="Games" && <div className="content"><div className="section-heading"><div><span className="eyebrow">GAME LIBRARY</span><h2>Games & categories</h2></div></div><form className="panel form-grid" onSubmit={e=>{e.preventDefault();run(async()=>{await api("/api/games",{method:"POST",body:JSON.stringify(gameForm)});setGameForm({title:"",categoryId:"",description:""});},"Game added.");}}><h3>Add a game</h3><input placeholder="Game title" required value={gameForm.title} onChange={e=>setGameForm({...gameForm,title:e.target.value})}/><select value={gameForm.categoryId} onChange={e=>setGameForm({...gameForm,categoryId:e.target.value})}><option value="">No category</option>{categories.map(c=><option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}</select><input placeholder="Description (optional)" value={gameForm.description} onChange={e=>setGameForm({...gameForm,description:e.target.value})}/><button className="primary-btn" disabled={busy}>Add game</button></form><div className="game-grid">{games.map(g=><div className="game-card" key={g.game_id}><span className="game-symbol">▤</span><div><strong>{g.title}</strong><small>{g.category_name||"Uncategorised"}</small><p>{g.description}</p></div></div>)}</div></div>}
      </>}
    </section>
  </main>;
}

function Stat({label,value,note,icon}:{label:string;value:string|number;note:string;icon:string}) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><b>{icon}</b></div><strong>{value}</strong><small>{note}</small></div>;
}
function PCtile({pc}:{pc:PC}) {
  return <div className="pc-tile"><div className="pc-tile-top"><span className="pc-icon">▣</span><span className={`status-pill ${pc.status}`}>{pc.status}</span></div><strong>{pc.pc_name}</strong><small>{money(pc.hourly_rate)} / hour</small>{pc.customer_name&&<small className="occupant">Playing: {pc.customer_name}</small>}</div>;
}
function SessionTable({sessions,onEnd,busy=false}:{sessions:Session[];onEnd?:(id:number)=>void;busy?:boolean}) {
  return <div className="table-wrap"><table><thead><tr><th>CUSTOMER</th><th>PC</th><th>STARTED</th><th>STATUS</th><th>BILL</th>{onEnd&&<th>ACTION</th>}</tr></thead><tbody>{sessions.length===0?<tr><td colSpan={onEnd?6:5} className="empty">No sessions recorded yet.</td></tr>:sessions.map(s=><tr key={s.session_id}><td>{s.customer_name}</td><td>{s.pc_name}</td><td>{dateTime(s.start_time)}</td><td><span className={`status-pill ${s.status==="active"?"occupied":"available"}`}>{s.status}</span></td><td>{s.total_cost===null?"—":money(s.total_cost)}</td>{onEnd&&<td>{s.status==="active"&&<button className="end-btn" disabled={busy} onClick={()=>onEnd(s.session_id)}>End session</button>}</td>}</tr>)}</tbody></table></div>;
}
