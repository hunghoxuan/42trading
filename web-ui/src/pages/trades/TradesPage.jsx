import { api } from "../../api";
import { NotificationHub } from "../../services/NotificationHub";
import { useState, useMemo, useRef, useEffect, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRealtimeData } from "../../hooks/useRealtimeData";

const SignalDetailCard = lazy(
  () => import("../../components/SignalDetailCard"),
);
import {
  PositionAuditCell,
  StatusPnlCell,
  SymbolEntryCell,
} from "../../components/TradeSignalListCells";
import { buildDetailHeader } from "../../components/SignalDetailHeaderBuilder";
import {
  asNum,
  buildHeaderMeta,
  buildRrVolRiskText,
  renderHistoryItem,
  extractTradePlanFromTrade,
  applyLinkedPlanChange,
} from "../../utils/signalDetailUtils";

const STATUS_OPTIONS = [
  { value: "", label: "ALL STATUSES" },
  { value: "PENDING", label: "PENDING" },
  { value: "FILLED", label: "FILLED" },
  { value: "CLOSED", label: "CLOSED" },
  { value: "CANCELLED", label: "CANCELLED" },
  { value: "ERROR", label: "ERROR" },
];
const BULK_ACTIONS = [
  { value: "", label: "BULK ACTION..." },
  { value: "close_all", label: "Close All" },
  { value: "cancel_all", label: "Cancel All" },
  { value: "delete_all", label: "Delete All" },
];
const RANGE_OPTIONS = [
  { value: "all", label: "All times" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_week", label: "Last week" },
  { value: "last_month", label: "Last month" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];
const PAGE_SIZE_OPTIONS = [50, 100, 200];

import { showDateTime } from "../../utils/format";

function fDateTime(v) {
  return showDateTime(v);
}

function formatTimeframe(min) {
  if (!min || min === "manual") return min || "-";
  const n = Number(min);
  if (Number.isNaN(n) || n <= 0) return String(min);
  if (n < 60) return `${n}m`;
  if (n < 1440) return `${n / 60}h`;
  if (n < 10080) return `${n / 1440}d`;
  if (n < 43200) return `${n / 10080}W`;
  if (n === 43200) return "1M";
  return `${n / 43200}M`;
}

function statusUi(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  if (s === "FILLED") return { cls: "ACTIVE", label: "FILLED" };
  if (s === "OPEN") return { cls: "ACTIVE", label: "FILLED" };
  if (s === "CLOSED" || s === "CANCELLED") return { cls: "INACTIVE", label: s };
  if (s === "ERROR") return { cls: "FAIL", label: s };
  return { cls: "OTHER", label: s || "PENDING" };
}

function calcRr(t) {
  const entry = asNum(t?.entry);
  const sl = asNum(t?.sl);
  // Use highest TP from partials if available, else trade.tp
  const raw = t?.raw_json && typeof t.raw_json === "object" ? t.raw_json : {};
  const plan = raw?.trade_plan || raw?.tradePlan || {};
  const partials = Array.isArray(plan?.partial_tps) ? plan.partial_tps : [];
  let tp = asNum(t?.tp);
  if (partials.length > 0) {
    let highestPartial = tp;
    for (const p of partials) {
      const pPrice = p && typeof p === "object" ? asNum(p.price) : null;
      if (
        pPrice != null &&
        (highestPartial == null || pPrice > highestPartial)
      ) {
        highestPartial = pPrice;
      }
    }
    if (highestPartial != null) tp = highestPartial;
  }
  if (entry == null || sl == null || tp == null) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (!risk) return null;
  return Number((reward / risk).toFixed(2));
}

function brokerNameFromAccount(a) {
  if (!a || typeof a !== "object") return "-";
  const m = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
  return String(m.broker_name || m.broker || m.platform || "-");
}

function brokerTicketOf(t) {
  return String(t?.broker_trade_id || t?.ticket || "").trim() || "-";
}

function tradeKeyOf(t) {
  // Prefer sid (UUID) for URLs, fall back to id for backward compat
  const sid = String(t?.sid || "").trim();
  if (sid) return sid;
  const idNum = Number(t?.id);
  if (Number.isInteger(idNum) && idNum > 0) return String(idNum);
  return "";
}

function auditTimestampRaw(t) {
  return t?.updated_at || t?.created_at || t?.closed_at || t?.opened_at || null;
}

function rangeBounds(range) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  switch (String(range || "all")) {
    case "today":
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: null };
    case "yesterday":
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { from: start.toISOString(), to: end.toISOString() };
    case "week":
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: null };
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: null };
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: null };
    case "last_week":
      start.setDate(start.getDate() - 7);
      return { from: start.toISOString(), to: null };
    case "last_month":
      start.setMonth(start.getMonth() - 1);
      return { from: start.toISOString(), to: null };
    default:
      return { from: null, to: null };
  }
}

function moneyRiskReward(t) {
  const st = String(t?.execution_status || "").toUpperCase();
  if (!["PENDING", "OPEN", "FILLED", "OPEN", "CLOSED"].includes(st))
    return { risk: null, reward: null };
  const m = t?.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const risk =
    asNum(m.risk_money_actual) ??
    asNum(m.risk_money) ??
    asNum(m.risk_money_planned);
  const rewardDirect = asNum(m.reward_money_planned);
  const rr = asNum(m.rr) ?? asNum(t?.rr_planned) ?? calcRr(t);
  if (risk == null || rr == null) return { risk: null, reward: null };
  return { risk, reward: rewardDirect ?? risk * rr };
}

function tradeRiskSize(t) {
  const st = String(t?.execution_status || "").toUpperCase();
  if (!["PENDING", "OPEN", "FILLED", "CLOSED"].includes(st)) return null;
  const m = t?.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const direct =
    asNum(m.risk_money_actual) ??
    asNum(m.risk_money) ??
    asNum(m.risk_money_planned);
  if (direct != null) return direct;
  const entry = asNum(t?.entry);
  const sl = asNum(t?.sl);
  const vol = asNum(m?.used_volume ?? t?.volume);
  if (entry == null || sl == null || vol == null) return null;
  const est = Math.abs(entry - sl) * vol;
  return Number.isFinite(est) ? est : null;
}

function compactStrategy(item = {}) {
  const raw =
    item?.raw_json && typeof item.raw_json === "object" ? item.raw_json : {};
  const fromRaw = String(
    item.strategy || raw?.strategy || raw?.trade_plan?.strategy || "",
  ).trim();
  return fromRaw || "-";
}

function displaySource(item = {}) {
  const src = String(item?.source || "")
    .trim()
    .toLowerCase();
  if (src.startsWith("ai_")) return src;
  if (src === "ai") return "ai_claude";
  if (src) return src;
  const srcId = String(item?.source_id || "")
    .trim()
    .toLowerCase();
  return srcId || "-";
}

