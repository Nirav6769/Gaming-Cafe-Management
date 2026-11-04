"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Role = "admin" | "staff" | "customer";
type Customer = { customer_id:number; name:string; email:string; phone:string|null; join_date:string; updated_at:string };
type Plan = { plan_id:number; name:string; description:string|null; duration_days:number; price:string; discount_percent:string; is_active:boolean };
type Snack = { snack_id:number; name:string; category:string|null; description:string|null; unit_price:string; stock_quantity:number; is_active:boolean };
type Membership = { membership_id:number; customer_id:number; customer_name:string; plan_id:number; plan_name:string; discount_percent:string; start_at:string; end_at:string; status:string; price_paid:string; payment_method:string };
type Item = { order_item_id:number; snack_id:number; name:string; quantity:number; unit_price_at_purchase:string; line_total:string };
type Payment = { payment_id:number; amount:string; method:string; status:string; provider_reference:string|null; created_at:string };
type Order = { order_id:number; customer_id:number; customer_name:string; status:"pending"|"paid"|"cancelled"|"refunded"; subtotal:string; discount_percent_snapshot:string; discount_amount:string; total_amount:string; created_at:string; inventory_deducted_at:string|null; items:Item[]; payment:Payment|null };
type Overview = { role:Role; customerId:number|null; plans:Plan[]; snacks:Snack[]; memberships:Membership[]; orders:Order[]; customers:Customer[] };

async function api<T>(url:string, options?:RequestInit):Promise<T> {
  const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...options?.headers}});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||"Request failed");
  return data as T;
}
const money=(v:string|number)=>"₹"+Number(v||0).toFixed(2);
const date=(v:string)=>new Date(v).toLocaleDateString();
const dateTime=(v:string)=>new Date(v).toLocaleString();

