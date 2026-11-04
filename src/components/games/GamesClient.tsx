"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SignOutButton from "@/components/sign-out-button";

type Role = "admin" | "staff" | "customer";

export interface GameItem {
  game_id: number;
  title: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  is_active: boolean;
  embedding_model: string | null;
  embedding_updated_at: string | null;
  has_embedding: boolean;
}

export interface CategoryItem {
  category_id: number;
  category_name: string;
}

export interface SearchResultItem extends GameItem {
  cosine_distance: number;
  similarity_score: number;
}

export interface TournamentItem {
  tournament_id: number;
  name: string;
  game_id: number;
  game_title: string;
  category_name: string | null;
  prize_pool: string;
  start_date: string;
  status: "draft" | "open" | "closed" | "completed" | "cancelled";
  max_participants: number | null;
  registration_deadline: string | null;
  description: string | null;
  registered_count: number;
  is_registered: boolean;
}

export interface ParticipantItem {
  tournament_id: number;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  registration_date: string;
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
const dateStr = (v: string) => new Date(v).toLocaleDateString();

export default function GamesClient({
  role,
  customerId,
}: {
  role: Role;
  customerId: number | null;
}) {
  const isAdmin = role === "admin";
  const isStaff = role === "staff";
  const isCustomer = role === "customer";
  const canManageTournaments = isAdmin || isStaff;

  const [activeSubTab, setActiveSubTab] = useState<"search" | "catalogue" | "tournaments">("search");

  // Catalogue state
  const [games, setGames] = useState<GameItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [showAllGames, setShowAllGames] = useState(false);

  // Search state
  const [searchPrompt, setSearchPrompt] = useState("");
  const [searchLimit, setSearchLimit] = useState(6);
  const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Tournament state
  const [tournaments, setTournaments] = useState<TournamentItem[]>([]);
  const [activeRoster, setActiveRoster] = useState<{
    tournamentName: string;
    participants: ParticipantItem[];
  } | null>(null);

  // Forms & operations state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [newGameForm, setNewGameForm] = useState({ title: "", categoryId: "", description: "" });
  const [newTournForm, setNewTournForm] = useState({
    name: "",
    gameId: "",
    prizePool: "5000",
    startDate: "",
    maxParticipants: "16",
    registrationDeadline: "",
    status: "open",
    description: "",
  });

  const loadData = useCallback(async () => {
    try {
      const gamesUrl = showAllGames && isAdmin ? "/api/games?all=true" : "/api/games";
      const [gRes, tRes] = await Promise.all([
        api<{ games: GameItem[]; categories: CategoryItem[] }>(gamesUrl),
        api<TournamentItem[]>("/api/tournaments"),
      ]);
      setGames(gRes.games);
      setCategories(gRes.categories);
      setTournaments(tRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games data.");
    }
  }, [showAllGames, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const gamesUrl = showAllGames && isAdmin ? "/api/games?all=true" : "/api/games";
        const [gRes, tRes] = await Promise.all([
          api<{ games: GameItem[]; categories: CategoryItem[] }>(gamesUrl),
          api<TournamentItem[]>("/api/tournaments"),
        ]);
        if (!cancelled) {
          setGames(gRes.games);
          setCategories(gRes.categories);
          setTournaments(tRes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load games data.");
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [showAllGames, isAdmin]);

  async function runAction(action: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await loadData();
      setNotice(successMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  // Handle semantic vector search
  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!searchPrompt.trim()) return;

    setSearching(true);
    setError("");
    try {
      const res = await api<{ results: SearchResultItem[] }>("/api/search/games", {
        method: "POST",
        body: JSON.stringify({ query: searchPrompt.trim(), limit: searchLimit }),
      });
      setSearchResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  // Create game (admin)
  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/games", {
        method: "POST",
        body: JSON.stringify({
          title: newGameForm.title,
          categoryId: newGameForm.categoryId ? Number(newGameForm.categoryId) : null,
          description: newGameForm.description,
        }),
      });
      setNewGameForm({ title: "", categoryId: "", description: "" });
    }, "Game added successfully with 384-dimensional vector embedding!");
  }

  // Toggle game active archive
  async function handleToggleArchive(game: GameItem) {
    await runAction(async () => {
      await api(`/api/games/${game.game_id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !game.is_active }),
      });
    }, `Game ${game.is_active ? "archived" : "restored"} successfully.`);
  }

  // Tournament registration
  async function handleRegister(tournamentId: number) {
    await runAction(async () => {
      await api(`/api/tournaments/${tournamentId}/registrations`, {
        method: "POST",
        body: JSON.stringify(isCustomer ? {} : { customerId }),
      });
    }, "Successfully registered for tournament!");
  }

  // Tournament cancellation
  async function handleCancelRegistration(tournamentId: number) {
    await runAction(async () => {
      await api(`/api/tournaments/${tournamentId}/registrations`, {
        method: "DELETE",
      });
    }, "Registration cancelled.");
  }

  // View participant roster (staff/admin)
  async function handleViewRoster(tournament: TournamentItem) {
    setError("");
    try {
      const roster = await api<ParticipantItem[]>(`/api/tournaments/${tournament.tournament_id}/registrations`);
      setActiveRoster({ tournamentName: tournament.name, participants: roster });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roster.");
    }
  }

  // Create tournament (staff/admin)
  async function handleCreateTournament(e: React.FormEvent) {
    e.preventDefault();
    await runAction(async () => {
      await api("/api/tournaments", {
        method: "POST",
        body: JSON.stringify({
          name: newTournForm.name,
          gameId: Number(newTournForm.gameId),
          prizePool: Number(newTournForm.prizePool),
          startDate: newTournForm.startDate,
          maxParticipants: newTournForm.maxParticipants ? Number(newTournForm.maxParticipants) : null,
          registrationDeadline: newTournForm.registrationDeadline
            ? new Date(newTournForm.registrationDeadline).toISOString()
            : null,
          status: newTournForm.status,
          description: newTournForm.description,
        }),
      });
      setNewTournForm({
        name: "",
        gameId: "",
        prizePool: "5000",
        startDate: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
        maxParticipants: "16",
        registrationDeadline: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 16),
        status: "open",
        description: "",
      });
    }, "Tournament scheduled successfully!");
  }

  const filteredGames = games.filter((g) => {
    if (selectedCategory && String(g.category_id) !== selectedCategory) return false;
    return true;
  });

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
        <Link className="nav-item active" href="/games">
          <span>🎮</span>Games & Search
        </Link>
        {!isCustomer && (
          <Link className="nav-item" href="/insights">
            <span>📊</span>Insights
          </Link>
        )}
        <div className="sidebar-bottom">
          <span className="live-dot" /> SYSTEM ONLINE
          <small>Role: {role.toUpperCase()}</small>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">GAME DISCOVERY & COMPETITIVE</span>
            <h1>Games, pgvector Search & Tournaments</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="refresh-btn" onClick={() => void loadData()} disabled={busy}>
              ↻ Refresh
            </button>
            <SignOutButton />
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="content">
          {/* Sub-navigation tabs */}
          <div className="flex gap-2 border-b border-[#263241] pb-3 mb-6">
            <button
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeSubTab === "search"
                  ? "bg-[#202b35] text-[#a3e635] border border-[#a3e635]/40"
                  : "bg-transparent text-[#8b98a9] hover:text-white"
              }`}
              onClick={() => setActiveSubTab("search")}
            >
              🔍 AI Semantic Search (pgvector)
            </button>
            <button
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeSubTab === "catalogue"
                  ? "bg-[#202b35] text-[#a3e635] border border-[#a3e635]/40"
                  : "bg-transparent text-[#8b98a9] hover:text-white"
              }`}
              onClick={() => setActiveSubTab("catalogue")}
            >
              📚 Game Catalogue ({games.length})
            </button>
            <button
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeSubTab === "tournaments"
                  ? "bg-[#202b35] text-[#a3e635] border border-[#a3e635]/40"
                  : "bg-transparent text-[#8b98a9] hover:text-white"
              }`}
              onClick={() => setActiveSubTab("tournaments")}
            >
              🏆 Tournaments & Events ({tournaments.length})
            </button>
          </div>

          {/* =============================================================== */}
          {/* TAB 1: AI SEMANTIC SEARCH                                       */}
          {/* =============================================================== */}
          {activeSubTab === "search" && (
            <div>
              <div className="welcome">
                <div>
                  <span className="eyebrow">NATURAL LANGUAGE VECTOR RETRIEVAL</span>
                  <h2>Semantic Game Discovery</h2>
                  <p>
                    Powered by PostgreSQL <code>pgvector</code> using 384-dimensional dense embeddings
                    generated with <code>Xenova/all-MiniLM-L6-v2</code> and HNSW cosine distance indexing.
                  </p>
                </div>
                <div className="welcome-icon">🧠</div>
              </div>

              {/* Search Prompt Form */}
              <form onSubmit={handleSearch} className="panel mb-6">
                <div className="flex flex-col gap-3">
                  <label className="text-xs font-bold text-[#8b98a9] tracking-wider uppercase">
                    Enter Natural Language Game Description
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      className="flex-1 bg-[#0e141c] border border-[#263241] rounded-lg px-4 py-3 text-sm text-white placeholder-[#8b98a9]"
                      placeholder="e.g. tactical squad shooter with fast movement and abilities"
                      value={searchPrompt}
                      onChange={(e) => setSearchPrompt(e.target.value)}
                    />
                    <select
                      className="bg-[#0e141c] border border-[#263241] rounded-lg px-3 py-2 text-xs text-white"
                      value={searchLimit}
                      onChange={(e) => setSearchLimit(Number(e.target.value))}
                    >
                      <option value={3}>Top 3</option>
                      <option value={6}>Top 6</option>
                      <option value={10}>Top 10</option>
                    </select>
                    <button
                      type="submit"
                      disabled={searching || searchPrompt.trim().length < 2}
                      className="primary-btn px-6"
                    >
                      {searching ? "Inference..." : "Search pgvector"}
                    </button>
                  </div>

                  {/* Sample Query Pills */}
                  <div className="flex flex-wrap gap-2 pt-2 items-center">
                    <span className="text-[11px] text-[#8b98a9]">Try prompt:</span>
                    {[
                      "open world fantasy rpg with deep magic and sword combat",
                      "high speed competitive racing simulator",
                      "dungeon crawler roguelike with intense combat",
                      "battle royale with tactical gunplay",
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        className="text-[11px] px-2.5 py-1 rounded bg-[#171f2a] border border-[#263241] text-[#aab5c3] hover:text-[#a3e635] hover:border-[#a3e635]/40 transition-colors"
                        onClick={() => {
                          setSearchPrompt(sample);
                        }}
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              </form>

              {/* Search Results Display */}
              {searchResults && (
                <div>
                  <div className="section-heading">
                    <h2>Ranked Cosine Similarity Matches ({searchResults.length})</h2>
                    <span className="text-xs text-[#8b98a9]">
                      Metric: pgvector <code>&lt;=&gt;</code> Cosine Distance (Lower distance = higher match)
                    </span>
                  </div>

                  {searchResults.length === 0 ? (
                    <div className="panel text-center py-10 text-[#8b98a9]">
                      No matching games found with active vector embeddings. Make sure games have been backfilled.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {searchResults.map((item, idx) => (
                        <div key={item.game_id} className="panel flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-xs font-black text-[#a3e635] tracking-wider">
                                #{idx + 1} MATCH
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#202b35] text-[#70a7ff]">
                                {item.category_name || "General"}
                              </span>
                            </div>
                            <h3 className="text-base font-bold text-white mb-1">{item.title}</h3>
                            <p className="text-xs text-[#8b98a9] mb-4 line-clamp-3">
                              {item.description || "No description provided."}
                            </p>
                          </div>

                          <div className="border-t border-[#263241] pt-3 flex justify-between items-center text-xs">
                            <div>
                              <span className="text-[#8b98a9] text-[10px] block">Similarity Score</span>
                              <strong className="text-[#a3e635] text-sm">
                                {(item.similarity_score * 100).toFixed(1)}%
                              </strong>
                            </div>
                            <div className="text-right">
                              <span className="text-[#8b98a9] text-[10px] block">Cosine Distance</span>
                              <span className="font-mono text-white text-xs">{item.cosine_distance}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 2: GAME CATALOGUE                                           */}
          {/* =============================================================== */}
          {activeSubTab === "catalogue" && (
            <div>
              {/* Admin Create Game Panel */}
              {isAdmin && (
                <div className="panel mb-8">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold tracking-wider text-[#a3e635] uppercase">
                      + Add New Game with Automatic 384-d Embedding
                    </h3>
                    <span className="text-xs text-[#8b98a9]">Admin Action</span>
                  </div>
                  <form onSubmit={handleCreateGame} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      type="text"
                      placeholder="Game Title *"
                      required
                      className="bg-[#0e141c] border border-[#263241] rounded px-3 py-2 text-xs text-white"
                      value={newGameForm.title}
                      onChange={(e) => setNewGameForm({ ...newGameForm, title: e.target.value })}
                    />
                    <select
                      className="bg-[#0e141c] border border-[#263241] rounded px-3 py-2 text-xs text-white"
                      value={newGameForm.categoryId}
                      onChange={(e) => setNewGameForm({ ...newGameForm, categoryId: e.target.value })}
                    >
                      <option value="">Select Category...</option>
                      {categories.map((c) => (
                        <option key={c.category_id} value={c.category_id}>
                          {c.category_name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={busy} className="primary-btn">
                      {busy ? "Saving & Embedding..." : "Create & Generate Vector"}
                    </button>
                    <textarea
                      placeholder="Game Description (Used for generating semantic vectors) *"
                      rows={2}
                      className="col-span-1 md:col-span-3 bg-[#0e141c] border border-[#263241] rounded px-3 py-2 text-xs text-white"
                      value={newGameForm.description}
                      onChange={(e) => setNewGameForm({ ...newGameForm, description: e.target.value })}
                    />
                  </form>
                </div>
              )}

              {/* Filter Tools */}
              <div className="table-tools">
                <div className="flex items-center gap-3">
                  <select
                    className="bg-[#0e141c] border border-[#263241] rounded px-3 py-2 text-xs text-white"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    <option value="">All Categories ({categories.length})</option>
                    {categories.map((c) => (
                      <option key={c.category_id} value={c.category_id}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>

                  {isAdmin && (
                    <label className="flex items-center gap-1.5 text-xs text-[#8b98a9] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showAllGames}
                        onChange={(e) => setShowAllGames(e.target.checked)}
                      />
                      Include Archived Games
                    </label>
                  )}
                </div>
                <span className="text-xs text-[#8b98a9]">Showing {filteredGames.length} games</span>
              </div>

              {/* Games Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredGames.map((game) => (
                  <div key={game.game_id} className="game-card flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span className="game-symbol">🎮</span>
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#171f2a] text-[#70a7ff]">
                            {game.category_name || "General"}
                          </span>
                          {!game.is_active && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#3a2024] text-[#f29ba4]">
                              Archived
                            </span>
                          )}
                        </div>
                      </div>
                      <strong className="text-white text-sm">{game.title}</strong>
                      <p className="text-xs text-[#8b98a9] mt-2 line-clamp-3">
                        {game.description || "No description provided."}
                      </p>
                    </div>

                    <div className="border-t border-[#263241] pt-3 mt-3 flex justify-between items-center text-[10px]">
                      <span className={game.has_embedding ? "text-[#a3e635]" : "text-[#f5bd75]"}>
                        {game.has_embedding ? "● 384d Vector Active" : "○ Embedding Pending"}
                      </span>
                      {isAdmin && (
                        <button
                          type="button"
                          className="text-[11px] text-[#70a7ff] hover:underline"
                          onClick={() => void handleToggleArchive(game)}
                          disabled={busy}
                        >
                          {game.is_active ? "Archive" : "Restore"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 3: TOURNAMENTS & REGISTRATION                               */}
          {/* =============================================================== */}
          {activeSubTab === "tournaments" && (
            <div>
              {/* Admin/Staff Create Tournament */}
              {canManageTournaments && (
                <div className="panel mb-8">
                  <h3 className="text-sm font-bold tracking-wider text-[#a3e635] uppercase mb-4">
                    + Schedule New Tournament
                  </h3>
                  <form onSubmit={handleCreateTournament} className="form-grid">
                    <input
                      type="text"
                      placeholder="Tournament Title *"
                      required
                      value={newTournForm.name}
                      onChange={(e) => setNewTournForm({ ...newTournForm, name: e.target.value })}
                    />
                    <select
                      required
                      value={newTournForm.gameId}
                      onChange={(e) => setNewTournForm({ ...newTournForm, gameId: e.target.value })}
                    >
                      <option value="">Select Featured Game *</option>
                      {games.map((g) => (
                        <option key={g.game_id} value={g.game_id}>
                          {g.title} ({g.category_name})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="Prize Pool (₹)"
                      min="0"
                      value={newTournForm.prizePool}
                      onChange={(e) => setNewTournForm({ ...newTournForm, prizePool: e.target.value })}
                    />
                    <input
                      type="date"
                      placeholder="Start Date"
                      required
                      value={newTournForm.startDate}
                      onChange={(e) => setNewTournForm({ ...newTournForm, startDate: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="Max Participants (Capacity)"
                      min="2"
                      value={newTournForm.maxParticipants}
                      onChange={(e) => setNewTournForm({ ...newTournForm, maxParticipants: e.target.value })}
                    />
                    <input
                      type="datetime-local"
                      placeholder="Registration Deadline"
                      value={newTournForm.registrationDeadline}
                      onChange={(e) => setNewTournForm({ ...newTournForm, registrationDeadline: e.target.value })}
                    />
                    <button type="submit" disabled={busy} className="primary-btn col-span-1 md:col-span-3">
                      {busy ? "Scheduling..." : "Schedule Tournament"}
                    </button>
                  </form>
                </div>
              )}

              {/* Tournament List Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tournaments.map((t) => {
                  const isFull = t.max_participants !== null && t.registered_count >= t.max_participants;
                  const deadlinePassed =
                    t.registration_deadline && new Date() > new Date(t.registration_deadline);
                  const canRegister =
                    t.status === "open" && !t.is_registered && !isFull && !deadlinePassed;

                  return (
                    <div key={t.tournament_id} className="panel flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <span className={`status-pill ${t.status}`}>{t.status}</span>
                          <span className="text-xs font-mono font-bold text-[#a3e635]">
                            Prize: {money(t.prize_pool)}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-white mb-1">{t.name}</h3>
                        <div className="text-xs text-[#70a7ff] font-semibold mb-3">
                          Game: {t.game_title} {t.category_name && `(${t.category_name})`}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-[#8b98a9] bg-[#0e141c] p-3 rounded-lg mb-4">
                          <div>
                            <span className="block text-[10px] uppercase">Start Date</span>
                            <strong className="text-white">{dateStr(t.start_date)}</strong>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase">Slots Filled</span>
                            <strong className="text-white">
                              {t.registered_count} / {t.max_participants ?? "∞"}
                            </strong>
                          </div>
                          {t.registration_deadline && (
                            <div className="col-span-2 text-[10px] border-t border-[#263241] pt-1 mt-1">
                              Registration Closes: {new Date(t.registration_deadline).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="border-t border-[#263241] pt-3 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          {t.is_registered ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-[#a3e635]">✓ Registered</span>
                              {!deadlinePassed && (
                                <button
                                  type="button"
                                  className="text-xs text-[#f29ba4] hover:underline"
                                  onClick={() => void handleCancelRegistration(t.tournament_id)}
                                  disabled={busy}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          ) : canRegister ? (
                            <button
                              type="button"
                              className="primary-btn text-xs py-1.5 px-3"
                              onClick={() => void handleRegister(t.tournament_id)}
                              disabled={busy}
                            >
                              Register Now
                            </button>
                          ) : (
                            <span className="text-xs text-[#8b98a9]">
                              {isFull ? "Registration Full" : deadlinePassed ? "Deadline Passed" : "Closed"}
                            </span>
                          )}
                        </div>

                        {canManageTournaments && (
                          <button
                            type="button"
                            className="text-btn text-xs"
                            onClick={() => void handleViewRoster(t)}
                          >
                            View Roster ({t.registered_count})
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Roster Modal */}
              {activeRoster && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <div className="panel max-w-lg w-full max-h-[80vh] flex flex-col">
                    <div className="flex justify-between items-center pb-3 border-b border-[#263241] mb-3">
                      <h3 className="font-bold text-white text-sm">
                        Participants: {activeRoster.tournamentName}
                      </h3>
                      <button
                        className="text-btn"
                        onClick={() => setActiveRoster(null)}
                      >
                        ✕ Close
                      </button>
                    </div>
                    <div className="table-wrap flex-1 overflow-auto">
                      <table>
                        <thead>
                          <tr>
                            <th>Player Name</th>
                            <th>Email</th>
                            <th>Registration Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeRoster.participants.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="empty">
                                No registered participants yet.
                              </td>
                            </tr>
                          ) : (
                            activeRoster.participants.map((p) => (
                              <tr key={p.customer_id}>
                                <td className="font-semibold text-white">{p.customer_name}</td>
                                <td>{p.customer_email}</td>
                                <td>{new Date(p.registration_date).toLocaleString()}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
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
