"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Role = "admin" | "staff" | "customer";
type Plan = {
  plan_id: number; name: string; description: string | null;
  duration_days: number; price: string; discount_percent: string; is_active: boolean;
};
type Snack = {
  snack_id: number; name: string; description: string | null;
  unit_price: string; stock_quantity: number; is_active: boolean;
};
type Membership = {
  membership_id: number; customer_id: number; customer_name: string;
  plan_id: number; plan_name: string; discount_percent: string;
  starts_at: string; ends_at: string; status: string; price_paid: string;
};
type OrderItem = {
  order_item_id: number; snack_id: number; name: string;
  quantity: number; unit_price: string; line_total: string;
};
type Payment = {
  payment_id: number; amount: string; payment_method: string;
  payment_status: string; transaction_reference: string; created_at: string;
};
type Order = {
  order_id: number; customer_id: number; customer_name: string;
  status: string; subtotal: string; discount_percent: string;
  discount_amount: string; total_amount: string; notes: string | null;
  created_at: string; placed_at: string | null; fulfilled_at: string | null;
  items: OrderItem[]; latest_payment: Payment | null;
};
type Customer = { customer_id: number; name: string; email: string };
type Overview = {
  role: Role; customerId: number | null;
  plans: Plan[]; snacks: Snack[]; memberships: Membership[]; orders: Order[];
  customers: Customer[];
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
const money = (value: string | number) => "₹" + Number(value || 0).toFixed(2);
const date = (value: string) => new Date(value).toLocaleDateString();

export default function CommerceClient({
  role,
  customerId,
}: {
  role: Role;
  customerId: number | null;
}) {
  const isCustomer = role === "customer";
  const isAdmin = role === "admin";
  const canManage = !isCustomer;

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targetCustomerId, setTargetCustomerId] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [orderNotes, setOrderNotes] = useState("");
  const [snackForm, setSnackForm] = useState({ name: "", description: "", unitPrice: "", stockQuantity: "" });
  const [planForm, setPlanForm] = useState({ name: "", description: "", durationDays: "30", price: "", discountPercent: "5" });

  const refresh = useCallback(async () => {
    const result = await api<Overview>("/api/commerce");
    setData(result);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api<Overview>("/api/commerce");
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load commerce data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    const items = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([snackId, quantity]) => ({ snackId: Number(snackId), quantity }));
    if (items.length === 0) {
      setError("Choose at least one snack and quantity.");
      return;
    }
    await run(async () => {
      await api("/api/commerce/orders", {
        method: "POST",
        body: JSON.stringify({
          ...(canManage ? { customerId: Number(targetCustomerId) } : {}),
          items,
          notes: orderNotes,
        }),
      });
      setQuantities({});
      setOrderNotes("");
    }, "Draft order created. Review it and place the order to deduct stock.");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">GC</div>
          <div><strong>GAMEHUB</strong><small>CAFE MANAGEMENT</small></div>
        </div>
        <div className="side-label">WORKSPACE</div>
        {canManage && <Link className="nav-item" href="/dashboard"><span>▦</span>Dashboard</Link>}
        <Link className="nav-item active" href="/commerce"><span>₹</span>Commerce</Link>
        {canManage && <Link className="nav-item" href="/operations"><span>⚙</span>Operations</Link>}
        <div className="sidebar-bottom">
          <span className="live-dot" /> SYSTEM ONLINE
          <small>{role.toUpperCase()} ACCOUNT</small>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div><span className="eyebrow">MEMBERSHIPS · SNACKS · ORDERS</span><h1>Commerce</h1></div>
          <button className="refresh-btn" disabled={busy} onClick={() => run(refresh, "Commerce data refreshed.")}>↻ Refresh</button>
        </header>

        {error && <div className="alert error" role="alert">{error}</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}
        {loading ? <div className="loading">Loading memberships and orders…</div> : data && (
          <div className="content">
            <div className="welcome">
              <div>
                <span className="eyebrow">COMMERCE DESK</span>
                <h2>{isCustomer ? "Your memberships and snack orders." : "Memberships, inventory and sales."}</h2>
                <p>{isCustomer ? "Browse plans, order snacks and track your purchases." : "Manage customer memberships, snack stock and order fulfilment."}</p>
              </div>
              <div className="welcome-icon">₹</div>
            </div>

            {canManage && (
              <div className="panel mt-3 grid gap-3 p-4">
                <label htmlFor="commerce-customer">Customer for membership and staff orders</label>
                <select
                  id="commerce-customer"
                  required
                  value={targetCustomerId}
                  onChange={(event) => setTargetCustomerId(event.target.value)}
                >
                  <option value="">Choose customer</option>
                  {data.customers.map((customer) => (
                    <option key={customer.customer_id} value={customer.customer_id}>
                      {customer.name} · {customer.email} · #{customer.customer_id}
                    </option>
                  ))}
                </select>
                <small className="muted">Select the customer before assigning a membership or creating an order.</small>
              </div>
            )}

            <div className="section-heading">
              <div><span className="eyebrow">MEMBERSHIP PLANS</span><h2>Available plans</h2></div>
              <span className="muted">{data.plans.filter((plan) => plan.is_active).length} active plans</span>
            </div>

            {canManage && isAdmin && (
              <form className="panel form-grid" onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api("/api/commerce/plans", {
                    method: "POST",
                    body: JSON.stringify({
                      name: planForm.name,
                      description: planForm.description,
                      durationDays: Number(planForm.durationDays),
                      price: Number(planForm.price),
                      discountPercent: Number(planForm.discountPercent),
                    }),
                  });
                  setPlanForm({ name: "", description: "", durationDays: "30", price: "", discountPercent: "5" });
                }, "Membership plan created.");
              }}>
                <h3>Create a membership plan (admin)</h3>
                <input required maxLength={80} placeholder="Plan name" value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} />
                <input placeholder="Description" value={planForm.description} onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })} />
                <input required type="number" min="1" max="3650" placeholder="Duration (days)" value={planForm.durationDays} onChange={(event) => setPlanForm({ ...planForm, durationDays: event.target.value })} />
                <input required type="number" min="0" step="0.01" placeholder="Price (₹)" value={planForm.price} onChange={(event) => setPlanForm({ ...planForm, price: event.target.value })} />
                <input required type="number" min="0" max="100" step="0.1" placeholder="Discount (%)" value={planForm.discountPercent} onChange={(event) => setPlanForm({ ...planForm, discountPercent: event.target.value })} />
                <button className="primary-btn" disabled={busy}>Create plan</button>
              </form>
            )}

            <div className="pc-grid">
              {data.plans.map((plan) => (
                <article className="pc-tile" key={plan.plan_id}>
                  <div className="pc-tile-top">
                    <span className="pc-icon">✦</span>
                    <span className={plan.is_active ? "status-pill available" : "status-pill maintenance"}>{plan.is_active ? "Active" : "Inactive"}</span>
                  </div>
                  <strong>{plan.name}</strong>
                  <small>{plan.description || "Gaming café membership"}</small>
                  <small>{plan.duration_days} days · {money(plan.price)}</small>
                  <small>{Number(plan.discount_percent)}% snack discount</small>
                  {plan.is_active && <button className="primary-btn mt-3" disabled={busy || (canManage && !targetCustomerId)} onClick={() => {
                    void run(() => api("/api/commerce/memberships", {
                      method: "POST",
                      body: JSON.stringify({
                        planId: plan.plan_id,
                        ...(canManage ? { customerId: Number(targetCustomerId) } : {}),
                      }),
                    }), "Membership activated for the selected customer.");
                  }}>{isCustomer ? "Activate membership (demo)" : "Assign membership"}</button>}
                </article>
              ))}
            </div>

            <div className="section-heading">
              <div><span className="eyebrow">SNACK COUNTER</span><h2>Snacks and inventory</h2></div>
            </div>
            {canManage && (
              <form className="panel form-grid" onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api("/api/commerce/snacks", {
                    method: "POST",
                    body: JSON.stringify({
                      name: snackForm.name,
                      description: snackForm.description,
                      unitPrice: Number(snackForm.unitPrice),
                      stockQuantity: Number(snackForm.stockQuantity),
                    }),
                  });
                  setSnackForm({ name: "", description: "", unitPrice: "", stockQuantity: "" });
                }, "Snack added to inventory.");
              }}>
                <h3>Add snack / update stock</h3>
                <input required maxLength={100} placeholder="Snack name" value={snackForm.name} onChange={(event) => setSnackForm({ ...snackForm, name: event.target.value })} />
                <input placeholder="Description" value={snackForm.description} onChange={(event) => setSnackForm({ ...snackForm, description: event.target.value })} />
                <input required type="number" min="0" step="0.01" placeholder="Price (₹)" value={snackForm.unitPrice} onChange={(event) => setSnackForm({ ...snackForm, unitPrice: event.target.value })} />
                <input required type="number" min="0" step="1" placeholder="Opening stock" value={snackForm.stockQuantity} onChange={(event) => setSnackForm({ ...snackForm, stockQuantity: event.target.value })} />
                <button className="primary-btn" disabled={busy}>Add snack</button>
              </form>
            )}

            <div className="table-wrap">
              <table>
                <thead><tr><th>SNACK</th><th>PRICE</th><th>STOCK</th><th>STATUS</th>{canManage && <th>QUICK UPDATE</th>}</tr></thead>
                <tbody>
                  {data.snacks.map((snack) => (
                    <tr key={snack.snack_id}>
                      <td>{snack.name}<small className="block text-slate-500">{snack.description}</small></td>
                      <td>{money(snack.unit_price)}</td>
                      <td>{snack.stock_quantity}</td>
                      <td><span className={snack.is_active ? "status-pill available" : "status-pill maintenance"}>{snack.is_active ? "Active" : "Inactive"}</span></td>
                      {canManage && <td>
                        <button className="text-btn" disabled={busy} onClick={() => {
                          const next = window.prompt("New stock quantity", String(snack.stock_quantity));
                          if (next === null) return;
                          const value = Number(next);
                          if (!Number.isInteger(value) || value < 0) {
                            setError("Stock quantity must be a non-negative whole number.");
                            return;
                          }
                          void run(() => api("/api/commerce/snacks", {
                            method: "PATCH",
                            body: JSON.stringify({ snackId: snack.snack_id, stockQuantity: value }),
                          }), "Stock quantity updated.");
                        }}>Update stock</button>
                      </td>}
                    </tr>
                  ))}
                  {data.snacks.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="empty">No snacks have been added yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="section-heading">
              <div><span className="eyebrow">NEW ORDER</span><h2>Create a snack order</h2></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ITEM</th><th>UNIT PRICE</th><th>AVAILABLE</th><th>QUANTITY</th></tr></thead>
                <tbody>
                  {data.snacks.filter((snack) => snack.is_active).map((snack) => (
                    <tr key={snack.snack_id}>
                      <td>{snack.name}</td>
                      <td>{money(snack.unit_price)}</td>
                      <td>{snack.stock_quantity}</td>
                      <td>
                        <input
                          aria-label={`Quantity of ${snack.name}`}
                          className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          type="number" min="0" max="999"
                          value={quantities[snack.snack_id] ?? 0}
                          onChange={(event) => setQuantities({ ...quantities, [snack.snack_id]: Math.max(0, Number(event.target.value)) })}
                        />
                      </td>
                    </tr>
                  ))}
                  {data.snacks.filter((snack) => snack.is_active).length === 0 && <tr><td colSpan={4} className="empty">No active snacks are available.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel mt-3 grid gap-3 p-4">
              <input maxLength={500} placeholder="Order note (optional)" value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} />
              <button className="primary-btn w-fit" disabled={busy || (canManage && !targetCustomerId)} onClick={() => void createOrder()}>Create draft order</button>
              <small className="muted">Prices and membership discounts are calculated and snapshotted by PostgreSQL. Stock is deducted only when the order is placed.</small>
            </div>

            <div className="section-heading">
              <div><span className="eyebrow">CUSTOMER MEMBERSHIPS</span><h2>{isCustomer ? "Your memberships" : "Membership register"}</h2></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr>{canManage && <th>CUSTOMER</th>}<th>PLAN</th><th>DISCOUNT</th><th>STARTS</th><th>ENDS</th><th>STATUS</th><th>PAID</th></tr></thead>
                <tbody>
                  {data.memberships.map((membership) => (
                    <tr key={membership.membership_id}>
                      {canManage && <td>{membership.customer_name} <small className="text-slate-500">#{membership.customer_id}</small></td>}
                      <td>{membership.plan_name}</td><td>{Number(membership.discount_percent)}%</td>
                      <td>{date(membership.starts_at)}</td><td>{date(membership.ends_at)}</td>
                      <td><span className={membership.status === "active" ? "status-pill available" : "status-pill maintenance"}>{membership.status}</span></td>
                      <td>{money(membership.price_paid)}</td>
                    </tr>
                  ))}
                  {data.memberships.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="empty">No memberships found.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="section-heading">
              <div><span className="eyebrow">ORDER HISTORY</span><h2>{isCustomer ? "Your orders" : "All customer orders"}</h2></div>
            </div>
            <div className="grid gap-3">
              {data.orders.map((order) => (
                <article className="panel" key={order.order_id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>Order #{order.order_id}</strong>
                      {canManage && <small className="ml-2 text-slate-400">{order.customer_name} · customer #{order.customer_id}</small>}
                      <small className="mt-1 block text-slate-500">{new Date(order.created_at).toLocaleString()}</small>
                    </div>
                    <span className={order.status === "placed" || order.status === "fulfilled" ? "status-pill available" : order.status === "draft" ? "status-pill occupied" : "status-pill maintenance"}>{order.status}</span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {order.items.map((item) => (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 py-2 text-sm" key={item.order_item_id}>
                        <span>{item.name} × {item.quantity}</span>
                        <span>{money(item.line_total)}</span>
                        {order.status === "draft" && <button className="text-btn" disabled={busy} onClick={() => {
                          void run(() => api(`/api/commerce/orders/${order.order_id}/items/${item.order_item_id}`, { method: "DELETE" }), "Draft order item removed.");
                        }}>Remove</button>}
                      </div>
                    ))}
                    {order.items.length === 0 && <small className="muted">No items. This draft cannot be placed.</small>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      <span className="text-slate-400">Subtotal {money(order.subtotal)}</span>
                      <span className="ml-3 text-slate-400">Member discount {Number(order.discount_percent)}% (−{money(order.discount_amount)})</span>
                      <strong className="ml-3">Total {money(order.total_amount)}</strong>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {order.status === "draft" && (
                        <button className="primary-btn" disabled={busy || order.items.length === 0} onClick={() => {
                          void run(() => api(`/api/commerce/orders/${order.order_id}`, {
                            method: "PATCH", body: JSON.stringify({ status: "placed" }),
                          }), "Order placed. Inventory was deducted.");
                        }}>Place order</button>
                      )}
                      {order.status === "draft" && <button className="refresh-btn" disabled={busy} onClick={() => {
                        void run(() => api(`/api/commerce/orders/${order.order_id}`, {
                          method: "PATCH", body: JSON.stringify({ status: "cancelled" }),
                        }), "Draft order cancelled.");
                      }}>Cancel draft</button>}
                      {order.status === "placed" && !order.latest_payment && (
                        <button className="primary-btn" disabled={busy} onClick={() => {
                          void run(() => api(`/api/commerce/orders/${order.order_id}/pay`, {
                            method: "POST", body: JSON.stringify({ paymentMethod: "demo" }),
                          }), "Demo payment recorded. No external payment was processed.");
                        }}>Record demo payment</button>
                      )}
                      {canManage && order.status === "placed" && (
                        <button className="refresh-btn" disabled={busy} onClick={() => {
                          void run(() => api(`/api/commerce/orders/${order.order_id}`, {
                            method: "PATCH", body: JSON.stringify({ status: "fulfilled" }),
                          }), "Order marked fulfilled.");
                        }}>Mark fulfilled</button>
                      )}
                    </div>
                  </div>
                  {order.latest_payment && (
                    <small className="mt-3 block text-emerald-300">
                      Payment {order.latest_payment.payment_status} · {money(order.latest_payment.amount)} · {order.latest_payment.payment_method} · {order.latest_payment.transaction_reference}
                    </small>
                  )}
                </article>
              ))}
              {data.orders.length === 0 && <div className="empty">No orders yet.</div>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
