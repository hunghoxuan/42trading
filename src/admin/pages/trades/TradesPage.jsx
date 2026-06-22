import { api } from "../../api";
import { NotificationHub } from "../../services/NotificationHub";
import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRealtimeData } from "../../hooks/useRealtimeData";
import SignalDetailCard from "../../components/SignalDetailCard";
import {
  PositionAuditCell,
  StatusPnlCell,
  SymbolEntryCell,
} from "../../components/TradeSignalListCells";
import { buildDetailHeader } from "../../components/SignalDetailHeaderBuilder";
import PnlDisplay from "../../components/PnlDisplay";
import PaginationBar from "../../../shared/components/PaginationBar";
import DataTable from "../../../shared/components/DataTable";
import CronRunLauncher from "../../components/CronRunLauncher";
import BulkActionsButton from "../../../shared/components/BulkActionsButton";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import { showToast } from "../../../shared/components/ToastContainer";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import AdminPageToolbar from "../../../shared/components/AdminPageToolbar";
import {
  asNum,
  asFiniteOrNull,
  buildHeaderMeta,
  buildRrVolRiskText,
  renderHistoryItem,
  extractTradePlanFromTrade,
  applyLinkedPlanChange,
  formatNum3,
  validateTradePlan,
} from "../../utils/signalDetailUtils";
import { getBrokerTicket } from "../../utils/tradeRow";
import {
  plannedPnlValueStyle,
  resolveDisplayedPlannedPnl,
} from "../../utils/tradePlannedPnl";