export default function CommerceClient({role,customerId}:{role:Role;customerId:number|null}) {
  const isCustomer=role==="customer", isAdmin=role==="admin", canManage=!isCustomer;
  const [data,setData]=useState<Overview|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [targetCustomerId,setTargetCustomerId]=useState("");
  const [customerSearch,setCustomerSearch]=useState("");
  const [customerForm,setCustomerForm]=useState({name:"",email:"",phone:""});
  const [planForm,setPlanForm]=useState({name:"",description:"",durationDays:"30",price:"",discountPercent:"5"});
  const [snackForm,setSnackForm]=useState({name:"",category:"",description:"",unitPrice:"",stockQuantity:""});
  const [quantities,setQuantities]=useState<Record<number,number>>({});
  const [paymentMethod,setPaymentMethod]=useState("cash");
  const [membershipMethod,setMembershipMethod]=useState("upi_demo");

  const refresh=useCallback(async()=>{
    const result=await api<Overview>("/api/commerce");
    setData(result);
    if(result.role==="customer"&&result.customers[0]){
      setCustomerForm({name:result.customers[0].name,email:result.customers[0].email,phone:result.customers[0].phone??""});
    }
  },[]);

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try {
        const result=await api<Overview>("/api/commerce");
        if(!cancelled){
          setData(result);
          if(result.role==="customer"&&result.customers[0]){
            setCustomerForm({name:result.customers[0].name,email:result.customers[0].email,phone:result.customers[0].phone??""});
          }
        }
      }catch(err){if(!cancelled)setError(err instanceof Error?err.message:"Unable to load commerce data.");}
      finally{if(!cancelled)setLoading(false);}
    }
    void load();
    return()=>{cancelled=true;};
  },[]);

  async function run(action:()=>Promise<unknown>,success:string){
    setBusy(true);setError("");setNotice("");
    try{await action();await refresh();setNotice(success);}
    catch(err){setError(err instanceof Error?err.message:"Something went wrong.");}
    finally{setBusy(false);}
  }

  const filteredCustomers=useMemo(()=>{
    const search=customerSearch.trim().toLowerCase();
    if(!data||!search)return data?.customers??[];
    return data.customers.filter(c=>[c.name,c.email,c.phone??""].some(v=>v.toLowerCase().includes(search)));
  },[data,customerSearch]);

  async function createOrder(){
    const items=Object.entries(quantities).filter(([,q])=>q>0).map(([id,q])=>({snackId:Number(id),quantity:q}));
    if(items.length===0){setError("Choose at least one snack and quantity.");return;}
    if(canManage&&!targetCustomerId){setError("Choose a customer for this order.");return;}
    await run(async()=>{
      await api("/api/commerce/orders",{method:"POST",body:JSON.stringify({...(canManage?{customerId:Number(targetCustomerId)}:{}),items})});
      setQuantities({});
    },"Pending order created. An authorised staff member must record payment to deduct stock.");
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">GC</div><div><strong>GAMEHUB</strong><small>CAFE MANAGEMENT</small></div></div>
      <div className="side-label">WORKSPACE</div>
      {canManage&&<Link className="nav-item" href="/dashboard"><span>▦</span>Dashboard</Link>}
      <Link className="nav-item active" href="/commerce"><span>₹</span>Commerce</Link>
      {canManage&&<Link className="nav-item" href="/operations"><span>⚙</span>Operations</Link>}
      <div className="sidebar-bottom"><span className="live-dot"/> SYSTEM ONLINE<small>{role.toUpperCase()} ACCOUNT</small></div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div><span className="eyebrow">CUSTOMERS · MEMBERSHIPS · SNACKS · PAYMENTS</span><h1>Commerce</h1></div><button className="refresh-btn" disabled={busy} onClick={()=>void run(refresh,"Commerce data refreshed.")}>↻ Refresh</button></header>
      {error&&<div className="alert error" role="alert">{error}</div>}
      {notice&&<div className="alert success" role="status">{notice}</div>}
      {loading?<div className="loading">Loading commerce data…</div>:data&&<div className="content">
        <div className="welcome"><div><span className="eyebrow">COMMERCE DESK</span><h2>{isCustomer?"Your café account.":"Customer and commerce management."}</h2><p>{isCustomer?"Update your profile, view your memberships and place snack orders.":"Manage customer records, memberships, snack stock and payment records."}</p></div><div className="welcome-icon">₹</div></div>

        {isCustomer&&<><div className="section-heading"><div><span className="eyebrow">YOUR PROFILE</span><h2>Customer details</h2></div></div>
          <form className="panel form-grid" onSubmit={e=>{e.preventDefault();if(customerId)void run(()=>api(`/api/commerce/customers/${customerId}`,{method:"PATCH",body:JSON.stringify(customerForm)}),"Your profile was updated.");}}>
            <h3>Update your profile</h3>
            <input required maxLength={100} placeholder="Full name" value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/>
            <input required type="email" maxLength={100} placeholder="Email address" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/>
            <input maxLength={15} placeholder="Phone (optional)" value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/>
            <button className="primary-btn" disabled={busy||!customerId}>Save profile</button>
          </form></>}

        {canManage&&<>
          <div className="section-heading"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>Customers</h2></div><span className="muted">{data.customers.length} loaded</span></div>
          <form className="panel form-grid" onSubmit={e=>{e.preventDefault();void run(async()=>{await api("/api/commerce/customers",{method:"POST",body:JSON.stringify(customerForm)});setCustomerForm({name:"",email:"",phone:""});},"Customer added.");}}>
            <h3>Add a customer</h3>
            <input required maxLength={100} placeholder="Full name" value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/>
            <input required type="email" maxLength={100} placeholder="Email address" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/>
            <input maxLength={15} placeholder="Phone (optional)" value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/>
            <button className="primary-btn" disabled={busy}>Add customer</button>
          </form>
          <div className="table-tools"><input aria-label="Search customers" placeholder="Search name, email or phone…" value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)}/><span>{filteredCustomers.length} results</span></div>
          <div className="table-wrap"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>PHONE</th><th>JOINED</th></tr></thead><tbody>
            {filteredCustomers.map(c=><tr key={c.customer_id}><td>{c.name} <small className="text-slate-500">#{c.customer_id}</small></td><td>{c.email}</td><td>{c.phone||"—"}</td><td>{date(c.join_date)}</td></tr>)}
            {filteredCustomers.length===0&&<tr><td colSpan={4} className="empty">No matching customers.</td></tr>}
          </tbody></table></div>
          <div className="panel mt-4 grid gap-3 p-4"><label htmlFor="commerce-customer">Customer for membership assignment and new orders</label>
            <select id="commerce-customer" required value={targetCustomerId} onChange={e=>setTargetCustomerId(e.target.value)}><option value="">Choose customer</option>
              {data.customers.map(c=><option key={c.customer_id} value={c.customer_id}>{c.name} · {c.email} · #{c.customer_id}</option>)}
            </select>
          </div>
        </>}

        <div className="section-heading"><div><span className="eyebrow">MEMBERSHIP PLANS</span><h2>Available plans</h2></div><span className="muted">{data.plans.filter(p=>p.is_active).length} active plans</span></div>
        {canManage&&isAdmin&&<form className="panel form-grid" onSubmit={e=>{e.preventDefault();void run(async()=>{await api("/api/commerce/plans",{method:"POST",body:JSON.stringify({...planForm,durationDays:Number(planForm.durationDays),price:Number(planForm.price),discountPercent:Number(planForm.discountPercent)})});setPlanForm({name:"",description:"",durationDays:"30",price:"",discountPercent:"5"});},"Membership plan created.");}}>
          <h3>Create a membership plan (admin)</h3>
          <input required maxLength={80} placeholder="Plan name" value={planForm.name} onChange={e=>setPlanForm({...planForm,name:e.target.value})}/>
          <input placeholder="Description" value={planForm.description} onChange={e=>setPlanForm({...planForm,description:e.target.value})}/>
          <input required type="number" min="1" max="3650" placeholder="Duration (days)" value={planForm.durationDays} onChange={e=>setPlanForm({...planForm,durationDays:e.target.value})}/>
          <input required type="number" min="0" step="0.01" placeholder="Price (₹)" value={planForm.price} onChange={e=>setPlanForm({...planForm,price:e.target.value})}/>
          <input required type="number" min="0" max="100" step="0.1" placeholder="Discount (%)" value={planForm.discountPercent} onChange={e=>setPlanForm({...planForm,discountPercent:e.target.value})}/>
          <button className="primary-btn" disabled={busy}>Create plan</button>
        </form>}
        <div className="pc-grid">{data.plans.map(p=><article className="pc-tile" key={p.plan_id}>
          <div className="pc-tile-top"><span className="pc-icon">✦</span><span className={p.is_active?"status-pill available":"status-pill maintenance"}>{p.is_active?"Active":"Inactive"}</span></div>
          <strong>{p.name}</strong><small>{p.description||"Gaming café membership"}</small><small>{p.duration_days} days · {money(p.price)}</small><small>{Number(p.discount_percent)}% snack discount</small>
          {p.is_active&&<button className="primary-btn mt-3" disabled={busy||(canManage&&!targetCustomerId)} onClick={()=>void run(()=>api("/api/commerce/memberships",{method:"POST",body:JSON.stringify({planId:p.plan_id,paymentMethod:membershipMethod,...(canManage?{customerId:Number(targetCustomerId)}:{})})}),"Membership recorded using the server-side plan price. No payment gateway was used.")}>{isCustomer?"Purchase membership (demo)": "Assign membership"}</button>}
          {canManage&&isAdmin&&<button className="text-btn mt-2" disabled={busy} onClick={()=>void run(()=>api("/api/commerce/plans",{method:"PATCH",body:JSON.stringify({planId:p.plan_id,isActive:!p.is_active})}),p.is_active?"Plan deactivated.":"Plan reactivated.")}>{p.is_active?"Deactivate":"Reactivate"}</button>}
        </article>)}{data.plans.length===0&&<div className="empty">No membership plans available.</div>}</div>
        <div className="panel mt-3 grid gap-2 p-4"><label htmlFor="membership-method">Membership payment record method (demo only)</label>
          <select id="membership-method" value={membershipMethod} onChange={e=>setMembershipMethod(e.target.value)}>
            {canManage&&<option value="cash">Cash</option>}<option value="upi_demo">UPI demo</option><option value="card_demo">Card demo</option>
          </select><small className="muted">No card, UPI PIN or banking credentials are collected. Membership revenue is recorded as a demo transaction.</small>
        </div>

        <div className="section-heading"><div><span className="eyebrow">CUSTOMER MEMBERSHIPS</span><h2>{isCustomer?"Your memberships":"Membership register"}</h2></div></div>
        <div className="table-wrap"><table><thead><tr>{canManage&&<th>CUSTOMER</th>}<th>PLAN</th><th>DISCOUNT</th><th>STARTS</th><th>ENDS</th><th>STATUS</th><th>PRICE PAID</th><th>METHOD</th>{canManage&&<th>ACTION</th>}</tr></thead><tbody>
          {data.memberships.map(m=><tr key={m.membership_id}>{canManage&&<td>{m.customer_name} #{m.customer_id}</td>}<td>{m.plan_name}</td><td>{Number(m.discount_percent)}%</td><td>{date(m.start_at)}</td><td>{date(m.end_at)}</td><td><span className={m.status==="active"?"status-pill available":"status-pill maintenance"}>{m.status}</span></td><td>{money(m.price_paid)}</td><td>{m.payment_method}</td>
            {canManage&&<td>{m.status==="active"&&<button className="text-btn" disabled={busy} onClick={()=>void run(()=>api(`/api/commerce/memberships/${m.membership_id}`,{method:"PATCH",body:JSON.stringify({status:"cancelled"})}),"Membership cancelled.")}>Cancel</button>}</td>}
          </tr>)}
          {data.memberships.length===0&&<tr><td colSpan={canManage?9:7} className="empty">No memberships found.</td></tr>}
        </tbody></table></div>

        {canManage&&<>
          <div className="section-heading"><div><span className="eyebrow">SNACK COUNTER</span><h2>Manage inventory</h2></div></div>
          <form className="panel form-grid" onSubmit={e=>{e.preventDefault();void run(async()=>{await api("/api/commerce/snacks",{method:"POST",body:JSON.stringify({...snackForm,unitPrice:Number(snackForm.unitPrice),stockQuantity:Number(snackForm.stockQuantity)})});setSnackForm({name:"",category:"",description:"",unitPrice:"",stockQuantity:""});},"Snack added to inventory.");}}>
            <h3>Add snack</h3><input required maxLength={100} placeholder="Snack name" value={snackForm.name} onChange={e=>setSnackForm({...snackForm,name:e.target.value})}/>
            <input maxLength={80} placeholder="Category" value={snackForm.category} onChange={e=>setSnackForm({...snackForm,category:e.target.value})}/>
            <input placeholder="Description" value={snackForm.description} onChange={e=>setSnackForm({...snackForm,description:e.target.value})}/>
            <input required type="number" min="0" step="0.01" placeholder="Price (₹)" value={snackForm.unitPrice} onChange={e=>setSnackForm({...snackForm,unitPrice:e.target.value})}/>
            <input required type="number" min="0" step="1" placeholder="Opening stock" value={snackForm.stockQuantity} onChange={e=>setSnackForm({...snackForm,stockQuantity:e.target.value})}/>
            <button className="primary-btn" disabled={busy}>Add snack</button>
          </form>
        </>}
        <div className="section-heading"><div><span className="eyebrow">SNACK CATALOGUE</span><h2>Snacks and stock</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>SNACK</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>STATUS</th>{canManage&&<th>MANAGE</th>}</tr></thead><tbody>
          {data.snacks.map(s=><tr key={s.snack_id}><td>{s.name}<small className="block text-slate-500">{s.description}</small></td><td>{s.category||"—"}</td><td>{money(s.unit_price)}</td><td>{s.stock_quantity}</td><td><span className={s.is_active?"status-pill available":"status-pill maintenance"}>{s.is_active?"Active":"Inactive"}</span></td>
            {canManage&&<td className="flex flex-wrap gap-1">
              <button className="text-btn" disabled={busy} onClick={()=>{const v=window.prompt("New stock quantity",String(s.stock_quantity));if(v===null)return;const n=Number(v);if(!Number.isInteger(n)||n<0){setError("Stock must be a non-negative whole number.");return;}void run(()=>api("/api/commerce/snacks",{method:"PATCH",body:JSON.stringify({snackId:s.snack_id,stockQuantity:n})}),"Stock updated.");}}>Stock</button>
              <button className="text-btn" disabled={busy} onClick={()=>{const v=window.prompt("New unit price",String(s.unit_price));if(v===null)return;const n=Number(v);if(!Number.isFinite(n)||n<0){setError("Price must be non-negative.");return;}void run(()=>api("/api/commerce/snacks",{method:"PATCH",body:JSON.stringify({snackId:s.snack_id,unitPrice:n})}),"Price updated. Existing orders retain their snapshot.");}}>Price</button>
              <button className="text-btn" disabled={busy} onClick={()=>void run(()=>api("/api/commerce/snacks",{method:"PATCH",body:JSON.stringify({snackId:s.snack_id,isActive:!s.is_active})}),s.is_active?"Snack deactivated.":"Snack activated.")}>{s.is_active?"Deactivate":"Activate"}</button>
            </td>}
          </tr>)}
          {data.snacks.length===0&&<tr><td colSpan={canManage?6:5} className="empty">No snacks available.</td></tr>}
        </tbody></table></div>

        <div className="section-heading"><div><span className="eyebrow">NEW ORDER</span><h2>Create a snack order</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>ITEM</th><th>UNIT PRICE</th><th>AVAILABLE</th><th>QUANTITY</th></tr></thead><tbody>
          {data.snacks.filter(s=>s.is_active).map(s=><tr key={s.snack_id}><td>{s.name}</td><td>{money(s.unit_price)}</td><td>{s.stock_quantity}</td><td><input aria-label={`Quantity of ${s.name}`} className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" type="number" min="0" max="999" step="1" value={quantities[s.snack_id]??0} onChange={e=>setQuantities({...quantities,[s.snack_id]:Math.max(0,Math.min(999,Math.floor(Number(e.target.value)||0)))})}/></td></tr>)}
          {data.snacks.filter(s=>s.is_active).length===0&&<tr><td colSpan={4} className="empty">No active snacks available.</td></tr>}
        </tbody></table></div>
        {canManage&&<div className="panel mt-3 grid gap-2 p-4"><label htmlFor="order-payment-method">Payment method for staff payment recording</label><select id="order-payment-method" value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="upi_demo">UPI demo</option><option value="card_demo">Card demo</option></select></div>}
        <div className="panel mt-3 grid gap-3 p-4"><button className="primary-btn w-fit" disabled={busy||(canManage&&!targetCustomerId)} onClick={()=>void createOrder()}>Create pending order</button><small className="muted">The database snapshots current snack prices and membership discount. Only an authorised staff member can mark payment as paid; stock is deducted atomically at that time.</small></div>

        <div className="section-heading"><div><span className="eyebrow">ORDER HISTORY</span><h2>{isCustomer?"Your orders":"Customer orders"}</h2></div></div>
        <div className="grid gap-3">{data.orders.map(o=><article className="panel" key={o.order_id}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Order #{o.order_id}</strong>{canManage&&<small className="ml-2 text-slate-400">{o.customer_name} · customer #{o.customer_id}</small>}<small className="mt-1 block text-slate-500">{dateTime(o.created_at)}</small></div><span className={o.status==="paid"?"status-pill available":o.status==="pending"?"status-pill occupied":"status-pill maintenance"}>{o.status}</span></div>
          <div className="mt-3 grid gap-2">{o.items.map(item=><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 py-2 text-sm" key={item.order_item_id}>
            <span>{item.name} × {item.quantity} · {money(item.unit_price_at_purchase)} each</span><span>{money(item.line_total)}</span>
            {o.status==="pending"&&<div className="flex gap-2">
              <button className="text-btn" disabled={busy} onClick={()=>{const v=window.prompt("New quantity",String(item.quantity));if(v===null)return;const n=Number(v);if(!Number.isInteger(n)||n<1||n>999){setError("Quantity must be a whole number from 1 to 999.");return;}void run(()=>api(`/api/commerce/orders/${o.order_id}/items/${item.order_item_id}`,{method:"PATCH",body:JSON.stringify({quantity:n})}),"Quantity updated; original unit price retained.");}}>Qty</button>
              <button className="text-btn" disabled={busy} onClick={()=>void run(()=>api(`/api/commerce/orders/${o.order_id}/items/${item.order_item_id}`,{method:"DELETE"}),"Pending order item removed.")}>Remove</button>
            </div>}
          </div>)}{o.items.length===0&&<small className="muted">No line items.</small>}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="text-sm"><span className="text-slate-400">Subtotal {money(o.subtotal)}</span><span className="ml-3 text-slate-400">Member discount {Number(o.discount_percent_snapshot)}% (−{money(o.discount_amount)})</span><strong className="ml-3">Total {money(o.total_amount)}</strong></div>
            <div className="flex flex-wrap gap-2">
              {o.status==="pending"&&<button className="refresh-btn" disabled={busy} onClick={()=>void run(()=>api(`/api/commerce/orders/${o.order_id}`,{method:"PATCH",body:JSON.stringify({status:"cancelled"})}),"Pending order cancelled.")}>Cancel order</button>}
              {canManage&&o.status==="pending"&&<button className="primary-btn" disabled={busy||o.items.length===0} onClick={()=>void run(()=>api("/api/commerce/payments",{method:"POST",body:JSON.stringify({orderId:o.order_id,method:paymentMethod})}),"Payment recorded. Order marked paid and stock deducted atomically.")}>Mark paid / record payment</button>}
              {canManage&&o.status==="paid"&&o.payment&&<button className="refresh-btn" disabled={busy} onClick={()=>void run(()=>api(`/api/commerce/payments/${o.payment!.payment_id}`,{method:"PATCH",body:JSON.stringify({status:"refunded"})}),"Demo refund recorded; consumed stock was not restocked.")}>Refund (demo)</button>}
            </div>
          </div>
          {o.payment&&<small className="mt-3 block text-emerald-300">Payment {o.payment.status} · {money(o.payment.amount)} · {o.payment.method}{o.payment.provider_reference?` · ${o.payment.provider_reference}`:""}</small>}
          {o.inventory_deducted_at&&<small className="mt-1 block text-slate-500">Inventory deducted {dateTime(o.inventory_deducted_at)}</small>}
        </article>)}{data.orders.length===0&&<div className="empty">No orders yet.</div>}</div>
      </div>}
    </section>
  </main>;
}
