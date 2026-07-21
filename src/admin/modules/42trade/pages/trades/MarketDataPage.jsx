import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../app/api";
import MasterDetailLayout from "../../../../shared/components/MasterDetailLayout";
import ResponsivePanel from "../../../../shared/components/ResponsivePanel";
import CrudContainer from "../../../../shared/components/CrudContainer";
import DataTable from "../../../../shared/components/DataTable";
import ListItems from "../../../../shared/components/ListItems";
import TabBar from "../../../../shared/components/TabBar";
import { SmartContent } from "../../../../shared/components/SmartContent.jsx";
import { realtimeClient } from "../../realtime/realtimeClientSingleton";
import {
  normalizeSymbolList,
  SYMBOL_GROUPS_CONFIG,
} from "../../../../../config/symbolGroups.js";

function formatNumber(value, digits = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function compactDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function getSymbolGroups() {
  const groups = Array.isArray(SYMBOL_GROUPS_CONFIG?.groups)
    ? SYMBOL_GROUPS_CONFIG.groups
    : [];
  const allSymbols = normalizeSymbolList(
    groups.flatMap((group) => (Array.isArray(group?.symbols) ? group.symbols : [])),
  );
  return [
    { id: "all", name: "All", symbols: allSymbols },
    ...groups.map((group) => ({
      id: String(group?.id || group?.name || "").trim() || "group",
      name: String(group?.name || group?.id || "Group").trim(),
      symbols: normalizeSymbolList(group?.symbols),
    })),
  ];
}

function metadataForSymbol(items = [], symbol = "") {
  const wanted = String(symbol || "").trim().toUpperCase();
  if (!wanted) return null;
  return (
    items.find(
      (item) => String(item?.symbol || "").trim().toUpperCase() === wanted,
    ) || null
  );
}

function buildSymbolRows(groupSymbols = [], metadataItems = []) {
  const known = new Set();
  const rows = [];
  for (const symbol of groupSymbols) {
    const key = String(symbol || "").trim().toUpperCase();
    if (!key || known.has(key)) continue;
    known.add(key);
    rows.push({ symbol: key, metadata: metadataForSymbol(metadataItems, key) });
  }
  for (const item of metadataItems) {
    const key = String(item?.symbol || "").trim().toUpperCase();
    if (!key || known.has(key)) continue;
    known.add(key);
    rows.push({ symbol: key, metadata: item });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function FieldRow({ label, value }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "160px minmax(0, 1fr)",
        gap: 10,
        padding: "7px 0",
        borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
      }}
    >
      <span className="minor-text" style={{ fontSize: 11 }}>
        {label}
      </span>
      <strong style={{ fontSize: 12, wordBreak: "break-word" }}>
        {value == null || value === "" ? "-" : String(value)}
      </strong>
    </div>
  );
}