export default function TradesPage() {
  const navigate = useNavigate();
  const { tradeId } = useParams();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [sources, setSources] = useState([]);
  const [changedFields, setChangedFields] = useState(() => new Map()); // sid -> Set<fieldName>
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [tradeEvents, setTradeEvents] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkAction, setBulkAction] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [createMode, setCreateMode] = useState(false);
  const [listMode, setListMode] = useState("compact"); // "compact" | "full"
  const [createMsg, setCreateMsg] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState({ type: "", text: "" });
  const [editForm, setEditForm] = useState({
    execution_status: "PENDING",
    pnl_realized: "0",
  });
  const [detailTfTab, setDetailTfTab] = useState("ENTRY");
  const [detailPlan, setDetailPlan] = useState({
    direction: "BUY",
    trade_type: "limit",
    entry: "",
    tp: "",
    sl: "",
    rr: "",
    risk_pct: 0.01,
    risk_money: "",
    note: "",
  });

  function PnlDisplay({ value }) {
    const n = asNum(value);
    if (n == null) return <span className="minor-text">-</span>;
    const cls = n < 0 ? "money-neg" : "money-pos";
    return (
      <span className={cls} style={{ fontWeight: 800 }}>
        ${n.toFixed(2)}
      </span>
    );
  }
  const DEFAULT_CREATE_FORM = {
    action: "BUY",
    symbol: "",
    volume: "0.01",
    risk_pct: "0.01",
    risk_money: "",
    price: "",
    sl: "",
    tp: "",
    strategy: "Manual",
    timeframe: "manual",
    note: "",
  };
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const isCreateFormDirty = useMemo(() => {
    return JSON.stringify(createForm) !== JSON.stringify(DEFAULT_CREATE_FORM);
  }, [createForm]);

  const [filter, setFilter] = useState({
    q: "",
    account_id: "",
    source_id: "",
    symbol: "",
    side: "",
    entry_model: "",
    chart_tf: "",
    execution_status: "FILLED",
    range: "all",
    page: 1,
    pageSize: 50,
  });

  const query = useMemo(() => ({ ...filter }), [filter]);
  const [sortKey, setSortKey] = useState("audit");
  const [sortDir, setSortDir] = useState("desc");
  const inFlightRef = useRef(false);
  const tradeEventsInFlightRef = useRef(false);
  const selectedTradeIdRef = useRef("");

  const accountById = useMemo(() => {
    const map = new Map();
    (accounts || []).forEach((a) => map.set(String(a.account_id || ""), a));
    return map;
  }, [accounts]);

  const uniqueOptions = useMemo(() => {
    const symbols = new Set();
    const models = new Set();
    const tfs = new Set();
    (rows || []).forEach((r) => {
      if (r.symbol) symbols.add(r.symbol);
      if (r.entry_model) models.add(r.entry_model);
      if (r.chart_tf) tfs.add(r.chart_tf);
    });
    return {
      symbols: Array.from(symbols).sort(),
      models: Array.from(models).sort(),
      tfs: Array.from(tfs).sort(),
    };
  }, [rows]);

  async function loadMeta() {
    try {
      const [accs, srcs] = await Promise.all([
        api.v2Accounts(),
        api.v2Sources(),
      ]);
      setAccounts(accs?.items || []);
      setSources(srcs?.items || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadTrades() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setLoading(true);
      const queryApi = { ...query };
      const b = rangeBounds(queryApi.range);
      queryApi.created_from = b.from || "";
      queryApi.created_to = b.to || "";
      if (String(queryApi.execution_status || "").toUpperCase() === "FILLED") {
        queryApi.execution_status = "OPEN";
      }
      const data = await api.v2Trades(queryApi);
      const itemsRaw = data.items || [];
      const statusOrder = (x) => {
        const s = String(x?.execution_status || "").toUpperCase();
        if (s === "OPEN" || s === "FILLED") return 0;
        if (s === "PENDING") return 1;
        if (s === "CLOSED" || s === "CANCELLED") return 2;
        return 3;
      };
      const items = [...itemsRaw].sort((a, b) => {
        const sa = statusOrder(a);
        const sb = statusOrder(b);
        if (sa !== sb) return sa - sb;
        return (
          new Date(b?.created_at || 0).getTime() -
          new Date(a?.created_at || 0).getTime()
        );
      });
      setRows(items);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setError("");
      if (selectedTradeIdRef.current) {
        const updated = (data.items || []).find(
          (r) => tradeKeyOf(r) === selectedTradeIdRef.current,
        );
        if (updated) {
          setSelectedTrade(updated);
        }
      } else if (items.length > 0) {
        setSelectedTrade(items[0]);
        selectedTradeIdRef.current = tradeKeyOf(items[0]);
      }
    } catch (e) {
      setError(e?.message || "Failed to load trades");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }

  async function loadTradeEvents(tradeRef) {
    if (!tradeRef) {
      setTradeEvents([]);
      return;
    }
    if (tradeEventsInFlightRef.current) return;
    tradeEventsInFlightRef.current = true;
    try {
      const out = await api.v2TradeEvents(tradeRef, 100);
      let items = Array.isArray(out?.items) ? out.items : [];
      if (items.length === 0) {
        const row = rows.find((r) => tradeKeyOf(r) === String(tradeRef));
        const signalId = String(row?.sid || "").trim();
        if (signalId) {
          const legacy = await api.trade(signalId);
          const evs = Array.isArray(legacy?.events) ? legacy.events : [];
          items = evs.map((e, i) => ({
            log_id: e.id || i,
            created_at: e.event_time || e.created_at || null,
            metadata: e.payload_json || e.metadata || {},
            object_table: "signals",
          }));
        }
      }
      setTradeEvents(items);
    } catch {
      setTradeEvents([]);
    } finally {
      tradeEventsInFlightRef.current = false;
    }
  }

  async function onBulkApply() {
    if (!bulkAction) return;
    if (bulkAction === "delete_all") {
      const targetCount = selectedIds.size > 0 ? selectedIds.size : rows.length;
      const ok = window.confirm(
        `Delete ${targetCount} trade(s)? This cannot be undone.`,
      );
      if (!ok) return;
    }
    try {
      setBulkBusy(true);
      const filters = { ...query };
      const b = rangeBounds(filters.range);
      filters.created_from = b.from || "";
      filters.created_to = b.to || "";
      if (selectedIds.size > 0) {
        filters.sids = Array.from(selectedIds);
      }
      await api.v2TradesBulkAction(bulkAction, filters);
      setSelectedIds(new Set());
      await loadTrades();
    } catch (e) {
      setError(e?.message || "Bulk action failed");
    } finally {
      setBulkBusy(false);
      setBulkAction("");
    }
  }

  async function onCreateTrade() {
    try {
      setBulkBusy(true);
      const payload = {
        side: String(createForm.action || "BUY").toUpperCase(),
        symbol: String(createForm.symbol || "")
          .trim()
          .toUpperCase(),
        volume:
          createForm.volume === "" ? undefined : Number(createForm.volume),
        risk_pct:
          createForm.risk_pct === "" ? undefined : Number(createForm.risk_pct),
        risk_money:
          createForm.risk_money === ""
            ? undefined
            : Number(createForm.risk_money),
        price: createForm.price === "" ? undefined : Number(createForm.price),
        sl: createForm.sl === "" ? undefined : Number(createForm.sl),
        tp: createForm.tp === "" ? undefined : Number(createForm.tp),
        strategy: String(createForm.strategy || "Manual").trim(),
        timeframe: String(createForm.timeframe || "manual").trim(),
        note: String(createForm.note || "").trim(),
      };
      const { promise: tradePromise } = NotificationHub.track(
        "create_trade",
        { symbol: payload.symbol },
        () => api.createTrade(payload),
      );
      await tradePromise;
      setCreateMsg("Trade created");
      setCreateMode(false);
      await loadTrades();
      setTimeout(() => setCreateMsg(""), 1800);
    } catch (e) {
      setError(e?.message || "Create trade failed");
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    loadMeta();
  }, []);

  // Realtime data patch from SSE (generic page_id="trades")
  // Detects per-field changes and triggers subtle .value-flash on each changed value.
  useRealtimeData("trades", (data) => {
    if (!Array.isArray(data) || !data.length) return;
    const updateMap = new Map(data.map((u) => [String(u.sid || "").trim(), u]));
    const diffBySid = new Map(); // sid -> Set of changed field names
    setRows((prev) => {
      diffBySid.clear();
      if (!prev.some((r) => updateMap.has(String(r.sid || "").trim())))
        return prev;
      return prev.map((r) => {
        const key = String(r.sid || "").trim();
        const update = updateMap.get(key);
        if (!update) return r;
        // Detect which fields actually changed
        const changed = new Set();
        for (const [field, newVal] of Object.entries(update)) {
          if (field === "sid" || field === "symbol") continue;
          if (JSON.stringify(r[field]) !== JSON.stringify(newVal)) {
            changed.add(field);
          }
        }
        if (changed.size > 0) diffBySid.set(key, changed);
        return { ...r, ...update };
      });
    });
    // Flash changed values briefly
    if (diffBySid.size > 0) {
      setChangedFields((prev) => {
        const next = new Map(prev);
        for (const [sid, fields] of diffBySid) {
          const existing = next.get(sid) || new Set();
          for (const f of fields) existing.add(f);
          next.set(sid, existing);
        }
        return next;
      });
      setTimeout(() => {
        setChangedFields((prev) => {
          const next = new Map(prev);
          for (const [sid, fields] of diffBySid) {
            const existing = next.get(sid);
            if (existing) {
              for (const f of fields) existing.delete(f);
              if (!existing.size) next.delete(sid);
            }
          }
          return next;
        });
      }, 800);
    }
  });

  // Select trade from URL param on load
  useEffect(() => {
    if (tradeId && rows.length > 0) {
      const found = rows.find(
        (r) => tradeKeyOf(r) === tradeId || String(r.id) === String(tradeId),
      );
      if (found) {
        setSelectedTrade(found);
        selectedTradeIdRef.current = tradeId;
      } else {
        // Trade not in filtered list — try direct lookup (e.g. PENDING trade with FILLED filter)
        api
          .v2Trades({ q: tradeId })
          .then((data) => {
            const t =
              Array.isArray(data?.items) && data.items.length
                ? data.items[0]
                : null;
            if (t) {
              setSelectedTrade(t);
              selectedTradeIdRef.current = tradeId;
            }
          })
          .catch(() => {});
      }
    }
  }, [tradeId, rows.length]);

  useEffect(() => {
    loadTrades();
  }, [query]);
  useEffect(() => {
    selectedTradeIdRef.current = tradeKeyOf(selectedTrade);
  }, [selectedTrade?.id, selectedTrade?.sid]);
  useEffect(() => {
    const ref = tradeKeyOf(selectedTrade);
    if (ref) {
      loadTradeEvents(ref);
      setDetailPlan(extractTradePlanFromTrade(selectedTrade));
    } else {
      setTradeEvents([]);
      setDetailPlan({
        direction: "BUY",
        trade_type: "limit",
        entry: "",
        tp: "",
        sl: "",
        rr: "",
        note: "",
      });
    }
  }, [selectedTrade?.id, selectedTrade?.sid]);
  useEffect(() => {
    if (!selectedTrade) {
      setEditForm({ execution_status: "PENDING", pnl_realized: "0" });
      setEditModalOpen(false);
      setEditMsg({ type: "", text: "" });
      return;
    }
    const st = String(
      selectedTrade.execution_status || "PENDING",
    ).toUpperCase();
    const pnlRaw = Number(selectedTrade.pnl_realized);
    setEditForm({
      execution_status: st,
      pnl_realized:
        st === "PENDING"
          ? "0"
          : Number.isFinite(pnlRaw)
            ? String(Number(pnlRaw.toFixed(2)))
            : "",
    });
    setEditModalOpen(false);
    setEditMsg({ type: "", text: "" });
  }, [selectedTrade?.id, selectedTrade?.sid]);

  async function onUpdateTradePlan() {
    if (!selectedTrade) return;
    const ref = tradeKeyOf(selectedTrade);
    if (!ref) return;
    try {
      setEditBusy(true);
      const payload = {
        side: detailPlan.direction,
        order_type: detailPlan.trade_type,
        price: asNum(detailPlan.entry),
        tp: asNum(detailPlan.tp),
        sl: asNum(detailPlan.sl),
        rr: asNum(detailPlan.rr),
        note: detailPlan.note,
        confidence_pct: asNum(detailPlan.confidence_pct),
        invalidation: detailPlan.invalidation,
        estimated_bars: asNum(detailPlan.estimated_bars),
        profile: detailPlan.profile,
        exit_condition: detailPlan.exit_condition,
        entry_condition: detailPlan.entry_condition,
        risk_management: detailPlan.risk_management,
        skip_recommendation: detailPlan.skip_recommendation,
        confluence_checklist: detailPlan.confluence_checklist,
        be_trigger: asNum(detailPlan.be_trigger),
        risk_pct: asNum(detailPlan.risk_pct),
        risk_money: asNum(detailPlan.risk_money),
      };
      await api.saveTradePlan(ref, payload);
      await loadTrades();
      await loadTradeEvents(ref);
    } catch (e) {
      setError(e?.message || "Failed to update trade plan");
    } finally {
      setEditBusy(false);
    }
  }

  async function onReEntryTrade() {
    if (!selectedTrade) return;
    const ref = tradeKeyOf(selectedTrade);
    if (!ref) return;
    try {
      setEditBusy(true);
      const payload = {
        side: detailPlan.direction,
        order_type: detailPlan.trade_type,
        price: asNum(detailPlan.entry),
        tp: asNum(detailPlan.tp),
        sl: asNum(detailPlan.sl),
        rr: asNum(detailPlan.rr),
        note: detailPlan.note,
        confidence_pct: asNum(detailPlan.confidence_pct),
        invalidation: detailPlan.invalidation,
        estimated_bars: asNum(detailPlan.estimated_bars),
        profile: detailPlan.profile,
        exit_condition: detailPlan.exit_condition,
        entry_condition: detailPlan.entry_condition,
        risk_management: detailPlan.risk_management,
        skip_recommendation: detailPlan.skip_recommendation,
        confluence_checklist: detailPlan.confluence_checklist,
        be_trigger: asNum(detailPlan.be_trigger),
        symbol: selectedTrade.symbol,
        volume: asNum(selectedTrade.volume),
      };
      await api.createTradeDirect(payload);
      await loadTrades();
    } catch (e) {
      setError(e?.message || "Failed to create re-entry trade");
    } finally {
      setEditBusy(false);
    }
  }

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(tradeKeyOf(r)));
  const sortedRows = useMemo(() => {
    const statusRankAsc = (v) => {
      const s = String(v || "").toUpperCase();
      if (s === "OPEN" || s === "FILLED") return 0;
      if (s === "PENDING") return 1;
      if (s === "CLOSED" || s === "CANCELLED") return 2;
      return 3;
    };
    const statusRankDesc = (v) => {
      const s = String(v || "").toUpperCase();
      if (s === "PENDING") return 0;
      if (s === "OPEN" || s === "FILLED") return 1;
      if (s === "CLOSED" || s === "CANCELLED") return 2;
      return 3;
    };
    const valueOfAudit = (x) => new Date(auditTimestampRaw(x) || 0).getTime();
    const out = [...rows];
    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "symbol") {
        cmp = String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "strategy") {
        cmp = compactStrategy(a).localeCompare(compactStrategy(b));
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "pnl") {
        const pa =
          asNum(a?.broker_pnl) ??
          asNum(a?.pnl_realized) ??
          asNum(a?.net_pnl) ??
          0;
        const pb =
          asNum(b?.broker_pnl) ??
          asNum(b?.pnl_realized) ??
          asNum(b?.net_pnl) ??
          0;
        cmp = pa - pb;
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "status") {
        cmp =
          sortDir === "asc"
            ? statusRankAsc(a?.execution_status) -
              statusRankAsc(b?.execution_status)
            : statusRankDesc(a?.execution_status) -
              statusRankDesc(b?.execution_status);
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return cmp;
      }
      cmp = valueOfAudit(a) - valueOfAudit(b);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "status" ? "asc" : "desc");
  };
  const sortMarker = (key) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  async function onSaveTradeEdit() {
    const selectedRef = tradeKeyOf(selectedTrade);
    if (!selectedRef) return;
    try {
      setEditBusy(true);
      setEditMsg({ type: "", text: "" });
      const st = String(editForm.execution_status || "PENDING").toUpperCase();
      const pnlRaw = String(editForm.pnl_realized ?? "").trim();
      const pnlNum = pnlRaw === "" ? null : Number(pnlRaw);
      const payload = {
        execution_status: st,
        pnl_realized:
          st === "PENDING" ? 0 : Number.isFinite(pnlNum) ? pnlNum : null,
      };
      const out = await api.v2UpdateTrade(selectedRef, payload);
      setEditMsg({ type: "success", text: "Trade updated." });
      await loadTrades();
      if (out?.item?.id || out?.item?.sid || out?.item?.sid) {
        const refreshQ = String(
          out?.item?.sid || out?.item?.sid || out?.item?.id || "",
        );
        const refresh = await api.v2Trades({
          q: refreshQ,
          page: 1,
          pageSize: 1,
        });
        if (Array.isArray(refresh?.items) && refresh.items.length > 0) {
          setSelectedTrade(refresh.items[0]);
        }
      }
      if (selectedRef) await loadTradeEvents(selectedRef);
      setEditModalOpen(false);
    } catch (e) {
      setEditMsg({
        type: "error",
        text: String(e?.message || e || "Failed to update trade."),
      });
    } finally {
      setEditBusy(false);
    }
  }

  function openTradeEditModal(trade) {
    if (!tradeKeyOf(trade)) return;
    setSelectedTrade(trade);
    const st = String(trade.execution_status || "PENDING").toUpperCase();
    const pnlRaw = Number(trade.pnl_realized);
    setEditForm({
      execution_status: st,
      pnl_realized:
        st === "PENDING"
          ? "0"
          : Number.isFinite(pnlRaw)
            ? String(Number(pnlRaw.toFixed(2)))
            : "",
    });
    setEditMsg({ type: "", text: "" });
    setEditModalOpen(true);
  }

  return (
    <section className="logs-page-container stack-layout">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h2 className="page-title" style={{ margin: 0 }}>
          Trades
        </h2>
        <span className="minor-text">{total} trades</span>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar-group toolbar-pagination">
          <div className="pager-area">
            <strong>{total}</strong>
            {pages > 1 && (
              <div className="pager-mini">
                <button
                  className="secondary-button"
                  disabled={filter.page <= 1}
                  onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
                >
                  &lt;
                </button>
                <span className="minor-text">
                  {filter.page}/{pages}
                </span>
                <button
                  className="secondary-button"
                  disabled={filter.page >= pages}
                  onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
                >
                  &gt;
                </button>
              </div>
            )}
            <select
              value={filter.pageSize}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  pageSize: Number(e.target.value),
                  page: 1,
                }))
              }
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="toolbar-group toolbar-search-filter"
          style={{ flexWrap: "wrap" }}
        >
          <input
            value={filter.q}
            onChange={(e) =>
              setFilter((f) => ({ ...f, q: e.target.value, page: 1 }))
            }
            placeholder="Search sid, symbol, note..."
            style={{ width: 220 }}
          />
          <select
            value={filter.account_id}
            onChange={(e) =>
              setFilter((f) => ({ ...f, account_id: e.target.value, page: 1 }))
            }
          >
            <option value="">ALL ACCOUNTS</option>
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name || a.account_id}
              </option>
            ))}
          </select>
          <select
            value={filter.source_id}
            onChange={(e) =>
              setFilter((f) => ({ ...f, source_id: e.target.value, page: 1 }))
            }
          >
            <option value="">ALL SOURCES</option>
            {sources.map((s) => (
              <option key={s.source_id} value={s.source_id}>
                {s.name || s.source_id}
              </option>
            ))}
          </select>
          <select
            value={filter.execution_status}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                execution_status: e.target.value,
                page: 1,
              }))
            }
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={filter.symbol}
            onChange={(e) =>
              setFilter((f) => ({ ...f, symbol: e.target.value, page: 1 }))
            }
          >
            <option value="">ALL SYMBOLS</option>
            {uniqueOptions.symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filter.entry_model}
            onChange={(e) =>
              setFilter((f) => ({ ...f, entry_model: e.target.value, page: 1 }))
            }
          >
            <option value="">ALL MODELS</option>
            {uniqueOptions.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={filter.range}
            onChange={(e) =>
              setFilter((f) => ({ ...f, range: e.target.value, page: 1 }))
            }
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-group toolbar-bulk-action">
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            disabled={bulkBusy}
          >
            {BULK_ACTIONS.map((a) => (
              <option key={a.value || "none"} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`primary-button ${bulkBusy ? "btn-busy" : ""}`}
            disabled={!bulkAction || bulkBusy}
            onClick={onBulkApply}
          >
            {bulkBusy ? (
              <div className="spinner" style={{ width: 14, height: 14 }} />
            ) : (
              "APPLY"
            )}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => setCreateMode((v) => !v)}
          >
            {createMode ? "CANCEL" : "+ CREATE TRADE"}
          </button>
        </div>
      </div>
      {createMsg ? (
        <div className="loading" style={{ padding: 10 }}>
          {createMsg}
        </div>
      ) : null}

      <div className="logs-layout-split">
        <div
          className="logs-list-pane component-frozen-wrap"
          style={listMode === "compact" ? { flex: "0 0 44px", minWidth: 44, overflow: "hidden", minWidth: 150, paddingTop: 40 } : { flex: "0 0 40%" }}
        >
          <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setListMode(listMode === "compact" ? "full" : "compact")}
              title={listMode === "compact" ? "Expand" : "Collapse"}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {listMode === "compact" ? ">>" : "<<"}
            </button>
          </div>
          {loading && (
            <div className="frozen-overlay">
              <div className="spinner" />
              <span>REFRESHING...</span>
            </div>
          )}
          {error ? <div className="error">{error}</div> : null}
          <div className="events-table-wrap">
            {listMode === "compact" ? (
              <div style={{ padding: 4, overflow: "auto", height: "100%" }}>
                {sortedRows.map((t) => {
                  const isActive = tradeKeyOf(selectedTrade) === tradeKeyOf(t);
                  const action = String(t.action || t.side || "").toUpperCase();
                  const pnl = Number(t.pnl_realized || t.broker_pnl || 0);
                  const rr = Number(t.rr_planned || 0);
                  return (
                    <article
                      key={t.sid || t.id}
                      onClick={() => {
                        const k = tradeKeyOf(t);
                        selectedTradeIdRef.current = k;
                        setSelectedTrade(t);
                        navigate(`/trades/${k}`, { replace: true });
                      }}
                      style={{
                        cursor: "pointer",
                        padding: "4px 6px",
                        marginBottom: 3,
                        borderRadius: 6,
                        fontSize: 10,
                        border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                        background: isActive ? "rgba(255,255,255,0.05)" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: 10, color: action === "SELL" ? "#ef5350" : "#26a69a" }}>
                          {t.symbol || "-"}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 10, color: pnl >= 0 ? "#10b981" : "#ef4444" }}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                        <span style={{ color: "var(--muted)", fontSize: 9 }}>
                          {t.entry || "-"} → {t.tp || "-"}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 9 }}>
                          {Number.isFinite(rr) ? rr.toFixed(1) + "r" : "-"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
            <table className={`events-table${listMode === "compact" ? " compact-list" : ""}`}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          rows.forEach((r) => {
                            if (checked) next.add(tradeKeyOf(r));
                            else next.delete(tradeKeyOf(r));
                          });
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th
                    onClick={() => toggleSort("symbol")}
                    style={{ cursor: "pointer" }}
                  >
                    POSITION{sortMarker("symbol")}
                  </th>
                  <th
                    onClick={() => toggleSort("strategy")}
                    style={{ cursor: "pointer" }}
                  >
                    INFO{sortMarker("strategy")}
                  </th>
                  <th
                    onClick={() => toggleSort("pnl")}
                    style={{ cursor: "pointer" }}
                  >
                    STATUS{sortMarker("pnl")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="loading">
                      Loading trades...
                    </td>
                  </tr>
                ) : sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="empty-state">
                      No trades found.
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((t) => {
                    const status = statusUi(t.execution_status);
                    const action = String(
                      t.action || t.side || "-",
                    ).toUpperCase();
                    const actionCls =
                      action === "BUY" ? "side-buy" : "side-sell";
                    const strategyLabel = compactStrategy(t);
                    const rr = calcRr(t);
                    const acc = accountById.get(String(t.account_id || ""));
                    const accountName = String(
                      acc?.name || t.account_id || "-",
                    );
                    const brokerName = brokerNameFromAccount(acc);
                    const pnl =
                      asNum(t.broker_pnl) ??
                      asNum(t.pnl_realized) ??
                      asNum(t.net_pnl) ??
                      asNum(t.pnl);
                    const stRaw = String(
                      t.execution_status || "",
                    ).toUpperCase();
                    const showPnl =
                      stRaw !== "PENDING" && pnl != null && pnl !== 0;
                    const rrDisplay = asNum(t.rr_planned) ?? rr;
                    const timeValue = fDateTime(auditTimestampRaw(t));
                    const isSelected =
                      tradeKeyOf(selectedTrade) === tradeKeyOf(t);
                    const flashFields =
                      changedFields.get(String(t.sid || "").trim()) ||
                      new Set();
                    return (
                      <tr
                        key={tradeKeyOf(t)}
                        className={isSelected ? "active" : ""}
                        onClick={() => {
                          const k = tradeKeyOf(t);
                          if (tradeKeyOf(selectedTrade) === k) {
                            // Deselect — back to list
                            setSelectedTrade(null);
                            selectedTradeIdRef.current = "";
                            navigate("/trades", { replace: true });
                          } else {
                            selectedTradeIdRef.current = k;
                            setSelectedTrade(t);
                            navigate(`/trades/${k}`, { replace: true });
                          }
                        }}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(tradeKeyOf(t))}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(tradeKeyOf(t));
                                else next.delete(tradeKeyOf(t));
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td>
                          <SymbolEntryCell
                            side={action}
                            symbol={t.symbol}
                            orderType={
                              t.metadata?.order_type || t.order_type || "limit"
                            }
                            entry={t.entry || "-"}
                            tp={t.tp || "-"}
                            sl={t.sl || "-"}
                            rr={rrDisplay}
                            status={t.execution_status}
                          />
                        </td>
                        <td>
                          <PositionAuditCell
                            source={displaySource(t)}
                            strategy={strategyLabel}
                            timeText={timeValue}
                            sid={String(t.sid || "-")}
                            brokerId={brokerTicketOf(t)}
                            confidence={
                              t.confidence_pct ||
                              t.raw_json?.confidence_pct ||
                              t.raw_json?.confidence
                            }
                            riskManagement={
                              t.raw_json?.risk_management ||
                              t.metadata?.risk_management
                            }
                            riskPct={
                              asNum(t.risk_pct_planned) ??
                              asNum(t.metadata?.risk_pct) ??
                              asNum(t.raw_json?.risk_pct) ??
                              asNum(t.raw_json?.riskPct) ??
                              asNum(t.volume)
                            }
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <StatusPnlCell
                            status={t.execution_status}
                            hideStatus={true}
                            statusNode={
                              <span
                                className={`badge ${status.cls}`}
                                style={{ cursor: "pointer" }}
                                title="Edit trade status / PnL"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTradeEditModal(t);
                                }}
                              >
                                {status.label}
                              </span>
                            }
                            pnl={pnl}
                            margin={tradeRiskSize(t)}
                            tpPnl={
                              stRaw === "CLOSED" ||
                              stRaw === "TP" ||
                              stRaw === "SL"
                                ? t.entry_exec || t.entry
                                : t.broker_tp_pnl
                            }
                            slPnl={
                              stRaw === "CLOSED" ||
                              stRaw === "TP" ||
                              stRaw === "SL"
                                ? t.last_price || t.tp
                                : t.broker_sl_pnl
                            }
                            showFilledDetails={
                              stRaw === "OPEN" || stRaw === "FILLED"
                            }
                            brokerVolume={
                              asNum(t.broker_volume) ??
                              asNum(t.metadata?.broker_data?.volume) ??
                              "-"
                            }
                            brokerLots={
                              asNum(t.broker_lots) ??
                              asNum(t.metadata?.broker_data?.lots) ??
                              "-"
                            }
                            brokerPips={
                              asNum(t.broker_pips) ??
                              asNum(t.metadata?.broker_data?.pips) ??
                              "-"
                            }
                            flashFields={flashFields}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>

        <div
          className="logs-detail-pane component-frozen-wrap"
          style={{ flex: 1, minWidth: 0 }}
        >

          {editBusy && (
            <div className="frozen-overlay">
              <div className="spinner" />
              <span>UPDATING...</span>
            </div>
          )}
          {!selectedTrade ? (
            <div className="empty-state">SELECT A TRADE TO INSPECT DETAILS</div>
          ) : (
            <>
              <Suspense
                fallback={
                  <div className="loading-card">Loading Details...</div>
                }
              >
                <SignalDetailCard
                  mode="trade"
                  response={{
                    raw: (() => {
                      try {
                        const rj = selectedTrade?.raw_json;
                        return rj && typeof rj === "object"
                          ? rj
                          : typeof rj === "string"
                            ? JSON.parse(rj)
                            : {};
                      } catch (_) {
                        return selectedTrade?.raw_json || {};
                      }
                    })(),
                    tradePlans: (() => {
                      try {
                        const rj = selectedTrade?.raw_json;
                        const obj =
                          rj && typeof rj === "object"
                            ? rj
                            : typeof rj === "string"
                              ? JSON.parse(rj)
                              : {};
                        const tp = Array.isArray(obj?.trade_plan)
                          ? obj.trade_plan
                          : obj?.trade_plan
                            ? [obj.trade_plan]
                            : [];
                        const result = tp.length
                          ? tp
                          : [obj].filter(
                              (x) =>
                                x &&
                                typeof x === "object" &&
                                (x.direction || x.entry_price || x.entry),
                            );
                        // Always return at least one plan so buttons render
                        return result.length
                          ? result
                          : [
                              {
                                direction: selectedTrade?.action || "BUY",
                                entry: selectedTrade?.entry,
                                tp: selectedTrade?.tp,
                                sl: selectedTrade?.sl,
                              },
                            ];
                      } catch (_) {
                        return [{ direction: "BUY" }];
                      }
                    })(),
                  }}
                  tradePlan={{
                    enabled: true,
                    hideEditor: false,
                    mode: "trade",
                    tradeId: selectedTrade.sid || selectedTrade.id,
                    value: detailPlan,
                    onChange: (k, v) =>
                      setDetailPlan((p) => applyLinkedPlanChange(p, k, v)),
                    onSave: onUpdateTradePlan,
                    onReset: () =>
                      selectedTrade &&
                      setDetailPlan(extractTradePlanFromTrade(selectedTrade)),
                    onAddTrade: onReEntryTrade,
                    showAddSignalButton: false,
                    showSaveButton: ![
                      "FILLED",
                      "CLOSED",
                      "CANCELLED",
                      "TP",
                      "SL",
                      "FAIL",
                      "EXPIRED",
                    ].includes(
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase(),
                    ),
                    saveLabel: "Save",
                    showResetButton: true,
                    resetLabel: "Reset",
                    onCancel:
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase() === "PENDING"
                        ? async () => {
                            if (!confirm("Cancel this trade?")) return;
                            try {
                              const { promise: cancelPromise } = NotificationHub.track(
                                "cancel_trade",
                                { symbol: selectedTrade.symbol || "", sid: selectedTrade.sid || selectedTrade.id },
                                () => api.cancelTrades({ q: selectedTrade.sid || selectedTrade.id }),
                              );
                              await cancelPromise;
                              await loadTrades();
                            } catch (e) {
                              setError(e?.message || "Cancel failed");
                            }
                          }
                        : null,
                    onClose:
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase() === "FILLED"
                        ? async () => {
                            if (!confirm("Close this trade?")) return;
                            try {
                              const { promise: closePromise } = NotificationHub.track(
                                "close_trade",
                                { symbol: selectedTrade.symbol || "", sid: selectedTrade.sid || selectedTrade.id },
                                () => api.v2UpdateTrade(selectedTrade.sid || selectedTrade.id, { execution_status: "CLOSED" }),
                              );
                              await closePromise;
                              await loadTrades();
                            } catch (e) {
                              setError(e?.message || "Close failed");
                            }
                          }
                        : null,
                    viewOnly: [
                      "FILLED",
                      "CLOSED",
                      "CANCELLED",
                      "TP",
                      "SL",
                      "FAIL",
                      "EXPIRED",
                    ].includes(
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase(),
                    ),
                  }}
                  header={(() => {
                    const action = String(
                      selectedTrade.action || selectedTrade.side || "-",
                    ).toUpperCase();
                    const actionCls =
                      action === "BUY" ? "side-buy" : "side-sell";
                    const pnl =
                      asNum(selectedTrade.broker_pnl) ??
                      asNum(selectedTrade.pnl_realized);
                    const rr = calcRr(selectedTrade);
                    const riskSize = tradeRiskSize(selectedTrade);
                    const meta =
                      selectedTrade?.metadata &&
                      typeof selectedTrade.metadata === "object"
                        ? selectedTrade.metadata
                        : {};
                    const raw =
                      selectedTrade?.raw_json &&
                      typeof selectedTrade.raw_json === "object"
                        ? selectedTrade.raw_json
                        : {};
                    const vol =
                      asNum(selectedTrade.broker_lots) ||
                      asNum(meta.broker_data?.lots) ||
                      asNum(meta.broker_lots) ||
                      asNum(meta.lots) ||
                      asNum(selectedTrade.volume);
                    const plannedVol =
                      asNum(meta.requested_lots) ??
                      asNum(meta.requested_volume) ??
                      asNum(raw.riskPct) ??
                      asNum(raw.risk_pct);
                    const riskPct = asNum(
                      selectedTrade.risk_pct_planned ??
                        meta.riskPct ??
                        meta.risk_pct ??
                        meta.volumePct ??
                        meta.volume_pct ??
                        raw.riskPct ??
                        raw.risk_pct ??
                        raw.volumePct ??
                        raw.volume_pct,
                    );
                    const mr = moneyRiskReward(selectedTrade);
                    const status = statusUi(selectedTrade.execution_status);
                    const headerMeta = buildHeaderMeta({
                      statusRaw: selectedTrade.execution_status,
                      pnlRaw: pnl,
                      rrRaw: rr,
                      volumeRaw: vol,
                      plannedVolRaw: plannedVol,
                      riskSizeRaw: riskSize,
                      riskPctRaw: riskPct,
                      rewardSizeRaw: mr.reward,
                      updatedAtRaw:
                        selectedTrade.updated_at ||
                        selectedTrade.closed_at ||
                        selectedTrade.opened_at ||
                        selectedTrade.created_at,
                      statusUi,
                    });
                    return buildDetailHeader({
                      side: action,
                      symbol: selectedTrade.symbol || "-",
                      sideClass: actionCls,
                      positionText: `${selectedTrade.entry || "-"} → ${selectedTrade.tp || "-"} / ${selectedTrade.sl || "-"}`,
                      ...headerMeta,
                      statusNode: (
                        <span
                          className={`badge ${status.cls}`}
                          style={{ cursor: "pointer" }}
                          title="Edit trade status / PnL"
                          onClick={() => openTradeEditModal(selectedTrade)}
                        >
                          {status.label}
                        </span>
                      ),
                    });
                  })()}
                  chart={{
                    enabled: true,
                    detailTfTab,
                    onDetailTfTabChange: setDetailTfTab,
                    iframeTitle: `trade-tv-${detailTfTab}`,
                    symbol: selectedTrade.symbol,
                    interval:
                      selectedTrade.signal_tf || selectedTrade.chart_tf || "1h",
                    live: true,
                    entryPrice: asNum(selectedTrade.entry),
                    slPrice: asNum(selectedTrade.sl),
                    tpPrice: asNum(selectedTrade.tp),
                    openedAt: selectedTrade.opened_at,
                    closedAt: selectedTrade.closed_at,
                    createdAt: selectedTrade.created_at,
                    analysisSnapshot: (() => {
                      const snap =
                        selectedTrade?.metadata?.analysis_snapshot ||
                        selectedTrade?.raw_json?.analysis_snapshot;
                      const mkt =
                        selectedTrade?.metadata?.market_analysis ||
                        selectedTrade?.raw_json?.market_analysis;
                      const pdArrays =
                        snap?.pd_arrays ||
                        mkt?.pd_arrays ||
                        selectedTrade?.raw_json?.pd_arrays ||
                        [];
                      const keyLevels =
                        snap?.key_levels || mkt?.key_levels || [];
                      if (snap)
                        return {
                          ...snap,
                          pd_arrays: pdArrays,
                          key_levels: keyLevels,
                        };
                      if (pdArrays.length > 0)
                        return { pd_arrays: pdArrays, key_levels: keyLevels };
                      return null;
                    })(),
                  }}
                  metaItems={[
                    {
                      label: "Source",
                      value: displaySource(selectedTrade),
                      group: "source",
                    },
                    {
                      label: "Trade SID",
                      value: selectedTrade.sid || "-",
                      group: "source",
                    },
                    {
                      label: "Chart TF",
                      value: formatTimeframe(selectedTrade.chart_tf || "-"),
                      group: "source",
                    },
                    {
                      label: "Signal TF",
                      value: formatTimeframe(selectedTrade.signal_tf || "-"),
                      group: "source",
                    },
                    {
                      label: "Risk (%)",
                      value:
                        detailPlan.risk_pct != null
                          ? `${Number(detailPlan.risk_pct).toFixed(2)}%`
                          : "-",
                      group: "source",
                    },
                    {
                      label: "Risk ($)",
                      value:
                        detailPlan.risk_money != null
                          ? `$${Number(detailPlan.risk_money).toFixed(2)}`
                          : "-",
                      group: "source",
                    },
                    {
                      label: "Strategy",
                      value: compactStrategy(selectedTrade),
                      group: "source",
                    },
                    {
                      label: "Entry Model",
                      value:
                        selectedTrade.entry_model ||
                        selectedTrade.raw_json?.entry_model ||
                        "-",
                      group: "source",
                    },
                    {
                      label: "Confidence",
                      value:
                        detailPlan.confidence_pct != null
                          ? `${detailPlan.confidence_pct}%`
                          : "-",
                      group: "source",
                    },
                    {
                      label: "Invalidation",
                      value: detailPlan.invalidation || "-",
                      group: "source",
                    },
                    {
                      label: "BE Trigger",
                      value: detailPlan.be_trigger || "-",
                      group: "source",
                    },
                    {
                      label: "Profile",
                      value: detailPlan.profile || "-",
                      group: "source",
                    },
                    {
                      label: "Est. Bars",
                      value: detailPlan.estimated_bars || "-",
                      group: "source",
                    },
                    {
                      label: "Direction",
                      value:
                        detailPlan.direction || selectedTrade.action || "-",
                      group: "source",
                    },
                    {
                      label: "Order Type",
                      value:
                        detailPlan.trade_type || detailPlan.order_type || "-",
                      group: "source",
                    },
                    {
                      label: "Model",
                      value:
                        selectedTrade.model ||
                        selectedTrade.metadata?.model ||
                        "-",
                      group: "source",
                    },
                    {
                      label: "Session",
                      value:
                        detailPlan.session ||
                        selectedTrade.session_prefix ||
                        selectedTrade.metadata?.session_prefix ||
                        "-",
                      group: "source",
                    },
                    {
                      label: "Entry",
                      value: detailPlan.entry || selectedTrade.entry || "-",
                      group: "source",
                    },
                    {
                      label: "TP",
                      value: detailPlan.tp || selectedTrade.tp || "-",
                      group: "source",
                    },
                    {
                      label: "SL",
                      value: detailPlan.sl || selectedTrade.sl || "-",
                      group: "source",
                    },
                    {
                      label: "RR",
                      value: detailPlan.rr || selectedTrade.rr_planned || "-",
                      group: "source",
                    },
                    {
                      label: "Confidence Level",
                      value: detailPlan.confidence_level || "-",
                      group: "source",
                    },
                    {
                      label: "Risk Level",
                      value:
                        detailPlan.risk_level ||
                        selectedTrade.metadata?.risk_level ||
                        "-",
                      group: "source",
                    },
                    {
                      label: "Multiple Exits",
                      value:
                        detailPlan.multiple_exits &&
                        Object.keys(detailPlan.multiple_exits).length
                          ? JSON.stringify(detailPlan.multiple_exits, null, 2)
                          : "-",
                      fullWidth: true,
                      valueStyle: {
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      },
                    },
                    {
                      label: "Partial TPs",
                      value:
                        Array.isArray(detailPlan.partial_tps) &&
                        detailPlan.partial_tps.length
                          ? JSON.stringify(detailPlan.partial_tps, null, 2)
                          : "-",
                      fullWidth: true,
                      valueStyle: {
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      },
                    },
                    {
                      label: "Trade Decision",
                      value:
                        detailPlan.trade_decision ||
                        detailPlan.skip_recommendation ||
                        "-",
                    },
                    {
                      label: "Reasons to Skip",
                      value:
                        Array.isArray(detailPlan.reasons_to_skip) &&
                        detailPlan.reasons_to_skip.length
                          ? JSON.stringify(detailPlan.reasons_to_skip, null, 2)
                          : "-",
                      fullWidth: true,
                      valueStyle: {
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      },
                    },
                    {
                      label: "Snapshot Files",
                      value:
                        Array.isArray(selectedTrade.snapshot_files) &&
                        selectedTrade.snapshot_files.length
                          ? selectedTrade.snapshot_files.join(", ")
                          : "-",
                      fullWidth: true,
                    },
                    {
                      label: "AI Analysis",
                      value:
                        detailPlan.ai_full_analysis &&
                        Object.keys(detailPlan.ai_full_analysis).length
                          ? JSON.stringify(detailPlan.ai_full_analysis, null, 2)
                          : "-",
                      fullWidth: true,
                      valueStyle: {
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      },
                    },
                    {
                      label: "Only Signal",
                      value:
                        selectedTrade.only_signal != null
                          ? String(selectedTrade.only_signal)
                          : "-",
                      group: "source",
                    },
                    {
                      label: "Entry Condition",
                      value: detailPlan.entry_condition || "-",
                      fullWidth: true,
                    },
                    {
                      label: "Exit Condition",
                      value: detailPlan.exit_condition || "-",
                      fullWidth: true,
                    },
                    {
                      label: "Risk Management",
                      value: detailPlan.risk_management || "-",
                      fullWidth: true,
                    },
                    {
                      label: "Checklist",
                      value:
                        Array.isArray(detailPlan.confluence_checklist) &&
                        detailPlan.confluence_checklist.length > 0
                          ? detailPlan.confluence_checklist.join(", ")
                          : "-",
                      fullWidth: true,
                    },
                    {
                      label: "Skip Recommendation",
                      value: detailPlan.skip_recommendation || "-",
                      fullWidth: true,
                    },
                    {
                      label: "Note",
                      value: detailPlan.note || "-",
                      fullWidth: true,
                    },
                    {
                      label: "Account",
                      value:
                        accountById.get(String(selectedTrade.account_id || ""))
                          ?.name ||
                        selectedTrade.account_id ||
                        "-",
                      group: "account",
                    },
                    {
                      label: "Broker Ticket",
                      value: brokerTicketOf(selectedTrade),
                      group: "account",
                    },
                    {
                      label: "Broker Status",
                      value: selectedTrade.metadata?.broker_data?.status || "-",
                      group: "account",
                    },
                    ...(selectedTrade.metadata &&
                    typeof selectedTrade.metadata === "object"
                      ? (() => {
                          const meta = selectedTrade.metadata;
                          const bData = meta.broker_data || {};

                          const bVol =
                            asNum(selectedTrade.broker_volume) ??
                            asNum(bData.volume);
                          const bLots =
                            asNum(selectedTrade.broker_lots) ??
                            asNum(bData.lots);
                          const bPips =
                            asNum(selectedTrade.broker_pips) ??
                            asNum(bData.pips);
                          const bProfit =
                            asNum(selectedTrade.broker_pnl) ??
                            asNum(selectedTrade.pnl_realized) ??
                            asNum(bData.net_pnl) ??
                            asNum(bData.pnl);
                          const bComm =
                            asNum(selectedTrade.broker_commission) ??
                            asNum(bData.commission);
                          const bSwap =
                            asNum(selectedTrade.broker_swap) ??
                            asNum(bData.swap);
                          const bMargin =
                            asNum(selectedTrade.broker_margin) ??
                            asNum(bData.margin);
                          const bTpPnl =
                            asNum(selectedTrade.broker_tp_pnl) ??
                            asNum(bData.tp_pnl);
                          const bSlPnl =
                            asNum(selectedTrade.broker_sl_pnl) ??
                            asNum(bData.sl_pnl);

                          return [
                            {
                              label: "Broker Volume",
                              value:
                                bVol != null
                                  ? `${bVol.toLocaleString()} units`
                                  : null,
                              group: "account",
                            },
                            {
                              label: "Broker Lots",
                              value:
                                bLots != null
                                  ? `${bLots.toFixed(2)} lots`
                                  : null,
                              group: "account",
                            },
                            {
                              label: "Broker Pips",
                              value:
                                bPips != null
                                  ? `${bPips.toFixed(1)} pips`
                                  : null,
                              group: "account",
                            },
                            {
                              label: "Broker Net Profit",
                              value:
                                bProfit != null
                                  ? `$${bProfit.toFixed(2)}`
                                  : null,
                              group: "account",
                            },
                            {
                              label: "Commission",
                              value:
                                bComm != null ? `$${bComm.toFixed(2)}` : null,
                              group: "account",
                            },
                            {
                              label: "Swap",
                              value:
                                bSwap != null ? `$${bSwap.toFixed(2)}` : null,
                              group: "account",
                            },
                            {
                              label: "Margin",
                              value:
                                bMargin != null
                                  ? `$${bMargin.toFixed(2)}`
                                  : null,
                              group: "account",
                            },
                            {
                              label: "Planned TP Profit",
                              value:
                                bTpPnl != null ? `$${bTpPnl.toFixed(2)}` : null,
                              group: "account",
                            },
                            {
                              label: "Planned SL Profit",
                              value:
                                bSlPnl != null ? `$${bSlPnl.toFixed(2)}` : null,
                              group: "account",
                            },
                          ].filter((x) => x.value !== null);
                        })()
                      : []),
                    {
                      label: "Metadata",
                      fullWidth: true,
                      value: (() => {
                        const meta = selectedTrade.metadata || {};
                        const bData = meta.broker_data || {};

                        const cleaned = {};
                        const junk = [
                          "props",
                          "children",
                          "ref",
                          "key",
                          "type",
                          "_owner",
                          "_store",
                          "_self",
                          "_source",
                          "market_analysis",
                          "analysis_snapshot",
                          "pd_arrays",
                          "key_levels",
                          "labels",
                        ];

                        // If we have broker data, it's usually the most important
                        const source =
                          Object.keys(bData).length > 0 ? bData : meta;

                        Object.keys(source).forEach((k) => {
                          if (junk.includes(k)) return;
                          const val = source[k];
                          if (val === null || val === undefined || val === "")
                            return;
                          cleaned[k] = val;
                        });
                        return cleaned;
                      })(),
                    },
                  ]}
                  history={{
                    enabled: true,
                    items: tradeEvents,
                    scroll: true,
                    renderItem: (ev, idx) =>
                      renderHistoryItem(ev, idx, {
                        formatDateTime: fDateTime,
                        includeTicket: true,
                      }),
                  }}
                  formatDateTime={fDateTime}
                />
              </Suspense>
              {createMode ? (
                <div className="panel" style={{ padding: 12 }}>
                  <div className="panel-label">CREATE TRADE</div>
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    }}
                  >
                    <select
                      value={createForm.action}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, action: e.target.value }))
                      }
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                    <input
                      value={createForm.symbol}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, symbol: e.target.value }))
                      }
                      placeholder="BTCUSD"
                    />
                    <input
                      value={createForm.volume}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, volume: e.target.value }))
                      }
                      placeholder="Lots (0.01)"
                    />
                    <input
                      value={createForm.risk_pct}
                      onChange={(e) =>
                        setCreateForm((p) => ({
                          ...p,
                          risk_pct: e.target.value,
                        }))
                      }
                      placeholder="Risk % (0.01)"
                    />
                    <input
                      value={createForm.risk_money}
                      onChange={(e) =>
                        setCreateForm((p) => ({
                          ...p,
                          risk_money: e.target.value,
                        }))
                      }
                      placeholder="Risk $ (100)"
                    />
                    <input
                      value={createForm.price}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, price: e.target.value }))
                      }
                      placeholder="Entry"
                    />
                    <input
                      value={createForm.sl}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, sl: e.target.value }))
                      }
                      placeholder="SL"
                    />
                    <input
                      value={createForm.tp}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, tp: e.target.value }))
                      }
                      placeholder="TP"
                    />
                    <input
                      value={createForm.strategy}
                      onChange={(e) =>
                        setCreateForm((p) => ({
                          ...p,
                          strategy: e.target.value,
                        }))
                      }
                      placeholder="Strategy"
                    />
                    <input
                      value={createForm.timeframe}
                      onChange={(e) =>
                        setCreateForm((p) => ({
                          ...p,
                          timeframe: e.target.value,
                        }))
                      }
                      placeholder="TF"
                    />
                    <input
                      style={{ gridColumn: "1/-1" }}
                      value={createForm.note}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, note: e.target.value }))
                      }
                      placeholder="Note"
                    />
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={`primary-button ${bulkBusy ? "btn-busy" : ""}`}
                      onClick={onCreateTrade}
                      disabled={bulkBusy || !isCreateFormDirty}
                    >
                      {bulkBusy ? (
                        <div
                          className="spinner"
                          style={{ width: 14, height: 14 }}
                        />
                      ) : (
                        "💾 SAVE TRADE"
                      )}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setCreateMode(false)}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      {editModalOpen && selectedTrade ? (
        <div
          className="snapshot-modal-backdrop-v4"
          onClick={() => setEditModalOpen(false)}
        >
          <div
            className="snapshot-modal-panel-v4"
            style={{ width: "min(640px, 96vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="snapshot-modal-head-v4">
              <div className="panel-label" style={{ marginBottom: 0 }}>
                EDIT TRADE
              </div>
              <button
                type="button"
                className="danger-button"
                onClick={() => setEditModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              }}
            >
              <select
                value={editForm.execution_status}
                onChange={(e) => {
                  const st = String(e.target.value || "PENDING").toUpperCase();
                  setEditForm((p) => ({
                    ...p,
                    execution_status: st,
                    pnl_realized: st === "PENDING" ? "0" : p.pnl_realized,
                  }));
                }}
              >
                <option value="PENDING">PENDING</option>
                <option value="OPEN">FILLED (OPEN)</option>
                <option value="CLOSED">CLOSED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
              <input
                value={
                  editForm.execution_status === "PENDING"
                    ? "0"
                    : editForm.pnl_realized
                }
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, pnl_realized: e.target.value }))
                }
                placeholder="PNL realized"
                disabled={editForm.execution_status === "PENDING"}
              />
            </div>
            {editMsg.text ? (
              <div
                className={editMsg.type === "error" ? "error" : "loading"}
                style={{ marginTop: 12 }}
              >
                {editMsg.text}
              </div>
            ) : null}
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button
                type="button"
                className="primary-button"
                onClick={onSaveTradeEdit}
                disabled={editBusy}
              >
                SAVE
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditModalOpen(false)}
                disabled={editBusy}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
