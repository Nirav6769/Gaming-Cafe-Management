"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SignOutButton from "@/components/sign-out-button";

type Role = "admin" | "staff" | "customer";

interface PopularGameItem {
  game_id: number;
  title: string;
  category_name: string | null;
  is_active: boolean;
  play_count: number;
  total_recorded_minutes: number;
}

interface CategorySummaryItem {
  category_name: string;
  games_count: number;
  total_plays: number;
  total_minutes: number;
}

interface PCUsageItem {
  pc_id: number;
  pc_name: string;
  status: string;
  hourly_rate: string;
  completed_sessions_count: number;
  total_used_minutes: number;
  total_session_revenue?: string;
}

interface DailyRevenueItem {
  revenue_date: string;
  source: "session" | "snack_order" | "membership";
  total_amount: string;
  transaction_count: string;
}

interface OverviewData {
  role: Role;
  pcs: { total: number; available: number; occupied: number; maintenance: number };
  sessions: { active: number; completed: number; totalObservedHours: number };
  games: { activeCount: number; topGame: string; topGamePlays: number };
  revenue?: { today: string; currentMonth: string };
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

const money = (v: string | number) => "₹" + Number(v || 0).toFixed(2);

export default function InsightsClient({ role }: { role: Role }) {
  const isAdmin = role === "admin";

  const [activeTab, setActiveTab] = useState<"games" | "pcs" | "revenue">("games");

  // Overview KPIs
  const [overview, setOverview] = useState<OverviewData | null>(null);

  // Popular games state
  const [popularGames, setPopularGames] = useState<PopularGameItem[]>([]);
  const [categorySummary, setCategorySummary] = useState<CategorySummaryItem[]>([]);

  // PC usage state
  const [pcUsage, setPcUsage] = useState<PCUsageItem[]>([]);
  const [pcUsageSummary, setPcUsageSummary] = useState<{
    totalPCs: number;
    totalObservedMinutes: number;
    totalObservedHours: number;
    totalCompletedSessions: number;
  } | null>(null);

  // Revenue state (Admin only)
  const [revenueData, setRevenueData] = useState<{
    dailyRevenue: DailyRevenueItem[];
    sourceBreakdown: { session: number; snack_order: number; membership: number };
    grandTotal: string;
    range: { startDate: string; endDate: string; days: number };
  } | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchOverview = useCallback(async () => {
    try {
      const data = await api<OverviewData>("/api/analytics/overview");
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview.");
    }
  }, []);

  const fetchPopularGames = useCallback(async () => {
    try {
      const data = await api<{
        popularGames: PopularGameItem[];
        categorySummary: CategorySummaryItem[];
      }>("/api/analytics/popular-games");
      setPopularGames(data.popularGames);
      setCategorySummary(data.categorySummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load game analytics.");
    }
  }, []);

  const fetchPCUsage = useCallback(async () => {
    try {
      const data = await api<{
        pcUsage: PCUsageItem[];
        summary: {
          totalPCs: number;
          totalObservedMinutes: number;
          totalObservedHours: number;
          totalCompletedSessions: number;
        };
      }>("/api/analytics/pc-usage");
      setPcUsage(data.pcUsage);
      setPcUsageSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PC usage.");
    }
  }, []);

  const fetchRevenue = useCallback(async (start?: string, end?: string) => {
    if (!isAdmin) return;
    try {
      const params = new URLSearchParams();
      if (start) params.set("startDate", start);
      if (end) params.set("endDate", end);
      const url = `/api/analytics/revenue${params.toString() ? `?${params.toString()}` : ""}`;
      const data = await api<{
        dailyRevenue: DailyRevenueItem[];
        sourceBreakdown: { session: number; snack_order: number; membership: number };
        grandTotal: string;
        range: { startDate: string; endDate: string; days: number };
      }>(url);
      setRevenueData(data);
      if (!start) setStartDate(data.range.startDate);
      if (!end) setEndDate(data.range.endDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revenue.");
    }
  }, [isAdmin]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    await Promise.all([
      fetchOverview(),
      fetchPopularGames(),
      fetchPCUsage(),
      isAdmin ? fetchRevenue(startDate, endDate) : Promise.resolve(),
    ]);
    setLoading(false);
  }, [fetchOverview, fetchPopularGames, fetchPCUsage, fetchRevenue, isAdmin, startDate, endDate]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [ov, pg, pc] = await Promise.all([
          api<OverviewData>("/api/analytics/overview"),
          api<{ popularGames: PopularGameItem[]; categorySummary: CategorySummaryItem[] }>(
            "/api/analytics/popular-games"
          ),
          api<{
            pcUsage: PCUsageItem[];
            summary: {
              totalPCs: number;
              totalObservedMinutes: number;
              totalObservedHours: number;
              totalCompletedSessions: number;
            };
          }>("/api/analytics/pc-usage"),
        ]);

        if (!cancelled) {
          setOverview(ov);
          setPopularGames(pg.popularGames);
          setCategorySummary(pg.categorySummary);
          setPcUsage(pc.pcUsage);
          setPcUsageSummary(pc.summary);
        }

        if (isAdmin) {
          const rev = await api<{
            dailyRevenue: DailyRevenueItem[];
            sourceBreakdown: { session: number; snack_order: number; membership: number };
            grandTotal: string;
            range: { startDate: string; endDate: string; days: number };
          }>("/api/analytics/revenue");

          if (!cancelled) {
            setRevenueData(rev);
            setStartDate(rev.range.startDate);
            setEndDate(rev.range.endDate);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to initialize analytics.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  function handleApplyDateFilter(e: React.FormEvent) {
    e.preventDefault();
    void fetchRevenue(startDate, endDate);
  }

  return (
    <main className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">GC</div>
          <div>
            <strong>GAMEHUB</strong>
            <small>CAFE MANAGEMENT</small>
          </div>
        </div>
        <div className="side-label">WORKSPACES</div>
        <Link className="nav-item" href="/dashboard">
          <span>▦</span>Overview
        </Link>
        <Link className="nav-item" href="/operations">
          <span>⚙</span>Operations
        </Link>
        <Link className="nav-item" href="/commerce">
          <span>₹</span>Commerce
        </Link>
        <Link className="nav-item" href="/games">
          <span>🎮</span>Games & Search
        </Link>
        <Link className="nav-item active" href="/insights">
          <span>📊</span>Insights
        </Link>
        <div className="sidebar-bottom">
          <span className="live-dot" /> SYSTEM ONLINE
          <small>Role: {role.toUpperCase()}</small>
        </div>
      </aside>

      {/* Main Area */}
      <section className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">ANALYTICS & REPORTING WORKSPACE</span>
            <h1>Management Insights & SQL Views</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="refresh-btn" onClick={() => void refreshAll()} disabled={loading}>
              ↻ Refresh All
            </button>
            <SignOutButton />
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}

        <div className="content">
          {/* Welcome / Header Card */}
          <div className="welcome">
            <div>
              <span className="eyebrow">POSTGRESQL AGGREGATES & VIEWS</span>
              <h2>Cafe Performance Intelligence</h2>
              <p>
                Real-time operational metrics generated through secure <code>security_invoker</code> views:
                <code>vw_popular_games</code>, <code>vw_pc_usage_summary</code>, and <code>vw_daily_revenue</code>.
              </p>
            </div>
            <div className="welcome-icon">📈</div>
          </div>

          {/* Top KPI Stat Cards */}
          {overview && (
            <div className="stats-grid mb-8">
              <div className="stat-card">
                <div className="stat-top">
                  <span>ACTIVE GAMES</span>
                  <b>🎮</b>
                </div>
                <strong>{overview.games.activeCount}</strong>
                <small>Top: {overview.games.topGame} ({overview.games.topGamePlays} plays)</small>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>GAMING SESSIONS</span>
                  <b>◷</b>
                </div>
                <strong>{overview.sessions.completed}</strong>
                <small>{overview.sessions.active} active now</small>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>TOTAL OBSERVED PLAYTIME</span>
                  <b>⏱</b>
                </div>
                <strong>{overview.sessions.totalObservedHours} hrs</strong>
                <small>Logged across gaming stations</small>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>TODAY&apos;S REVENUE</span>
                  <b>₹</b>
                </div>
                <strong>
                  {isAdmin ? money(overview.revenue?.today ?? 0) : "Staff Mode"}
                </strong>
                <small>
                  {isAdmin ? `Month: ${money(overview.revenue?.currentMonth ?? 0)}` : "Financials Admin-Only"}
                </small>
              </div>
            </div>
          )}

          {/* Sub-tab Navigation */}
          <div className="flex gap-2 border-b border-[#263241] pb-3 mb-6">
            <button
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "games"
                  ? "bg-[#202b35] text-[#a3e635] border border-[#a3e635]/40"
                  : "bg-transparent text-[#8b98a9] hover:text-white"
              }`}
              onClick={() => setActiveTab("games")}
            >
              🎮 Popular Games & Categories
            </button>
            <button
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "pcs"
                  ? "bg-[#202b35] text-[#a3e635] border border-[#a3e635]/40"
                  : "bg-transparent text-[#8b98a9] hover:text-white"
              }`}
              onClick={() => setActiveTab("pcs")}
            >
              🖥 Hardware & PC Usage
            </button>
            <button
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "revenue"
                  ? "bg-[#202b35] text-[#a3e635] border border-[#a3e635]/40"
                  : "bg-transparent text-[#8b98a9] hover:text-white"
              }`}
              onClick={() => setActiveTab("revenue")}
            >
              💰 Daily Revenue & Sources {isAdmin ? "" : "(Admin Only)"}
            </button>
          </div>

          {/* =============================================================== */}
          {/* TAB 1: POPULAR GAMES                                            */}
          {/* =============================================================== */}
          {activeTab === "games" && (
            <div>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">VIEW: vw_popular_games</span>
                  <h2>Most Played Games</h2>
                </div>
                <span className="text-xs text-[#8b98a9]">
                  Play counts recorded via session_games
                </span>
              </div>

              {/* Popular Games Table */}
              <div className="table-wrap mb-8">
                <table>
                  <thead>
                    <tr>
                      <th>RANK</th>
                      <th>GAME TITLE</th>
                      <th>CATEGORY</th>
                      <th>STATUS</th>
                      <th>TOTAL PLAYS</th>
                      <th>RECORDED MINUTES</th>
                      <th>AVG DURATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {popularGames.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty">
                          No games played yet. Start sessions and record games to generate popularity metrics.
                        </td>
                      </tr>
                    ) : (
                      popularGames.map((game, idx) => {
                        const plays = Number(game.play_count);
                        const mins = Number(game.total_recorded_minutes);
                        const avg = plays > 0 ? (mins / plays).toFixed(0) : "0";

                        return (
                          <tr key={game.game_id}>
                            <td className="font-bold text-[#a3e635]">#{idx + 1}</td>
                            <td className="font-semibold text-white">{game.title}</td>
                            <td>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#171f2a] text-[#70a7ff]">
                                {game.category_name || "Uncategorised"}
                              </span>
                            </td>
                            <td>
                              <span className={`status-pill ${game.is_active ? "available" : "maintenance"}`}>
                                {game.is_active ? "Active" : "Archived"}
                              </span>
                            </td>
                            <td className="font-bold text-white">{plays}</td>
                            <td>{mins} mins</td>
                            <td className="text-[#8b98a9]">{avg} mins / play</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Category Breakdown */}
              <div className="section-heading">
                <div>
                  <span className="eyebrow">AGGREGATE: GROUP BY category_name</span>
                  <h2>Playtime by Genre & Category</h2>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {categorySummary.map((cat) => (
                  <div key={cat.category_name} className="stat-card">
                    <div className="stat-top">
                      <span>{cat.category_name.toUpperCase()}</span>
                      <b>📁</b>
                    </div>
                    <strong>{cat.total_plays} plays</strong>
                    <small>
                      {cat.games_count} titles · {cat.total_minutes} total mins
                    </small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 2: PC USAGE                                                 */}
          {/* =============================================================== */}
          {activeTab === "pcs" && (
            <div>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">VIEW: vw_pc_usage_summary</span>
                  <h2>Gaming Station Observed Utilization</h2>
                </div>
                <span className="text-xs text-[#8b98a9]">
                  {isAdmin ? "Full Operational & Revenue Breakdown" : "Staff View: Financials Masked"}
                </span>
              </div>

              <div className="table-wrap mb-4">
                <table>
                  <thead>
                    <tr>
                      <th>PC NAME</th>
                      <th>CURRENT STATUS</th>
                      <th>HOURLY RATE</th>
                      <th>COMPLETED SESSIONS</th>
                      <th>TOTAL OBSERVED PLAYTIME</th>
                      {isAdmin && <th>TOTAL REVENUE GENERATED</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pcUsage.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 6 : 5} className="empty">
                          No hardware stations found.
                        </td>
                      </tr>
                    ) : (
                      pcUsage.map((pc) => (
                        <tr key={pc.pc_id}>
                          <td className="font-semibold text-white">{pc.pc_name}</td>
                          <td>
                            <span className={`status-pill ${pc.status}`}>{pc.status}</span>
                          </td>
                          <td>{money(pc.hourly_rate)} / hr</td>
                          <td className="font-bold text-white">{pc.completed_sessions_count}</td>
                          <td>
                            {pc.total_used_minutes} mins ({(pc.total_used_minutes / 60).toFixed(1)} hrs)
                          </td>
                          {isAdmin && (
                            <td className="font-mono font-bold text-[#a3e635]">
                              {money(pc.total_session_revenue ?? 0)}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {pcUsageSummary && (
                <div className="p-4 rounded-lg bg-[#0e141c] border border-[#263241] flex flex-wrap justify-between items-center text-xs text-[#8b98a9]">
                  <div>
                    <strong>Summary:</strong> {pcUsageSummary.totalCompletedSessions} total sessions completed across{" "}
                    {pcUsageSummary.totalPCs} stations ({pcUsageSummary.totalObservedHours} total hours).
                  </div>
                  <div className="text-[11px] text-[#70a7ff]">
                    ⚠️ Note: Observed metrics reflect recorded session durations, not an opening-hours percentage.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 3: DAILY REVENUE (ADMIN ONLY)                               */}
          {/* =============================================================== */}
          {activeTab === "revenue" && (
            <div>
              {!isAdmin ? (
                <div className="panel text-center py-12">
                  <div className="text-4xl mb-3">🔒</div>
                  <h3 className="text-base font-bold text-white mb-2">Access Restricted</h3>
                  <p className="text-xs text-[#8b98a9] max-w-md mx-auto">
                    Daily revenue breakdown, payment accounting, and membership financial figures are strictly
                    accessible to Administrator accounts. Staff accounts can view operational usage and popular game
                    metrics.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">VIEW: vw_daily_revenue</span>
                      <h2>Unified Financial Accounting</h2>
                    </div>
                    <span className="text-xs text-[#8b98a9]">
                      Combines gaming sessions, snack orders, and memberships (no double counting)
                    </span>
                  </div>

                  {/* Date Filter Form */}
                  <form onSubmit={handleApplyDateFilter} className="panel mb-6 flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[#8b98a9]">Start Date:</label>
                      <input
                        type="date"
                        className="bg-[#0e141c] border border-[#263241] rounded px-3 py-1.5 text-xs text-white"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-[#8b98a9]">End Date:</label>
                      <input
                        type="date"
                        className="bg-[#0e141c] border border-[#263241] rounded px-3 py-1.5 text-xs text-white"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="primary-btn text-xs py-1.5 px-4" disabled={loading}>
                      Apply Filter
                    </button>
                  </form>

                  {/* Revenue Source Cards */}
                  {revenueData && (
                    <div className="stats-grid mb-8">
                      <div className="stat-card">
                        <div className="stat-top">
                          <span>SESSION PLAYTIME</span>
                          <b>◷</b>
                        </div>
                        <strong>{money(revenueData.sourceBreakdown.session)}</strong>
                        <small>Completed gaming sessions</small>
                      </div>

                      <div className="stat-card">
                        <div className="stat-top">
                          <span>SNACK ORDERS</span>
                          <b>🍿</b>
                        </div>
                        <strong>{money(revenueData.sourceBreakdown.snack_order)}</strong>
                        <small>Paid cafe snack orders</small>
                      </div>

                      <div className="stat-card">
                        <div className="stat-top">
                          <span>MEMBERSHIPS</span>
                          <b>👑</b>
                        </div>
                        <strong>{money(revenueData.sourceBreakdown.membership)}</strong>
                        <small>Customer tier subscriptions</small>
                      </div>

                      <div className="stat-card border-[#a3e635]/40 bg-[#16221c]">
                        <div className="stat-top">
                          <span className="text-[#a3e635]">GRAND TOTAL REVENUE</span>
                          <b className="text-[#a3e635]">₹</b>
                        </div>
                        <strong className="text-[#a3e635]">{money(revenueData.grandTotal)}</strong>
                        <small>Across selected {revenueData.range.days} days</small>
                      </div>
                    </div>
                  )}

                  {/* Daily Table */}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>REVENUE DATE (UTC)</th>
                          <th>REVENUE SOURCE</th>
                          <th>TRANSACTION COUNT</th>
                          <th>TOTAL AMOUNT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!revenueData || revenueData.dailyRevenue.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="empty">
                              No revenue recorded for selected date range.
                            </td>
                          </tr>
                        ) : (
                          revenueData.dailyRevenue.map((row, idx) => {
                            const badgeColor =
                              row.source === "session"
                                ? "bg-[#202b35] text-[#70a7ff]"
                                : row.source === "snack_order"
                                ? "bg-[#382d20] text-[#f5bd75]"
                                : "bg-[#243324] text-[#b7ed77]";

                            return (
                              <tr key={`${row.revenue_date}-${row.source}-${idx}`}>
                                <td className="font-semibold text-white">{row.revenue_date}</td>
                                <td>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeColor}`}>
                                    {row.source.toUpperCase().replace("_", " ")}
                                  </span>
                                </td>
                                <td>{row.transaction_count} transaction(s)</td>
                                <td className="font-mono font-bold text-white">{money(row.total_amount)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