const STATUS_OPTIONS = [
  { value: "", label: "ALL STATUSES" },
  { value: "DRAFT", label: "DRAFT" },
  { value: "PENDING", label: "PENDING" },
  { value: "FILLED", label: "FILLED" },
  { value: "CLOSED", label: "CLOSED" },
  { value: "CANCELLED", label: "CANCELLED" },
  { value: "REJECTED", label: "REJECTED" },
  { value: "ERROR", label: "ERROR" },
];
const BULK_ACTIONS = [
  { value: "", label: "BULK ACTION..." },
  { value: "close_all", label: "Close All" },
  { value: "cancel_all", label: "Cancel All" },
  { value: "delete_all", label: "Delete All" },
];
const PNL_STATE_OPTIONS = [
  { value: "", label: "WIN / LOSE" },
  { value: "win", label: "PNL > 0" },
  { value: "lose", label: "PNL < 0" },
];
const RANGE_OPTIONS = [
  { value: "all", label: "ALL TIMES" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_week", label: "Last week" },
  { value: "last_month", label: "Last month" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];
const PAGE_SIZE_OPTIONS = [50, 100, 200];

import { formatDateTimeWithDuration, showDateTime } from "../../utils/format";
import FormComboSelect from "../../../shared/components/FormComboSelect";

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
  if (s === "Draft") return { cls: "DRAFT", label: "DRAFT" };
  if (s === "FILLED") return { cls: "ACTIVE", label: "FILLED" };
  if (s === "REJECTED") return { cls: "FAIL", label: "REJECTED" };
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

function tradeKeyOf(t) {
  // Prefer sid (UUID) for URLs, fall back to id for backward compat
  const sid = String(t?.sid || "").trim();
  if (sid) return sid;
  const idNum = Number(t?.id);
  if (Number.isInteger(idNum) && idNum > 0) return String(idNum);
  return "";
}

function findTradeByRef(items, tradeRef) {
  const target = String(tradeRef || "").trim();
  if (!target || !Array.isArray(items)) return null;
  return (
    items.find((item) => tradeKeyOf(item) === target) ||
    items.find((item) => String(item?.sid || "").trim() === target) ||
    items.find((item) => String(item?.id || "").trim() === target) ||
    null
  );
}

function toTradeVolumeUnits(plan = {}) {
  const displayLots = asFiniteOrNull(plan.volume);
  if (!Number.isFinite(displayLots)) return null;
  const basisUnits = asFiniteOrNull(plan.volume_units);
  const basisLots = asFiniteOrNull(plan.broker_lots ?? plan.volume);
  if (
    Number.isFinite(basisUnits) &&
    basisUnits > 0 &&
    Number.isFinite(basisLots) &&
    basisLots > 0
  ) {
    return Number((displayLots * (basisUnits / basisLots)).toFixed(8));
  }
  return displayLots;
}

function auditTimestampRaw(t) {
  return t?.created_at || t?.opened_at || t?.closed_at || t?.updated_at || null;
}

function toTimeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function compareTimeAsc(a, b) {
  const left = toTimeMs(a);
  const right = toTimeMs(b);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function compareTimeDesc(a, b) {
  const left = toTimeMs(a);
  const right = toTimeMs(b);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function compareTradesDefault(a, b) {
  let cmp = compareTimeDesc(a?.closed_at, b?.closed_at);
  if (cmp !== 0) return cmp;
  cmp = compareTimeAsc(a?.opened_at, b?.opened_at);
  if (cmp !== 0) return cmp;
  cmp = compareTimeAsc(a?.created_at, b?.created_at);
  if (cmp !== 0) return cmp;
  return String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
}

function rangeBounds(range, exactTime = "") {
  const timeToken = String(exactTime || "")
    .trim()
    .toLowerCase();
  if (timeToken) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(timeToken)) {
      const start = new Date(`${timeToken}T00:00:00`);
      const end = new Date(`${timeToken}T23:59:59.999`);
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
        return { from: start.toISOString(), to: end.toISOString() };
      }
    }
    if (timeToken !== "all") {
      return rangeBounds(timeToken, "");
    }
  }
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
  if (!["Draft", "PENDING", "OPEN", "FILLED", "OPEN", "CLOSED"].includes(st))
    return { risk: null, reward: null };
  const m = t?.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const risk =
    asNum(m.risk_money_actual) ??
    asNum(m.risk_money) ??
    asNum(m.risk_money_planned) ??
    asNum(t?.risk_money_planned) ??
    asNum(t?.risk_money);
  const rewardDirect = asNum(m.reward_money_planned);
  const rr = asNum(m.rr) ?? asNum(t?.rr_planned) ?? calcRr(t);
  if (st === "Draft")
    return { risk: risk ?? null, reward: rewardDirect ?? null };
  if (risk == null || rr == null) return { risk: null, reward: null };
  return { risk, reward: rewardDirect ?? risk * rr };
}

function tradeRiskSize(t) {
  const st = String(t?.execution_status || "").toUpperCase();
  if (!["Draft", "PENDING", "OPEN", "FILLED", "CLOSED"].includes(st))
    return null;
  const m = t?.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const direct =
    asNum(m.risk_money_actual) ??
    asNum(m.risk_money) ??
    asNum(m.risk_money_planned) ??
    asNum(t?.risk_money_planned) ??
    asNum(t?.risk_money);
  if (direct != null) return direct;
  const entry = asNum(t?.entry);
  const sl = asNum(t?.sl);
  const vol = asNum(m?.used_volume ?? t?.volume);
  if (entry == null || sl == null || vol == null) return null;
  const est = Math.abs(entry - sl) * vol;
  return Number.isFinite(est) ? est : null;
}

function formatClosedWithDuration(openedAt, closedAt) {
  return formatDateTimeWithDuration(closedAt, openedAt);
}

function formatOpenedWithDuration(createdAt, openedAt) {
  return formatDateTimeWithDuration(openedAt, createdAt);
}

function resolveOpenedDisplayAt(trade = {}) {
  return (
    trade?.opened_at ||
    trade?.ack_at ||
    trade?.metadata?.broker_data?.opened_at ||
    trade?.metadata?.broker_data?.openedAt ||
    null
  );
}

function brokerPnlValueStyle(pnlRaw) {
  const pnl = asNum(pnlRaw);
  if (!Number.isFinite(pnl)) return undefined;
  return {
    color: pnl >= 0 ? "#16a34a" : "#dc2626",
    fontWeight: 600,
  };
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

function resolveAccountOption(item = {}) {
  const accountId = String(item?.account_id || "").trim();
  if (!accountId) return null;
  const label =
    String(
      item?.account_metadata?.name ||
        item?.metadata?.account_name ||
        item?.metadata?.account_label ||
        item?.account_broker_name ||
        accountId,
    ).trim() || accountId;
  return { account_id: accountId, name: label };
}

function resolveSourceOption(item = {}) {
  const sourceId = String(item?.source_id || "").trim();
  if (!sourceId) return null;
  const label =
    String(item?.source_name || item?.metadata?.source_name || sourceId).trim() ||
    sourceId;
  return { source_id: sourceId, name: label };
}

export default function TradesPage() {
  const confirm = useConfirmDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { tradeId, status: routeStatus } = useParams();
  const defaultDetailHash = (statusRaw) => {
    const status = String(statusRaw || "")
      .trim()
      .toUpperCase();
    if (
      ["PENDING", "NEW", "PLACED", "LOCKED", "DRAFT", "PLANNED"].includes(
        status,
      )
    ) {
      return "#chart-live";
    }
    if (["FILLED", "OPEN", "START"].includes(status)) {
      return "#chart-live";
    }
    return "#analysis";
  };
  const statusToPath = (st) =>
    String(st || "").toLowerCase() === "draft"
      ? "draft"
      : String(st || "").toLowerCase();
  const tradePath = (t) => {
    const tradeKey = tradeKeyOf(t);
    const path = `/trades/${statusToPath(t?.execution_status || "pending")}/${tradeKey}`;
    const currentHash = window.location.hash || "";
    return (
      path +
      (currentHash.trim().length > 0
        ? currentHash
        : defaultDetailHash(t?.execution_status || "pending"))
    );
  };
  const [rows, setRows] = useState([]);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [settings, setSettings] = useState([]);
  const [selectedCronName, setSelectedCronName] = useState("");
  const [runCronLoading, setRunCronLoading] = useState(false);

  // Redirect /trades/{sid} to /trades/{status}/{sid}
  useEffect(() => {
    if (!tradeId || routeStatus) return;
    const row = rows.find((r) => tradeKeyOf(r) === tradeId);
    if (row) {
      navigate(tradePath(row), { replace: true });
    }
  }, [tradeId, routeStatus, rows]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [changedFields, setChangedFields] = useState(() => new Map()); // sid -> Set<fieldName>
  const [tradeEvents, setTradeEvents] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkAction, setBulkAction] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [createMode, setCreateMode] = useState(false);
  const [listMode, setListMode] = useState("compact"); // "compact" | "full"
  const [isListSidebarOpen, setIsListSidebarOpen] = useState(true);
  const [createMsg, setCreateMsg] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState({ type: "", text: "" });
  const [editForm, setEditForm] = useState({
    execution_status: "PENDING",
    pnl_realized: "0",
    account_id: "",
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
  const [detailPlanChartRefreshNonce, setDetailPlanChartRefreshNonce] =
    useState(0);
  const [detailPlanChartRefreshError, setDetailPlanChartRefreshError] =
    useState("");
  const detailPlanChartRefreshInitRef = useRef(false);
  const detailPlanChartRefreshTimerRef = useRef(null);
  useEffect(() => {
    if (!detailPlanChartRefreshError) return;
    setDetailPlanChartRefreshError("");
  }, [
    detailPlan.direction,
    detailPlan.entry,
    detailPlan.sl,
    detailPlan.tp,
    detailPlan.tp1,
    detailPlan.tp2,
    detailPlan.tp3,
  ]);

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
  const currentDetailHash = String(window.location.hash || "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();

  const initialTradeStatus = useMemo(
    () => (routeStatus || searchParams.get("status") || "FILLED").toUpperCase(),
    [routeStatus, searchParams],
  );

  const searchFilterSnapshot = useMemo(
    () => ({
      q: String(searchParams.get("q") || ""),
      account_id: String(searchParams.get("account_id") || ""),
      source_id: String(
        searchParams.get("source_id") || searchParams.get("source") || "",
      ),
      symbol: String(searchParams.get("symbol") || "").toUpperCase(),
      side: String(
        searchParams.get("side") || searchParams.get("direction") || "",
      ).toUpperCase(),
      entry_model: String(searchParams.get("entry_model") || ""),
      chart_tf: String(searchParams.get("chart_tf") || ""),
      execution_status: initialTradeStatus,
      pnl_state: String(searchParams.get("pnl_state") || "").toLowerCase(),
      time: String(
        searchParams.get("time") || searchParams.get("range") || "all",
      ),
      range: String(
        searchParams.get("time") || searchParams.get("range") || "all",
      ),
      page: Math.max(1, Number(searchParams.get("page") || 1) || 1),
      pageSize: (() => {
        const raw = Number(searchParams.get("pageSize") || 50) || 50;
        return PAGE_SIZE_OPTIONS.includes(raw) ? raw : 50;
      })(),
    }),
    [searchParams, initialTradeStatus],
  );

  const [filter, setFilter] = useState(searchFilterSnapshot);

  const pageTitle = useMemo(() => {
    const st = String(initialTradeStatus || "").toUpperCase();
    if (st === "FILLED") return "Positions";
    if (st === "PENDING") return "Orders";
    if (st === "CLOSED") return "Closed Trades";
    if (st === "DRAFT") return "Draft Trades";
    if (st === "REJECTED") return "Rejected Trades";
    if (st === "CANCELLED") return "Cancelled Trades";
    return "Trades";
  }, [initialTradeStatus]);

  const cronSettings = useMemo(
    () => settings.filter((s) => s?.type === "cron"),
    [settings],
  );

  // Sync filter when URL path/query changes (skip when trade detail open)
  useEffect(() => {
    if (tradeId) return;
    setFilter((prev) => {
      const next = searchFilterSnapshot;
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(next);
      return prevJson === nextJson ? prev : next;
    });
  }, [searchFilterSnapshot, tradeId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await api.getSettings();
        if (!cancelled) {
          setSettings(Array.isArray(res?.settings) ? res.settings : []);
        }
      } catch {}
    }
    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedCronName && cronSettings.length > 0) {
      setSelectedCronName(cronSettings[0].name || "");
    }
  }, [cronSettings, selectedCronName]);

  async function handleRunCron() {
    if (!selectedCronName) return;
    setRunCronLoading(true);
    try {
      const res = await api.runCron(selectedCronName);
      const result = res?.result || {};
      const summaryText =
        result?.started === true
          ? "Started in background"
          : typeof result?.captured === "number"
            ? `${result.captured} captured${Array.isArray(result.errors) && result.errors.length ? `, ${result.errors.length} failed` : ""}`
            : typeof result?.queued === "number"
              ? `${result.queued} queued`
              : typeof result?.triggered === "number"
                ? `${result.triggered} triggered`
                : "Completed";
      showToast({
        message: `Cron "${selectedCronName}" executed. ${summaryText}`,
        type: "success",
      });
    } catch (e) {
      showToast({
        message: e?.message || "Failed to run cron",
        type: "error",
      });
    } finally {
      setRunCronLoading(false);
    }
  }

  const query = useMemo(() => ({ ...filter }), [filter]);
  const [sorting, setSorting] = useState(null);
  const inFlightRef = useRef(false);
  const tradeEventsInFlightRef = useRef(false);
  const selectedTradeIdRef = useRef("");
  const planSaveGuardRef = useRef("");
  const tradeDetailRequestSeqRef = useRef(0);

  const accounts = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((row) => {
      const option = resolveAccountOption(row);
      if (!option) return;
      if (!map.has(option.account_id)) map.set(option.account_id, option);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.name || a.account_id).localeCompare(
        String(b.name || b.account_id),
      ),
    );
  }, [rows]);

  const sources = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((row) => {
      const option = resolveSourceOption(row);
      if (!option) return;
      if (!map.has(option.source_id)) map.set(option.source_id, option);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.name || a.source_id).localeCompare(
        String(b.name || b.source_id),
      ),
    );
  }, [rows]);

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

  async function loadTrades() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setLoading(true);
      const queryApi = { ...query };
      const b = rangeBounds(queryApi.range, queryApi.time);
      queryApi.created_from = b.from || "";
      queryApi.created_to = b.to || "";
      const data = await api.v2Trades(queryApi);
      const itemsRaw = data.items || [];
      const items = [...itemsRaw].sort(compareTradesDefault);
      setRows(items);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setError("");
      const preferredTradeId = String(selectedTradeIdRef.current || "").trim();
      if (!tradeId && preferredTradeId) {
        const updated = (data.items || []).find(
          (r) => tradeKeyOf(r) === preferredTradeId,
        );
        if (updated) {
          setSelectedTrade(updated);
          selectedTradeIdRef.current = preferredTradeId;
        } else {
          setSelectedTrade(null);
        }
      } else if (!tradeId && items.length > 0) {
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
      const items = Array.isArray(out?.items) ? out.items : [];
      setTradeEvents(items);
    } catch {
      setTradeEvents([]);
    } finally {
      tradeEventsInFlightRef.current = false;
    }
  }

  async function onBulkApply() {
    if (!bulkAction) return;
    try {
      setBulkBusy(true);
      const filters = { ...query };
      const b = rangeBounds(filters.range, filters.time);
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
        risk_money_planned:
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

  // Keep route-bound detail pinned to the route id.
  useEffect(() => {
    if (!tradeId) return;
    selectedTradeIdRef.current = String(tradeId || "").trim();
    setSelectedTrade((prev) =>
      tradeKeyOf(prev) === String(tradeId || "").trim() ? prev : null,
    );
    setNotFound(false);
    const requestSeq = ++tradeDetailRequestSeqRef.current;
    let cancelled = false;
    api
      .v2Trades({ q: tradeId })
      .then((data) => {
        if (cancelled || requestSeq !== tradeDetailRequestSeqRef.current) return;
        const t = findTradeByRef(data?.items, tradeId);
        if (t) {
          setSelectedTrade(t);
          selectedTradeIdRef.current = tradeId;
          setNotFound(false);
          const tradeStatus = String(t.execution_status || "").toUpperCase();
          if (
            !routeStatus &&
            tradeStatus &&
            tradeStatus !== filter.execution_status
          ) {
            setFilter((f) => ({
              ...f,
              execution_status: tradeStatus,
              page: 1,
            }));
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (tradeStatus) next.set("status", tradeStatus);
              else next.delete("status");
              return next;
            });
          }
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        if (cancelled || requestSeq !== tradeDetailRequestSeqRef.current) return;
        setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tradeId, routeStatus]);

  useEffect(() => {
    loadTrades();
  }, [query]);
  useEffect(() => {
    if (tradeId) {
      selectedTradeIdRef.current = String(tradeId || "").trim();
      return;
    }
    selectedTradeIdRef.current = tradeKeyOf(selectedTrade);
  }, [tradeId, selectedTrade?.id, selectedTrade?.sid]);
  const isDraftSelected =
    String(selectedTrade?.execution_status || "").toUpperCase() === "DRAFT";
  useEffect(() => {
    const ref = tradeKeyOf(selectedTrade);
    if (ref) {
      loadTradeEvents(ref);
      // Skip re-extraction only for the same trade right after save
      // (preserve user edits without leaking stale plan to other trades).
      // Guard persists across React StrictMode double-effects.
      if (planSaveGuardRef.current === ref) {
        return;
      }
      setDetailPlan({
        ...extractTradePlanFromTrade(selectedTrade),
        close_reason: selectedTrade?.close_reason || "",
        rejection_reason: selectedTrade?.rejection_reason || "",
      });
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
        close_reason: "",
        rejection_reason: "",
      });
    }
  }, [selectedTrade]);
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
    if (!selectedTrade) {
      setError("No trade selected.");
      return;
    }
    const ref = tradeKeyOf(selectedTrade);
    if (!ref) {
      setError("Cannot identify selected trade.");
      return;
    }
    try {
      setEditBusy(true);
      const status = String(selectedTrade.execution_status || "").toUpperCase();
      const lockSideType = status === "FILLED";
      const lockAll = status === "CLOSED" || status === "CANCELLED";
      const payload = {
        direction: lockSideType || lockAll ? null : detailPlan.direction,
        side: lockSideType || lockAll ? null : detailPlan.direction,
        order_type: lockSideType || lockAll ? null : detailPlan.trade_type,
        price: lockAll ? null : asFiniteOrNull(detailPlan.entry),
        tp: lockAll ? null : asFiniteOrNull(detailPlan.tp1 ?? detailPlan.tp),
        tp1: lockAll ? null : asFiniteOrNull(detailPlan.tp1),
        tp2: lockAll ? null : asFiniteOrNull(detailPlan.tp2),
        tp3: lockAll ? null : asFiniteOrNull(detailPlan.tp3),
        sl: lockAll ? null : asFiniteOrNull(detailPlan.sl),
        rr: lockAll ? null : asFiniteOrNull(detailPlan.rr),
        strategy: detailPlan.strategy,
        entry_model: detailPlan.entry_model,
        source_id: detailPlan.source_id,
        note: detailPlan.note,
        confidence_pct: asFiniteOrNull(detailPlan.confidence_pct),
        invalidation: detailPlan.invalidation,
        estimated_bars: asFiniteOrNull(detailPlan.estimated_bars),
        profile: detailPlan.profile,
        exit_condition: detailPlan.exit_condition,
        entry_condition: detailPlan.entry_condition,
        risk_management: detailPlan.risk_management,
        skip_recommendation: detailPlan.skip_recommendation,
        confluence_checklist: detailPlan.confluence_checklist,
        be_trigger: asFiniteOrNull(detailPlan.be_trigger),
        volume: lockAll ? null : asFiniteOrNull(detailPlan.volume),
        lots: lockAll ? null : asFiniteOrNull(detailPlan.volume),
        risk_pct: asFiniteOrNull(detailPlan.risk_pct),
        risk_money: asFiniteOrNull(
          detailPlan.risk_money_planned ?? detailPlan.risk_money,
        ),
        risk_money_planned: asFiniteOrNull(
          detailPlan.risk_money_planned ?? detailPlan.risk_money,
        ),
      };
      await api.saveTradePlan(ref, payload);
      if (["CLOSED", "CANCELLED", "CANCEL", "REJECTED"].includes(status)) {
        const reasonPayload =
          status === "REJECTED"
            ? {
                execution_status: status,
                rejection_reason: String(
                  detailPlan.rejection_reason || "",
                ).trim(),
              }
            : {
                execution_status: status,
                close_reason: String(detailPlan.close_reason || "").trim(),
              };
        await api.v2UpdateTrade(ref, reasonPayload);
      }
      // Guard against extract-overwrite during re-fetch
      planSaveGuardRef.current = ref;
      await loadTrades();
      await loadTradeEvents(ref);
      // Clear guard after all re-fetches complete
      planSaveGuardRef.current = "";
    } catch (e) {
      setError(e?.message || "Failed to update trade plan");
    } finally {
      setEditBusy(false);
    }
  }

  function runDetailPlanChartRefresh(opts = {}) {
    const { silent = false } = opts;
    const validationError =
      validateTradePlan(detailPlan, { skipRrCheck: false }) || "";
    if (validationError) {
      if (!silent) setDetailPlanChartRefreshError(validationError);
      return;
    }
    setDetailPlanChartRefreshError("");
    setDetailPlanChartRefreshNonce((prev) => prev + 1);
  }

  function handleDetailPlanChartRefresh() {
    runDetailPlanChartRefresh({ silent: false });
  }

  useEffect(() => {
    if (!detailPlanChartRefreshInitRef.current) {
      detailPlanChartRefreshInitRef.current = true;
      return;
    }
    if (detailPlanChartRefreshTimerRef.current) {
      window.clearTimeout(detailPlanChartRefreshTimerRef.current);
    }
    detailPlanChartRefreshTimerRef.current = window.setTimeout(() => {
      runDetailPlanChartRefresh({ silent: true });
      detailPlanChartRefreshTimerRef.current = null;
    }, 220);
    return () => {
      if (detailPlanChartRefreshTimerRef.current) {
        window.clearTimeout(detailPlanChartRefreshTimerRef.current);
        detailPlanChartRefreshTimerRef.current = null;
      }
    };
  }, [
    detailPlan.direction,
    detailPlan.entry,
    detailPlan.sl,
    detailPlan.tp,
    detailPlan.tp1,
    detailPlan.tp2,
    detailPlan.tp3,
  ]);

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
        tp: asNum(detailPlan.tp1 ?? detailPlan.tp),
        tp1: asNum(detailPlan.tp1),
        tp2: asNum(detailPlan.tp2),
        tp3: asNum(detailPlan.tp3),
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

  async function onApproveDraft() {
    if (!selectedTrade) return;
    if (!confirm("Approve this draft and move to pending?")) return;
    try {
      setEditBusy(true);
      await api.promoteDraftTrade(selectedTrade.sid || selectedTrade.id);
      navigate(`/trades/pending/${selectedTrade.sid || selectedTrade.id}`, {
        replace: true,
      });
      setSelectedTrade(null);
      await loadTrades();
    } catch (e) {
      setError(e?.message || "Approve failed");
    } finally {
      setEditBusy(false);
    }
  }

  async function onCancelDraft() {
    if (!selectedTrade) return;
    const ask = await confirm({
      title: "Cancel Draft Trade",
      message: "Cancel this draft trade?",
      confirmLabel: "Cancel Trade",
      cancelLabel: "Keep Draft",
      tone: "danger",
      input: true,
      inputPlaceholder: "Reason (optional)",
    });
    if (!ask || ask?.ok !== true) return;
    const reason = String(ask?.value || "").trim();
    try {
      setEditBusy(true);
      await api.v2UpdateTrade(selectedTrade.sid || selectedTrade.id, {
        execution_status: "CANCELLED",
        close_reason: reason || "CANCEL",
      });
      navigate(`/trades/cancelled/${selectedTrade.sid || selectedTrade.id}`, {
        replace: true,
      });
      setSelectedTrade(null);
      await loadTrades();
    } catch (e) {
      setError(e?.message || "Cancel failed");
    } finally {
      setEditBusy(false);
    }
  }

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(tradeKeyOf(r)));
  const sortedRows = useMemo(() => {
    const statusRankAsc = (v) => {
      const s = String(v || "").toUpperCase();
      if (s === "FILLED" || s === "FILLED") return 0;
      if (s === "PENDING") return 1;
      if (s === "CLOSED" || s === "CANCELLED") return 2;
      return 3;
    };
    const statusRankDesc = (v) => {
      const s = String(v || "").toUpperCase();
      if (s === "PENDING") return 0;
      if (s === "FILLED" || s === "FILLED") return 1;
      if (s === "CLOSED" || s === "CANCELLED") return 2;
      return 3;
    };
    const valueOfAudit = (x) => new Date(auditTimestampRaw(x) || 0).getTime();
    const out = [...rows];
    out.sort((a, b) => {
      if (!sorting?.key || !sorting?.dir) {
        return compareTradesDefault(a, b);
      }
      let cmp = 0;
      if (sorting.key === "symbol") {
        cmp = String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return sorting.dir === "asc" ? cmp : -cmp;
      }
      if (sorting.key === "strategy") {
        cmp = compactStrategy(a).localeCompare(compactStrategy(b));
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return sorting.dir === "asc" ? cmp : -cmp;
      }
      if (sorting.key === "info") {
        cmp = valueOfAudit(a) - valueOfAudit(b);
        return sorting.dir === "asc" ? cmp : -cmp;
      }
      if (sorting.key === "pnl") {
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
        return sorting.dir === "asc" ? cmp : -cmp;
      }
      if (sorting.key === "status") {
        cmp =
          sorting.dir === "asc"
            ? statusRankAsc(a?.execution_status) -
              statusRankAsc(b?.execution_status)
            : statusRankDesc(a?.execution_status) -
              statusRankDesc(b?.execution_status);
        if (cmp === 0) cmp = valueOfAudit(b) - valueOfAudit(a);
        return cmp;
      }
      return compareTradesDefault(a, b);
    });
    return out;
  }, [rows, sorting]);

  const columns = useMemo(() => {
    const valueOfAudit = (x) => new Date(auditTimestampRaw(x) || 0).getTime();

    return [
      {
        id: "select",
        header: () => (
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
        ),
        cell: ({ row }) => {
          const t = row.original;
          return (
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
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
        enableSorting: false,
        size: 30,
      },
      {
        id: "symbol",
        header: "POSITION",
        accessorFn: (row) => String(row?.symbol || ""),
        sortingFn: (rowA, rowB) => {
          const a = rowA.original;
          const b = rowB.original;
          const cmp = String(a?.symbol || "").localeCompare(
            String(b?.symbol || ""),
          );
          if (cmp === 0) return valueOfAudit(b) - valueOfAudit(a);
          return cmp;
        },
        cell: ({ row }) => {
          const t = row.original;
          const action = String(t.action || t.side || "-").toUpperCase();
          const stRaw = String(t.execution_status || "").toUpperCase();
          const pnl =
            asNum(t.broker_pnl) ??
            asNum(t.pnl_realized) ??
            asNum(t.net_pnl) ??
            asNum(t.pnl);
          const rr = calcRr(t);
          const rrDisplay = asNum(t.rr_planned) ?? rr;
          return (
            <SymbolEntryCell
              side={action}
              symbol={t.symbol}
              orderType={t.order_type || t.metadata?.order_type || "limit"}
              entry={t.entry || "-"}
              tp={t.tp || "-"}
              sl={t.sl || "-"}
              status={t.execution_status}
              pnl={pnl}
              tpPnl={
                stRaw === "CLOSED" || stRaw === "TP" || stRaw === "SL"
                  ? t.entry_exec || t.entry
                  : t.broker_tp_pnl
              }
              slPnl={
                stRaw === "CLOSED" || stRaw === "TP" || stRaw === "SL"
                  ? t.last_price || t.tp
                  : t.broker_sl_pnl
              }
              showRightPnl={listMode === "compact"}
            />
          );
        },
      },
      {
        id: "info",
        header: "INFO",
        accessorFn: (row) => auditTimestampRaw(row) || "",
        sortingFn: (rowA, rowB) => {
          const a = rowA.original;
          const b = rowB.original;
          return valueOfAudit(a) - valueOfAudit(b);
        },
        cell: ({ row }) => {
          const t = row.original;
          const timeValue = showDateTime(auditTimestampRaw(t));
          return (
            <PositionAuditCell
              timeText={timeValue}
              sid={String(t.sid || "-")}
              brokerId={getBrokerTicket(t)}
              dispatchStatus={t.dispatch_status}
            />
          );
        },
      },
      {
        id: "status",
        header: "STATUS",
        accessorFn: (row) =>
          asNum(row?.broker_pnl) ??
          asNum(row?.pnl_realized) ??
          asNum(row?.net_pnl) ??
          0,
        sortingFn: (rowA, rowB) => {
          const a = rowA.original;
          const b = rowB.original;
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
          const cmp = pa - pb;
          if (cmp === 0) return valueOfAudit(b) - valueOfAudit(a);
          return cmp;
        },
        cell: ({ row }) => {
          const t = row.original;
          const status = statusUi(t.execution_status);
          const pnl =
            asNum(t.broker_pnl) ??
            asNum(t.pnl_realized) ??
            asNum(t.net_pnl) ??
            asNum(t.pnl);
          const stRaw = String(t.execution_status || "").toUpperCase();
          const flashFields =
            changedFields.get(String(t.sid || "").trim()) || new Set();
          return (
            <StatusPnlCell
              status={t.execution_status}
              hideStatus={true}
              rr={asNum(t.rr_planned) ?? calcRr(t)}
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
                stRaw === "CLOSED" || stRaw === "TP" || stRaw === "SL"
                  ? t.entry_exec || t.entry
                  : t.broker_tp_pnl
              }
              slPnl={
                stRaw === "CLOSED" || stRaw === "TP" || stRaw === "SL"
                  ? t.last_price || t.tp
                  : t.broker_sl_pnl
              }
              showFilledDetails={stRaw === "FILLED" || stRaw === "FILLED"}
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
          );
        },
      },
    ];
  }, [rows, allSelected, selectedIds, listMode, changedFields]);

  const onSortingChange = (s) => setSorting(s || null);

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
        account_id: String(editForm.account_id || "").trim() || undefined,
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
      account_id: String(trade?.account_id || ""),
    });
    setEditMsg({ type: "", text: "" });
    setEditModalOpen(true);
  }

  return (
    <section className="logs-page-container trades-page-container stack-layout">
      <PageHeader
        className="trades-page-header"
        title={pageTitle}
        actions={
          <CronRunLauncher
            value={selectedCronName}
            onChange={setSelectedCronName}
            onRun={handleRunCron}
            options={cronSettings.map((cron) => ({
              value: cron.name,
              label: cron.name,
            }))}
            disabled={cronSettings.length === 0}
            loading={runCronLoading}
            selectAriaLabel="Trades cron selector"
            getConfirmOptions={(cronName) => ({
              title: "Run cron?",
              message: `Run cron "${cronName}" now?`,
              confirmLabel: "Run",
              tone: "danger",
            })}
          />
        }
      />

      <AdminPageToolbar
        className="trades-toolbar-panel"
        filters={
          <ResponsivePanel
            title="Filters"
            className="trades-filters-panel"
            headerMode="mobile"
            border="mobile"
            showToggle={false}
          >
            <div className="trades-toolbar-row">
              <div className="trades-toolbar-filters">
                <input
                  id="trades-search"
                  aria-label="Search"
                  placeholder="SEARCH..."
                  value={filter.q}
                  onChange={(e) => {
                    setFilter((f) => ({ ...f, q: e.target.value, page: 1 }));
                  }}
                />
                <FormComboSelect
                  id="trades-filter-account"
                  aria-label="Account"
                  value={filter.account_id}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      account_id: e.target.value,
                      page: 1,
                    }))
                  }
                >
                  <option value="">ALL ACCOUNTS</option>
                  {accounts.map((a, i) => (
                    <option
                      key={a.account_id || `acc-${i}`}
                      value={a.account_id}
                    >
                      {a.name || a.account_id}
                    </option>
                  ))}
                </FormComboSelect>
                <FormComboSelect
                  id="trades-filter-source"
                  aria-label="Source"
                  value={filter.source_id}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      source_id: e.target.value,
                      page: 1,
                    }))
                  }
                >
                  <option value="">ALL SOURCES</option>
                  {sources.map((s, i) => (
                    <option key={s.source_id || `src-${i}`} value={s.source_id}>
                      {s.name || s.source_id}
                    </option>
                  ))}
                </FormComboSelect>
                <FormComboSelect
                  id="trades-filter-side"
                  aria-label="Side"
                  value={filter.side}
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, side: e.target.value, page: 1 }))
                  }
                >
                  <option value="">ALL SIDES</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </FormComboSelect>
                <FormComboSelect
                  value={filter.execution_status}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilter((f) => ({ ...f, execution_status: v, page: 1 }));
                    navigate(v ? `/trades/${v.toLowerCase()}` : "/trades", {
                      replace: true,
                    });
                  }}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value || "all"} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </FormComboSelect>
                <FormComboSelect
                  id="trades-filter-pnl-state"
                  aria-label="PnL State"
                  value={filter.pnl_state || ""}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      pnl_state: String(e.target.value || "").toLowerCase(),
                      page: 1,
                    }))
                  }
                >
                  {PNL_STATE_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </FormComboSelect>
                <FormComboSelect
                  id="trades-filter-symbol"
                  aria-label="Symbol"
                  value={filter.symbol}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      symbol: e.target.value,
                      page: 1,
                    }))
                  }
                >
                  <option value="">ALL SYMBOLS</option>
                  {uniqueOptions.symbols.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </FormComboSelect>
                <FormComboSelect
                  id="trades-filter-range"
                  aria-label="Time Range"
                  value={filter.time || filter.range || "all"}
                  onChange={(e) => {
                    const v = String(e.target.value || "all");
                    setFilter((f) => ({ ...f, range: v, time: v, page: 1 }));
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.delete("page");
                      if (!v || v === "all") {
                        next.delete("time");
                        next.delete("range");
                      } else {
                        next.set("time", v);
                        next.delete("range");
                      }
                      return next;
                    });
                  }}
                >
                  {RANGE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </FormComboSelect>
              </div>
              <div className="trades-toolbar-bulk-actions">
                <BulkActionsButton
                  items={BULK_ACTIONS}
                  selectedItems={bulkAction}
                  onSelectedItemsChange={setBulkAction}
                  onClick={onBulkApply}
                  buttonText="RUN"
                  loading={bulkBusy}
                  selectId="trades-bulk-action"
                  ariaLabel="Bulk Action"
                  getConfirmOptions={(action) => {
                    const targetCount =
                      selectedIds.size > 0 ? selectedIds.size : rows.length;
                    const actionLabel =
                      BULK_ACTIONS.find((item) => item.value === action)
                        ?.label || action;
                    if (action === "delete_all") {
                      return {
                        title: "Delete trades?",
                        message: `Delete ${targetCount} trade(s)? This cannot be undone.`,
                        confirmLabel: "Delete",
                        tone: "danger",
                      };
                    }
                    return {
                      title: "Run bulk action?",
                      message: `${actionLabel} for ${targetCount} trade(s)?`,
                      confirmLabel: "Run",
                      tone: "danger",
                    };
                  }}
                />
              </div>
            </div>
          </ResponsivePanel>
        }
      />
      {createMsg ? (
        <div className="loading" style={{ padding: 10 }}>
          {createMsg}
        </div>
      ) : null}

      <div className="logs-layout-split">
        <ResponsivePanel
          title={`${total} trades`}
          open={isListSidebarOpen}
          onOpenChange={setIsListSidebarOpen}
          collapseDirection="left-right"
          className="logs-list-pane component-frozen-wrap"
          style={
            !isListSidebarOpen
              ? {
                  flex: "0 0 40px",
                  minWidth: 40,
                  width: 40,
                  overflow: "hidden",
                  padding: 5,
                }
              : listMode === "compact"
                ? {
                    flex: "0 0 150px",
                    minWidth: 200,
                    overflow: "hidden",
                    padding: 5,
                  }
                : { flex: "0 0 40%" }
          }
          headerActions={
            <>
              <PaginationBar
                page={filter.page}
                pages={pages}
                label={`${filter.page}/${pages}`}
                pageSize={filter.pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                showPageSize={false}
                onPageChange={(page) => setFilter((f) => ({ ...f, page }))}
                onPageSizeChange={(pageSize) =>
                  setFilter((f) => ({
                    ...f,
                    pageSize,
                    page: 1,
                  }))
                }
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setListMode(listMode === "compact" ? "full" : "compact")
                }
                title={
                  listMode === "compact" ? "Normal width" : "Compact width"
                }
                aria-label={
                  listMode === "compact"
                    ? "Switch to normal width"
                    : "Switch to compact width"
                }
                style={{
                  fontWeight: 700,
                }}
              >
                {listMode === "compact" ? "+" : "−"}
              </button>
            </>
          }
        >
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
                {sortedRows.map((t, i) => {
                  const isActive = tradeKeyOf(selectedTrade) === tradeKeyOf(t);
                  const action = String(t.action || t.side || "").toUpperCase();
                  const statusRaw = t.execution_status || "";
                  const stRaw = String(statusRaw).toUpperCase().trim();
                  const pnl =
                    asNum(t.broker_pnl) ??
                    asNum(t.pnl_realized) ??
                    asNum(t.net_pnl) ??
                    asNum(t.pnl) ??
                    asNum(t.pnl_money);
                  const tpPnl = asNum(
                    stRaw === "CLOSED" || stRaw === "TP" || stRaw === "SL"
                      ? t.entry_exec || t.entry
                      : t.broker_tp_pnl,
                  );
                  const slPnl = asNum(
                    stRaw === "CLOSED" || stRaw === "TP" || stRaw === "SL"
                      ? t.last_price || t.tp
                      : t.broker_sl_pnl,
                  );
                  const showCompactPnl =
                    (pnl != null &&
                      !["PENDING", "NEW", "PLACED"].includes(stRaw)) ||
                    (["PENDING", "NEW", "PLACED"].includes(stRaw) &&
                      (tpPnl != null || slPnl != null));
                  const rr = asNum(t.rr_planned) ?? calcRr(t);
                  return (
                    <article
                      key={t.sid || t.id || `row-${i}`}
                      onClick={() => {
                        const k = tradeKeyOf(t);
                        selectedTradeIdRef.current = k;
                        setSelectedTrade(t);
                        navigate(tradePath(t), { replace: true });
                      }}
                      style={{
                        cursor: "pointer",
                        padding: "4px 6px",
                        marginBottom: 3,
                        borderRadius: 6,
                        fontSize: 10,
                        border: isActive
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border)",
                        background: isActive
                          ? "rgba(255,255,255,0.05)"
                          : "transparent",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 10,
                            color: action === "SELL" ? "#ef5350" : "#26a69a",
                          }}
                        >
                          {t.symbol || "-"}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 10,
                            color:
                              pnl != null && pnl >= 0 ? "#10b981" : "#ef4444",
                          }}
                        >
                          {showCompactPnl ? (
                            ["PENDING", "NEW", "PLACED"].includes(stRaw) ? (
                              <span style={{ opacity: 0.72 }}>
                                {tpPnl != null ? (
                                  <span style={{ color: "#10b981" }}>
                                    +{Math.abs(tpPnl).toFixed(0)}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>
                                    -
                                  </span>
                                )}
                                <span
                                  style={{
                                    color: "var(--muted)",
                                    margin: "0 3px",
                                  }}
                                >
                                  /
                                </span>
                                {slPnl != null ? (
                                  <span style={{ color: "#ef4444" }}>
                                    -{Math.abs(slPnl).toFixed(0)}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>
                                    -
                                  </span>
                                )}
                              </span>
                            ) : pnl != null ? (
                              `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(0)}`
                            ) : (
                              ""
                            )
                          ) : (
                            ""
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginTop: 2,
                        }}
                      >
                        <span style={{ color: "var(--muted)", fontSize: 9 }}>
                          {t.entry || "-"} → {t.tp || "-"}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 9 }}>
                          {showCompactPnl && rr != null
                            ? rr.toFixed(1) + "R"
                            : ""}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={sortedRows}
                sorting={sorting}
                onSortingChange={onSortingChange}
                globalFilter={filter.q}
                emptyText="No trades found."
                rowClassName={(t) =>
                  tradeKeyOf(selectedTrade) === tradeKeyOf(t) ? "active" : ""
                }
                onRowClick={(t) => {
                  const k = tradeKeyOf(t);
                  selectedTradeIdRef.current = k;
                  setSelectedTrade(t);
                  navigate(tradePath(t), { replace: true });
                }}
              />
            )}
          </div>
        </ResponsivePanel>

        <ResponsivePanel
          showToggle={false}
          className="logs-detail-pane component-frozen-wrap"
          border="none"
          style={{ flex: 1, minWidth: 0 }}
        >
          {editBusy && (
            <div className="frozen-overlay">
              <div className="spinner" />
              <span>UPDATING...</span>
            </div>
          )}
          {notFound ? (
            <div className="empty-state" style={{ color: "var(--text)" }}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
                404
              </div>
              <div>Trade not found.</div>
              <div className="minor-text" style={{ marginTop: 4 }}>
                The trade may have been deleted or the ID is invalid.
              </div>
            </div>
          ) : !selectedTrade ? (
            <div className="empty-state">
              {rows.length === 0
                ? currentDetailHash === "chart-analysis" ||
                  currentDetailHash === "chart-live" ||
                  currentDetailHash === "chart-replay" ||
                  currentDetailHash === "chart-svg"
                  ? "NO TRADE SELECTED. OPEN /trades/<status>/<sid>#chart-analysis TO LOAD A TRADE CHART."
                  : "NO TRADES FOUND FOR THIS FILTER."
                : "SELECT A TRADE TO INSPECT DETAILS"}
            </div>
          ) : (
            <>
              <Suspense
                fallback={
                  <div className="loading-card">Loading Details...</div>
                }
              >
                <SignalDetailCard
                  key={`trade-detail-${tradeKeyOf(selectedTrade)}`}
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
                    sid: selectedTrade.sid || selectedTrade.signal_sid || "",
                    broker_trade_id:
                      selectedTrade.broker_trade_id ||
                      selectedTrade.ticket ||
                      selectedTrade.broker_id ||
                      "",
                    execution_status: selectedTrade.execution_status || "",
                    dispatch_status: selectedTrade.dispatch_status || "",
                    rejection_reason: selectedTrade.rejection_reason || "",
                    statusUi: statusUi(selectedTrade.execution_status),
                    value: detailPlan,
                    onChange: (k, v) =>
                      setDetailPlan((p) => applyLinkedPlanChange(p, k, v)),
                    onSave: onUpdateTradePlan,
                    onReset: () =>
                      selectedTrade &&
                      setDetailPlan({
                        ...extractTradePlanFromTrade(selectedTrade),
                        close_reason: selectedTrade?.close_reason || "",
                        rejection_reason: selectedTrade?.rejection_reason || "",
                      }),
                    onGoTrade: () =>
                      navigate(
                        `/ai/trade/${encodeURIComponent(
                          String(selectedTrade.symbol || "").toUpperCase(),
                        )}`,
                      ),
                    onGoAnalyze: () =>
                      navigate(
                        `/ai/analyze/${encodeURIComponent(
                          String(selectedTrade.symbol || "").toUpperCase(),
                        )}`,
                      ),
                    onAddTrade: !isDraftSelected ? onReEntryTrade : undefined,
                    showAddSignalButton: false,
                    showSaveButton: !["TP", "SL", "FAIL", "EXPIRED"].includes(
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase(),
                    ),
                    lockTradeFields: ["CLOSED", "CANCELLED"].includes(
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase(),
                    ),
                    lockMode: (() => {
                      const st = String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase();
                      if (st === "CLOSED" || st === "CANCELLED") return "all";
                      if (st === "FILLED") return "sideType";
                      return "none";
                    })(),
                    saveLabel: "Save",
                    showResetButton: true,
                    resetLabel: "Reset",
                    onPromote: isDraftSelected ? onApproveDraft : undefined,
                    promoteLabel: "Approve",
                    onCancel:
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase() === "PENDING"
                        ? async () => {
                            const ask = await confirm({
                              title: "Cancel Trade",
                              message: "Cancel this trade?",
                              confirmLabel: "Cancel Trade",
                              secondaryConfirmLabel: "Cancel & stay",
                              cancelLabel: "Cancel",
                              tone: "danger",
                              input: true,
                              inputPlaceholder: "Reason (optional)",
                            });
                            if (!ask || ask?.ok !== true) return;
                            const reason = String(ask?.value || "").trim();
                            const stay = ask?.action === "secondary";
                            try {
                              const { promise: cancelPromise } =
                                NotificationHub.track(
                                  "cancel_trade",
                                  {
                                    symbol: selectedTrade.symbol || "",
                                    sid: selectedTrade.sid || selectedTrade.id,
                                  },
                                  () =>
                                    api.cancelTrades({
                                      q: selectedTrade.sid || selectedTrade.id,
                                      reason: reason || "CANCEL",
                                    }),
                                );
                              await cancelPromise;
                              if (stay) {
                                selectedTradeIdRef.current = "";
                                navigate(`/trades/pending`, {
                                  replace: true,
                                });
                              } else {
                                navigate(
                                  `/trades/cancelled/${selectedTrade.sid || selectedTrade.id}`,
                                  { replace: true },
                                );
                              }
                              setSelectedTrade(null);
                              await loadTrades();
                            } catch (e) {
                              setError(e?.message || "Cancel failed");
                            }
                          }
                        : String(
                              selectedTrade.execution_status || "",
                            ).toUpperCase() === "DRAFT"
                          ? onCancelDraft
                          : null,
                    onClose:
                      String(
                        selectedTrade.execution_status || "",
                      ).toUpperCase() === "FILLED"
                        ? async () => {
                            const ask = await confirm({
                              title: "Close Trade",
                              message: "Close this trade?",
                              confirmLabel: "Close Trade",
                              secondaryConfirmLabel: "Close & stay",
                              cancelLabel: "Cancel",
                              tone: "danger",
                              input: true,
                              inputPlaceholder: "Reason (optional)",
                            });
                            if (!ask || ask?.ok !== true) return;
                            const reason = String(ask?.value || "").trim();
                            const stay = ask?.action === "secondary";
                            try {
                              const { promise: closePromise } =
                                NotificationHub.track(
                                  "close_trade",
                                  {
                                    symbol: selectedTrade.symbol || "",
                                    sid: selectedTrade.sid || selectedTrade.id,
                                  },
                                  () =>
                                    api.v2UpdateTrade(
                                      selectedTrade.sid || selectedTrade.id,
                                      {
                                        execution_status: "CLOSED",
                                        close_reason: reason || "MANUAL",
                                      },
                                    ),
                                );
                              await closePromise;
                              if (stay) {
                                selectedTradeIdRef.current = "";
                                navigate(`/trades/filled`, { replace: true });
                              } else {
                                navigate(
                                  `/trades/closed/${selectedTrade.sid || selectedTrade.id}`,
                                  { replace: true },
                                );
                              }
                              setSelectedTrade(null);
                              await loadTrades();
                            } catch (e) {
                              setError(e?.message || "Close failed");
                            }
                          }
                        : null,
                    viewOnly: ["TP", "SL", "FAIL", "EXPIRED"].includes(
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
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 6,
                            fontSize: 10,
                            color: "var(--muted)",
                          }}
                        >
                          <span
                            className="badge badge-mini"
                            style={{
                              fontSize: 9,
                              fontWeight: 400,
                              padding: "2px 6px",
                            }}
                          >
                            {String(
                              selectedTrade.sid ||
                                selectedTrade.signal_sid ||
                                "-",
                            ).trim() || "-"}
                          </span>
                          <span
                            className="badge badge-mini"
                            style={{
                              fontSize: 9,
                              fontWeight: 400,
                              padding: "2px 6px",
                            }}
                          >
                            {String(
                              selectedTrade.broker_trade_id ||
                                selectedTrade.ticket ||
                                selectedTrade.broker_id ||
                                "-",
                            ).trim() || "-"}
                          </span>
                          <span>|</span>
                          <span
                            className={`badge ${status.cls}`}
                            style={{ cursor: "pointer" }}
                            title="Edit trade status / PnL"
                            onClick={() => openTradeEditModal(selectedTrade)}
                          >
                            {status.label}
                          </span>
                        </div>
                      ),
                    });
                  })()}
                  chart={{
                    enabled: true,
                    tradeId: selectedTrade.sid || selectedTrade.id || "",
                    detailTfTab,
                    onDetailTfTabChange: setDetailTfTab,
                    iframeTitle: `trade-tv-${detailTfTab}`,
                    symbol: selectedTrade.symbol,
                    provider:
                      selectedTrade.account_metadata?.provider_code ||
                      selectedTrade.metadata?.provider_code ||
                      "",
                    interval:
                      selectedTrade.signal_tf || selectedTrade.chart_tf || "1h",
                    live: true,
                    entryPrice:
                      asNum(detailPlan.entry) || asNum(selectedTrade.entry),
                    slPrice: asNum(detailPlan.sl) || asNum(selectedTrade.sl),
                    tpPrice: asNum(detailPlan.tp) || asNum(selectedTrade.tp),
                    tp1Price:
                      asNum(detailPlan.tp1) ||
                      asNum(selectedTrade.tp1) ||
                      asNum(selectedTrade.tp),
                    tp2Price: asNum(detailPlan.tp2) || asNum(selectedTrade.tp2),
                    tp3Price: asNum(detailPlan.tp3) || asNum(selectedTrade.tp3),
                    onRequestPlanRefresh: handleDetailPlanChartRefresh,
                    planRefreshNonce: detailPlanChartRefreshNonce,
                    planRefreshError: detailPlanChartRefreshError,
                    onPlanLevelChange: (levelKey, levelValue) =>
                      setDetailPlan((p) =>
                        applyLinkedPlanChange(
                          p,
                          levelKey,
                          formatNum3(levelValue),
                        ),
                      ),
                    openedAt: selectedTrade.opened_at,
                    closedAt: selectedTrade.closed_at,
                    createdAt: selectedTrade.created_at,
                    closeStatus:
                      selectedTrade.close_reason ||
                      selectedTrade.execution_status ||
                      "",
                    exitPrice: asNum(selectedTrade.exit_price) || null,
                    pnlRealized:
                      asNum(selectedTrade.broker_pnl) ??
                      asNum(selectedTrade.pnl_realized) ??
                      null,
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
                      label: "Broker Name",
                      value:
                        selectedTrade.account_broker_name ||
                        selectedTrade.account_metadata?.broker_name ||
                        selectedTrade.metadata?.broker_name ||
                        "-",
                      group: "identity",
                    },
                    {
                      label: "Provider",
                      value:
                        selectedTrade.account_metadata?.provider_code ||
                        selectedTrade.metadata?.provider_code ||
                        "-",
                      group: "identity",
                    },
                    {
                      label: "Dispatch",
                      value: selectedTrade.dispatch_status || "-",
                      group: "identity",
                    },
                    {
                      label: "Account",
                      value:
                        accountById.get(String(selectedTrade.account_id || ""))
                          ?.name ||
                        selectedTrade.account_id ||
                        "-",
                      group: "identity",
                    },
                    {
                      label: "Broker Ticket",
                      value: getBrokerTicket(selectedTrade),
                      group: "identity",
                    },
                    {
                      label: "Broker Status",
                      value: selectedTrade.metadata?.broker_data?.status || "-",
                      group: "identity",
                    },
                    {
                      label: "Created",
                      value: showDateTime(selectedTrade.created_at),
                      group: "identity",
                    },
                    {
                      label: "Opened",
                      value: formatOpenedWithDuration(
                        selectedTrade.created_at,
                        resolveOpenedDisplayAt(selectedTrade),
                      ),
                      group: "identity",
                    },
                    {
                      label: "Closed",
                      value: formatClosedWithDuration(
                        resolveOpenedDisplayAt(selectedTrade),
                        selectedTrade.closed_at,
                      ),
                      group: "identity",
                    },
                    {
                      label: "Exit Price",
                      value:
                        asNum(selectedTrade.exit_price) != null
                          ? String(asNum(selectedTrade.exit_price))
                          : "-",
                      group: "identity",
                    },
                    {
                      label: "Broker PnL",
                      value: (() => {
                        const pnl =
                          asNum(selectedTrade.broker_pnl) ??
                          asNum(selectedTrade.pnl_realized) ??
                          asNum(selectedTrade.metadata?.broker_data?.net_pnl) ??
                          asNum(selectedTrade.metadata?.broker_data?.pnl) ??
                          null;
                        return pnl != null ? `$${Number(pnl).toFixed(2)}` : "-";
                      })(),
                      valueStyle: brokerPnlValueStyle(
                        asNum(selectedTrade.broker_pnl) ??
                          asNum(selectedTrade.pnl_realized) ??
                          asNum(selectedTrade.metadata?.broker_data?.net_pnl) ??
                          asNum(selectedTrade.metadata?.broker_data?.pnl) ??
                          null,
                      ),
                      group: "identity",
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
                          const bTpPnl = resolveDisplayedPlannedPnl(
                            selectedTrade,
                            "tp",
                          );
                          const bSlPnl = resolveDisplayedPlannedPnl(
                            selectedTrade,
                            "sl",
                          );

                          return [
                            bSlPnl != null
                              ? {
                                  label: "Planned SL Profit",
                                  value: `$${bSlPnl.toFixed(2)}`,
                                  group: "pnl",
                                  valueStyle: plannedPnlValueStyle("sl"),
                                }
                              : null,
                            bTpPnl != null
                              ? {
                                  label: "Planned TP Profit",
                                  value: `$${bTpPnl.toFixed(2)}`,
                                  group: "pnl",
                                  valueStyle: plannedPnlValueStyle("tp"),
                                }
                              : null,
                            {
                              label: "Last Synced",
                              value: selectedTrade.updated_at
                                ? showDateTime(selectedTrade.updated_at)
                                : "-",
                              group: "sizing",
                            },
                            bSwap != null
                              ? {
                                  label: "Swap",
                                  value: `$${bSwap.toFixed(2)}`,
                                  group: "sizing",
                                }
                              : null,
                            bMargin != null
                              ? {
                                  label: "Broker Margin",
                                  value: `$${bMargin.toFixed(2)}`,
                                  group: "sizing",
                                }
                              : null,
                            selectedTrade.margin != null
                              ? {
                                  label: "Margin",
                                  value: `$${Number(selectedTrade.margin).toFixed(2)}`,
                                  group: "sizing",
                                }
                              : null,
                            bComm != null
                              ? {
                                  label: "Commission",
                                  value: `$${bComm.toFixed(2)}`,
                                  group: "sizing",
                                }
                              : null,
                            bVol != null
                              ? {
                                  label: "Vol",
                                  value: `${bVol.toLocaleString()} units`,
                                  group: "sizing",
                                }
                              : null,
                            bLots != null
                              ? {
                                  label: "Lots",
                                  value: `${bLots.toFixed(2)} lots`,
                                  group: "sizing",
                                }
                              : null,
                          ].filter(Boolean);
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
                        formatDateTime: showDateTime,
                        includeTicket: true,
                      }),
                  }}
                  formatDateTime={showDateTime}
                />
              </Suspense>
              {createMode ? (
                <ResponsivePanel
                  title="CREATE TRADE"
                  collapseDirection="top-down"
                  style={{ padding: 12 }}
                  bodyClassName="stack-layout"
                >
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    }}
                  >
                    <FormComboSelect
                      value={createForm.action}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, action: e.target.value }))
                      }
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </FormComboSelect>
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
                </ResponsivePanel>
              ) : null}
            </>
          )}
        </ResponsivePanel>
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
              <FormComboSelect
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
              </FormComboSelect>
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
              <FormComboSelect
                value={editForm.account_id}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, account_id: e.target.value }))
                }
                style={{ gridColumn: "1 / -1" }}
              >
                <option value="">Account: None</option>
                {(Array.isArray(accounts) ? accounts : [])
                  .filter(
                    (a) => String(a?.status || "").toUpperCase() === "ACTIVE",
                  )
                  .map((a) => (
                    <option
                      key={a.account_id || a.name}
                      value={a.account_id || a.name || ""}
                    >
                      {a.name || a.account_id || "—"}
                    </option>
                  ))}
              </FormComboSelect>
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