export default function MarketDataPage() {
  const symbolGroups = useMemo(() => getSymbolGroups(), []);
  const refreshTimerRef = useRef(null);
  const calibratedGroupKeysRef = useRef(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [metadataItems, setMetadataItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [calibrationNote, setCalibrationNote] = useState("");
  const [error, setError] = useState("");
  const [detailTab, setDetailTab] = useState("fields");
  const [detailOpen, setDetailOpen] = useState(true);

  const selectedGroup =
    symbolGroups.find((group) => group.id === selectedGroupId) ||
    symbolGroups[0] ||
    { symbols: [] };
  const symbolRows = useMemo(
    () => buildSymbolRows(selectedGroup.symbols, metadataItems),
    [metadataItems, selectedGroup.symbols],
  );
  const displayedSymbolRows = useMemo(() => {
    const query = String(symbolQuery || "").trim().toUpperCase();
    if (!query) return symbolRows;
    return symbolRows.filter((row) => row.symbol.includes(query));
  }, [symbolQuery, symbolRows]);
  const selectedMetadata = useMemo(
    () => metadataForSymbol(metadataItems, selectedSymbol),
    [metadataItems, selectedSymbol],
  );
  const tableColumns = useMemo(
    () => [
      {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => <strong>{row.original.symbol}</strong>,
        size: 120,
      },
      {
        id: "last_price",
        header: "Last",
        accessorFn: (row) => row.metadata?.last_price ?? "",
        cell: ({ row }) => formatNumber(row.original.metadata?.last_price, 5),
      },
      {
        id: "bid",
        header: "Bid",
        accessorFn: (row) => row.metadata?.bid ?? "",
        cell: ({ row }) => formatNumber(row.original.metadata?.bid, 5),
      },
      {
        id: "ask",
        header: "Ask",
        accessorFn: (row) => row.metadata?.ask ?? "",
        cell: ({ row }) => formatNumber(row.original.metadata?.ask, 5),
      },
      {
        id: "pip_size",
        header: "Pip Size",
        accessorFn: (row) => row.metadata?.pip_size ?? "",
        cell: ({ row }) => row.original.metadata?.pip_size ?? "-",
      },
      {
        id: "min_stop_pips",
        header: "Min Stop",
        accessorFn: (row) => row.metadata?.min_stop_pips ?? "",
        cell: ({ row }) => row.original.metadata?.min_stop_pips ?? "-",
      },
      {
        id: "spread_pips",
        header: "Spread",
        accessorFn: (row) => row.metadata?.spread_pips ?? "",
        cell: ({ row }) => row.original.metadata?.spread_pips ?? "-",
      },
      {
        id: "provider",
        header: "Provider",
        accessorFn: (row) => row.metadata?.provider ?? "",
        cell: ({ row }) => row.original.metadata?.provider || "-",
      },
      {
        id: "updated_at",
        header: "Updated",
        accessorFn: (row) => row.metadata?.updated_at ?? "",
        cell: ({ row }) => compactDate(row.original.metadata?.updated_at),
      },
    ],
    [],
  );

  const loadMetadata = useCallback(async ({ background = false } = {}) => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await api.brokerSymbolMetadata();
      const items = Array.isArray(res?.items) ? res.items : [];
      setMetadataItems(items);
      setSelectedSymbol((current) => {
        const normalized = String(current || "").trim().toUpperCase();
        const nextRows = buildSymbolRows(selectedGroup.symbols, items).filter((row) => {
          const query = String(symbolQuery || "").trim().toUpperCase();
          return !query || row.symbol.includes(query);
        });
        if (normalized && nextRows.some((row) => row.symbol === normalized)) {
          return normalized;
        }
        return nextRows[0]?.symbol || "";
      });
    } catch (err) {
      if (!background) {
        const message = String(err?.message || err || "Failed to load symbol metadata");
        if (/404|not found/i.test(message)) {
          setMetadataItems([]);
          setError("");
        } else {
          setError(message);
        }
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [selectedGroup.symbols, symbolQuery]);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadMetadata({ background: true });
    }, 450);
  }, [loadMetadata]);

  useEffect(() => {
    void loadMetadata();
    // Load once on mount; group changes only affect local filtering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const shouldRefreshForPayload = (payload = {}) => {
      const eventName = String(payload?.event || payload?.type || "").trim().toUpperCase();
      if (
        [
          "BROKER_SYNC",
          "TICK_PUSH",
          "BROKER_TICK_PUSH",
          "BROKER_PRICE_PUSH",
          "BROKER_PRICES",
          "BROKER_PRICES_SYNC",
          "BROKER_SYMBOL_METADATA_UPDATE",
        ].includes(eventName)
      ) {
        return true;
      }
      const symbols = [
        ...(Array.isArray(payload?.symbols) ? payload.symbols : []),
        ...(Array.isArray(payload?.data)
          ? payload.data.map((item) => item?.symbol || item?.s)
          : []),
        payload?.symbol,
        payload?.s,
      ]
        .map((symbol) => String(symbol || "").trim())
        .filter(Boolean);
      return (
        symbols.length > 0 &&
        String(payload?.source_type || "").toLowerCase().includes("broker")
      );
    };
    const handleMt5Realtime = (event) => {
      if (shouldRefreshForPayload(event?.detail || {})) {
        scheduleRealtimeRefresh();
      }
    };
    const handleHubEvent = (event) => {
      const detail = event?.detail || {};
      if (shouldRefreshForPayload(detail?.payload || detail || {})) {
        scheduleRealtimeRefresh();
      }
    };
    window.addEventListener("mt5-realtime-event", handleMt5Realtime);
    window.addEventListener("hub-event", handleHubEvent);
    const unsubscribeBrokerRealtime = realtimeClient.subscribe(
      "broker:self",
      {},
      (envelope) => {
        if (shouldRefreshForPayload(envelope?.data || {})) {
          scheduleRealtimeRefresh();
        }
      },
      {
        onError: () => {},
      },
    );
    return () => {
      window.removeEventListener("mt5-realtime-event", handleMt5Realtime);
      window.removeEventListener("hub-event", handleHubEvent);
      unsubscribeBrokerRealtime();
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [scheduleRealtimeRefresh]);

  useEffect(() => {
    if (!displayedSymbolRows.length) {
      setSelectedSymbol("");
      return;
    }
    if (!displayedSymbolRows.some((row) => row.symbol === selectedSymbol)) {
      setSelectedSymbol(displayedSymbolRows[0].symbol);
    }
  }, [displayedSymbolRows, selectedSymbol]);

  useEffect(() => {
    const missingRows = displayedSymbolRows.filter((row) => {
      const item = row.metadata || {};
      return !item.pip_size || !item.min_stop_pips;
    });
    if (!missingRows.length || calibrationLoading) return;
    const groupKey = `${selectedGroupId}:${symbolQuery}:${missingRows.map((row) => row.symbol).join(",")}`;
    if (calibratedGroupKeysRef.current.has(groupKey)) return;
    calibratedGroupKeysRef.current.add(groupKey);
    const symbols = missingRows.slice(0, 30).map((row) => row.symbol);
    setCalibrationLoading(true);
    setCalibrationNote(`Calibrating ${symbols.length} symbols...`);
    api
      .brokerSymbolMetadataCalibrate({ symbols })
      .then((res) => {
        const items = Array.isArray(res?.items) ? res.items : [];
        if (items.length) setMetadataItems(items);
        const okCount = Array.isArray(res?.results)
          ? res.results.filter((item) => item?.ok).length
          : 0;
        setCalibrationNote(
          okCount > 0
            ? `Calibrated ${okCount}/${symbols.length} symbols.`
            : "No broker calibration data returned yet.",
        );
      })
      .catch((err) => {
        setCalibrationNote(String(err?.message || err || "Calibration unavailable"));
      })
      .finally(() => {
        setCalibrationLoading(false);
      });
  }, [calibrationLoading, displayedSymbolRows, selectedGroupId, symbolQuery]);

  const sidebar = (
    <ResponsivePanel
      title="Symbol Groups"
      showToggle={false}
      border="always"
      bodyClassName="stack-layout"
    >
      <ListItems style={{ gap: 8 }}>
        {symbolGroups.map((group) => {
          const active = group.id === selectedGroupId;
          return (
            <button
              key={group.id}
              type="button"
              className={`card-item${active ? " selected-item" : ""}`}
              onClick={() => setSelectedGroupId(group.id)}
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>{group.name}</strong>
              <span className="minor-text" style={{ fontSize: 11 }}>
                {group.symbols.length}
              </span>
            </button>
          );
        })}
      </ListItems>
    </ResponsivePanel>
  );

  const detailFields = selectedMetadata
    ? [
        ["Symbol", selectedMetadata.symbol],
        ["Provider", selectedMetadata.provider],
        ["Account", selectedMetadata.account_id],
        ["Broker Symbol", selectedMetadata.broker_symbol],
        ["Last Price", formatNumber(selectedMetadata.last_price, 5)],
        ["Bid / Ask", `${formatNumber(selectedMetadata.bid, 5)} / ${formatNumber(selectedMetadata.ask, 5)}`],
        ["Pip Size", selectedMetadata.pip_size],
        ["Pip Value", selectedMetadata.pip_value],
        ["Min Stop Pips", selectedMetadata.min_stop_pips],
        ["Min Stop Distance", selectedMetadata.min_stop_price_distance],
        ["Spread", selectedMetadata.spread_pips],
        ["Digits", selectedMetadata.digits],
        ["Volume Min", selectedMetadata.min_volume_units],
        ["Volume Step", selectedMetadata.step_volume_units],
        ["Last Price At", compactDate(selectedMetadata.last_price_at)],
        ["Updated", compactDate(selectedMetadata.updated_at)],
        ["Source", selectedMetadata.source],
      ]
    : [];

  const detail = (
    <CrudContainer
      sameHeight={false}
      detailVisible={Boolean(selectedSymbol)}
      detailOpen={detailOpen}
      onDetailOpenChange={setDetailOpen}
      detailCloseButton
      list={{
        title: "Market Data",
        subtitle: `${selectedGroup.name || "Group"} · ${displayedSymbolRows.length}/${symbolRows.length} symbols`,
        headerActions: (
          <>
            <input
              type="search"
              className="input"
              placeholder="#Symbol"
              value={symbolQuery}
              onChange={(event) => setSymbolQuery(event.target.value)}
              style={{ minWidth: 140, maxWidth: 180 }}
            />
            {!detailOpen && selectedSymbol ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDetailOpen(true)}
              >
                Open Detail
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={loadMetadata}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </>
        ),
        children: (
          <>
            {error ? (
              <div className="minor-text msg-error" style={{ marginBottom: 10 }}>
                {error}
              </div>
            ) : null}
            {calibrationNote ? (
              <div className="minor-text" style={{ marginBottom: 10 }}>
                {calibrationLoading ? "Refreshing broker metadata. " : ""}
                {calibrationNote}
              </div>
            ) : null}
              <DataTable
              columns={tableColumns}
              data={displayedSymbolRows}
              loading={loading}
              emptyText="No symbols found for this group."
              className="events-table events-table--compact"
              mode="list"
              getRowId={(row) => row.symbol}
              selectedRowId={selectedSymbol || null}
              onRowClick={(row) => {
                setSelectedSymbol(row.symbol);
                setDetailOpen(true);
              }}
              mobileCard={{
                getTitle: (row) => row.symbol,
                getSubtitle: (row) => row.metadata?.provider || "No broker metadata",
                getAmount: (row) => ({
                  value: formatNumber(row.metadata?.last_price, 5),
                  subvalue: "last",
                }),
                getRows: (row) => [
                  [
                    { value: `Bid ${formatNumber(row.metadata?.bid, 5)}` },
                    { value: `Ask ${formatNumber(row.metadata?.ask, 5)}` },
                  ],
                  [
                    { value: `Pip ${row.metadata?.pip_size ?? "-"}` },
                    { value: `Min stop ${row.metadata?.min_stop_pips ?? "-"}` },
                  ],
                ],
                getFooterText: (row) => compactDate(row.metadata?.updated_at),
              }}
            />
          </>
        ),
      }}
      detail={{
        title: selectedSymbol ? `${selectedSymbol} Detail` : "Symbol Detail",
        children: (
          <>
            <TabBar
              value={detailTab}
              onChange={setDetailTab}
              options={[
                { value: "fields", label: "Fields" },
                { value: "json", label: "Json" },
              ]}
              className="snapshot-tabs-v2"
              style={{ marginBottom: 12 }}
            />
            {!selectedSymbol ? (
              <div className="empty-state">Select a symbol to inspect metadata.</div>
            ) : !selectedMetadata ? (
              <div className="empty-state">
                No broker metadata saved for {selectedSymbol} yet. It will appear after broker sync or price push.
              </div>
            ) : detailTab === "json" ? (
              <SmartContent content={selectedMetadata} mode="readonly" showCopy />
            ) : (
              <div>
                {detailFields.map(([label, value]) => (
                  <FieldRow key={label} label={label} value={value} />
                ))}
              </div>
            )}
          </>
        ),
      }}
    />
  );

  return (
    <section className="page-section">
      <div className="page-title">MARKET DATA</div>
      <MasterDetailLayout sidebar={sidebar} detail={detail} sidebarWidth={300} />
    </section>
  );
}
