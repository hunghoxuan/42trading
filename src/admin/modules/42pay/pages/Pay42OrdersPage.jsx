import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import ComboButtonMenu from "../../../shared/components/ComboButtonMenu";
import CrudContainer from "../../../shared/components/CrudContainer";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import Pay42MediaThumb from "./Pay42MediaThumb";
import Pay42PageShell from "./Pay42PageShell";
import {
  formatMoney,
  roleLabel,
  statusTone,
} from "./pay42Ui";

const TABLE_MODE_ITEMS = [
  { value: "table", label: "Table" },
  { value: "grid", label: "Grid" },
  { value: "cards", label: "Cards" },
  { value: "carousel", label: "Carousel" },
];

export default function Pay42OrdersPage({ authUser }) {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({
    q: "",
    status: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tableMode, setTableMode] = useState("table");
  const [selectedOrderSid, setSelectedOrderSid] = useState("");

  const currentRole = roleLabel(authUser);
  const title = currentRole === "seller" ? "Transactions" : "My Purchases";
  const isBuyer = currentRole === "buyer";
  const focusedSid = String(searchParams.get("focus") || "").trim();

  async function load() {
    try {
      setLoading(true);
      setError("");
      const out = await api.pay42Orders();
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (nextError) {
      setError(nextError?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredItems = useMemo(() => {
    const query = String(filter.q || "").trim().toLowerCase();
    return items.filter((row) => {
      if (filter.status && String(row.status || "") !== filter.status) return false;
      if (!query) return true;
      const haystack = [
        row.sid,
        row.product_name,
        row.offer_name,
        row.buyer_id,
        row.seller_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, items]);

  const selectedOrder = useMemo(() => {
    const preferredSid = String(selectedOrderSid || focusedSid || "").trim();
    if (preferredSid) {
      return (
        filteredItems.find((row) => String(row.sid || "") === preferredSid) ||
        filteredItems[0] ||
        null
      );
    }
    return filteredItems[0] || null;
  }, [filteredItems, focusedSid, selectedOrderSid]);

  useEffect(() => {
    if (focusedSid) {
      setSelectedOrderSid(focusedSid);
      return;
    }
    setSelectedOrderSid((current) => current || String(filteredItems[0]?.sid || ""));
  }, [filteredItems, focusedSid]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "sid",
        header: "ORDER",
        cell: ({ row }) => (
          <div className="cell-wrap ui-data-stack">
            <strong className="ui-data-title">{row.original.sid}</strong>
            <span className="ui-data-meta">
              {row.original.offer_name || row.original.product_offer_id || "-"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "product_name",
        header: "PRODUCT",
        cell: ({ row }) => (
          <div className="pay42-cell-media">
            <Pay42MediaThumb
              src={row.original.product_image}
              alt={row.original.product_name || row.original.sid}
              label={row.original.product_name || row.original.sid}
              className="pay42-thumb"
            />
            <div className="cell-wrap ui-data-stack">
              <strong className="ui-data-title">{row.original.product_name || "-"}</strong>
              <span className="ui-data-meta">{row.original.seller_id || "-"}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "buyer_id",
        header: "BUYER",
        cell: ({ row }) => row.original.buyer_id || "-",
      },
      {
        accessorKey: "status",
        header: "STATUS",
        cell: ({ row }) => (
          <span
            className={[
              "badge",
              "badge-mini",
              String(row.original.status || "-").toUpperCase(),
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {String(row.original.status || "-").toUpperCase()}
          </span>
        ),
      },
      {
        accessorKey: "total_amount",
        header: "TOTAL",
        cell: ({ row }) => formatMoney(row.original.total_amount || 0),
      },
      {
        accessorKey: "create_at",
        header: "CREATED",
        cell: ({ row }) => showDateTime(row.original.create_at),
      },
    ],
    [],
  );

  const mobileCard = useMemo(
    () => ({
      getImageSrc: (row) => row.product_image || "",
      getImageAlt: (row) => row.product_name || row.sid,
      getImageLabel: (row) => row.product_name || row.sid,
      getTitle: (row) => row.product_name || row.sid || "-",
      getSubtitle: (row) => row.offer_name || row.sid || "",
      getAmount: (row) => ({
        value: formatMoney(row.total_amount || 0),
        tone: "accent",
        subvalue: showDateTime(row.create_at),
      }),
      getBadges: (row) => [
        {
          label: String(row.status || "-").toUpperCase(),
          tone: String(row.status || "-").toUpperCase(),
        },
      ],
      getRows: (row) => [
        [{ value: row.sid || "-" }],
        [
          { value: row.buyer_id || "-" },
          { value: row.seller_id || "-" },
        ],
      ],
    }),
    [],
  );

  return (
    <Pay42PageShell>
      <PageHeader className="trades-page-header" title={title} />

      {error ? <div className="error">{error}</div> : null}

      {isBuyer ? (
        <ResponsivePanel
          title="Buyer Wallet"
          subtitle="Fast actions for scan, wallet funding, and purchase history"
          showToggle={false}
        >
          <div className="stack-layout">
            <p className="minor-text">
              Use Pay to scan a seller QR code, or complete card and gift card flows before reviewing confirmations here.
            </p>
            <div className="pay42-inline-actions">
              <Link className="primary-button" to="/admin/42pay/scan">
                Open Pay
              </Link>
              <Link className="secondary-button" to="/admin/42pay/topup">
                Top Up Wallet
              </Link>
              <Link className="secondary-button" to="/admin/42pay/dashboard">
                Points
              </Link>
            </div>
          </div>
        </ResponsivePanel>
      ) : null}

      <CrudContainer
        className={isBuyer ? "pay42-crud-layout" : ""}
        toolbar={{
          displayMode: "top",
          filters: (
            <div className="trades-toolbar-row">
              <div className="trades-toolbar-filters">
                <input
                  value={filter.q}
                  placeholder="SEARCH ORDERS..."
                  onChange={(e) =>
                    setFilter((prev) => ({ ...prev, q: e.target.value }))
                  }
                />
                <InputComboSelect
                  value={filter.status}
                  onChange={(e) =>
                    setFilter((prev) => ({ ...prev, status: e.target.value }))
                  }
                >
                  <option value="">ALL STATUS</option>
                  <option value="CREATED">CREATED</option>
                  <option value="PAID">PAID</option>
                  <option value="COMPLETED">COMPLETED</option>
                </InputComboSelect>
              </div>
            </div>
          ),
          actions: (
            <div className="pay42-inline-actions">
              {isBuyer ? (
                <>
                  <Link className="primary-button" to="/admin/42pay/topup">
                    Top Up
                  </Link>
                  <Link className="primary-button" to="/admin/42pay/scan">
                    Pay
                  </Link>
                </>
              ) : null}
            </div>
          ),
          actionItems: [
            {
              key: "refresh-orders",
              label: "Refresh orders",
              onClick: load,
              className: "secondary-button",
              ariaLabel: "Refresh orders",
              title: "Refresh orders",
              children: "↻",
            },
          ],
        }}
        detailVisible={isBuyer}
        detailOpen={isBuyer && Boolean(selectedOrder)}
        onDetailOpenChange={(open) => {
          if (open) return;
          setSelectedOrderSid("");
        }}
        detailCloseButton
        list={{
          title: `${filteredItems.length} ${isBuyer ? "Purchases" : "Transactions"}`,
          subtitle: isBuyer ? "Buyer payment history and booking records" : "Seller order flow",
          panelClassName: "component-frozen-wrap",
          headerActions: (
            <ComboButtonMenu
              selectId="pay42-orders-mode"
              value={tableMode}
              buttonText={`Mode: ${TABLE_MODE_ITEMS.find((item) => item.value === tableMode)?.label || "Table"}`}
              onChange={setTableMode}
              items={TABLE_MODE_ITEMS}
              ariaLabel="Select orders view mode"
              align="end"
              sideOffset={6}
              triggerClassName="data-table-mode-switcher"
            />
          ),
          tableProps: {
            columns,
            data: filteredItems,
            loading,
            emptyText: "No orders yet.",
            className: "events-table events-table--compact",
            onRowClick: isBuyer ? (row) => setSelectedOrderSid(String(row.sid || "")) : undefined,
            mode: tableMode,
            onModeChange: setTableMode,
            getRowId: (row) => row.sid,
            selectedRowId: selectedOrder?.sid || null,
            mobileCard,
          },
        }}
        detail={{
          title: selectedOrder ? "Purchase Detail" : "No Purchase Selected",
          subtitle:
            selectedOrder
              ? focusedSid && selectedOrder.sid === focusedSid
                ? "Latest confirmed purchase"
                : "Selected purchase summary"
              : "Your next paid booking will appear here",
          children: selectedOrder ? (
            <div className="stack-layout" style={{ gap: 12 }}>
              <div className="cell-wrap ui-data-stack">
                <strong className="ui-data-title">{selectedOrder.product_name || "-"}</strong>
                <span className="ui-data-meta">{selectedOrder.offer_name || selectedOrder.sid}</span>
              </div>
              <div className="pay42-stat-card">
                <span className="ui-field-label">TOTAL PAID</span>
                <strong>{formatMoney(selectedOrder.total_amount || 0)}</strong>
              </div>
              <div className="pay42-stat-card">
                <span className="ui-field-label">STATUS</span>
                <strong style={{ color: statusTone(selectedOrder.status) }}>
                  {String(selectedOrder.status || "").toUpperCase()}
                </strong>
              </div>
              <div className="pay42-stat-card">
                <span className="ui-field-label">CONFIRMED AT</span>
                <strong>{showDateTime(selectedOrder.create_at)}</strong>
              </div>
              <div className="pay42-inline-actions">
                <Link
                  className="primary-button"
                  to={`/admin/42pay/orders/${encodeURIComponent(selectedOrder.sid)}/confirmation`}
                >
                  Open Confirmation
                </Link>
              </div>
            </div>
          ) : (
            <div className="minor-text">No purchases yet.</div>
          ),
        }}
      />
    </Pay42PageShell>
  );
}
