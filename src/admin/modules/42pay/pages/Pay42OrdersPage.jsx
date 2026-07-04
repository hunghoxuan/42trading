import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import DataTable from "../../../shared/components/DataTable";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import AdminPageToolbar from "../../../shared/components/AdminPageToolbar";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import Pay42MediaThumb from "./Pay42MediaThumb";
import {
  formatMoney,
  roleLabel,
  statusTone,
} from "./pay42Ui";

export default function Pay42OrdersPage({ authUser }) {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({
    q: "",
    status: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentRole = roleLabel(authUser);
  const title = currentRole === "seller" ? "42Pay Transactions" : "My Purchases";
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
    if (focusedSid) {
      return filteredItems.find((row) => String(row.sid || "") === focusedSid) || filteredItems[0] || null;
    }
    return filteredItems[0] || null;
  }, [filteredItems, focusedSid]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "sid",
        header: "ORDER",
        cell: ({ row }) => (
          <div className="cell-wrap">
            <strong>{row.original.sid}</strong>
            <span className="minor-text">
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
            <div className="cell-wrap">
              <strong>{row.original.product_name || "-"}</strong>
              <span className="minor-text">{row.original.seller_id || "-"}</span>
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
            className="minor-text"
            style={{
              color: statusTone(row.original.status),
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
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

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title={title}
        actions={
          <div className="pay42-inline-actions">
            {isBuyer ? (
              <>
                <Link className="secondary-button" to="/admin/42pay/topup">
                  Top Up
                </Link>
                <Link className="secondary-button" to="/admin/42pay/scan">
                  Scan to Pay
                </Link>
              </>
            ) : null}
            <button type="button" className="secondary-button" onClick={load}>
              Refresh
            </button>
          </div>
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
          </ResponsivePanel>
        }
      />

      {error ? <div className="error">{error}</div> : null}

      <div className={isBuyer ? "pay42-split-layout" : undefined}>
        {isBuyer ? (
          <ResponsivePanel
            title="Buyer Wallet"
            subtitle="Fast actions for scan, wallet funding, and purchase history"
            showToggle={false}
          >
            <div className="stack-layout">
              <p className="minor-text">
                Use the buyer scanner to pay a seller QR code, then review your booking confirmations here.
              </p>
              <div className="pay42-inline-actions">
                <Link className="primary-button" to="/admin/42pay/scan">
                  Open Scanner
                </Link>
                <Link className="secondary-button" to="/admin/42pay/topup">
                  Top Up Wallet
                </Link>
                <Link className="secondary-button" to="/admin/42pay/offers">
                  Browse Offers
                </Link>
              </div>
            </div>
          </ResponsivePanel>
        ) : null}

        <ResponsivePanel
          title={`${filteredItems.length} ${isBuyer ? "Purchases" : "Transactions"}`}
          subtitle={isBuyer ? "Buyer payment history and booking records" : "Seller order flow"}
          className="component-frozen-wrap"
          showToggle={false}
        >
          <DataTable
            columns={columns}
            data={filteredItems}
            loading={loading}
            emptyText="No orders yet."
            className="events-table"
          />
        </ResponsivePanel>

        {isBuyer ? (
          <ResponsivePanel
            title={selectedOrder ? "Purchase Detail" : "No Purchase Selected"}
            subtitle={
              selectedOrder
                ? focusedSid && selectedOrder.sid === focusedSid
                  ? "Latest confirmed purchase"
                  : "Selected purchase summary"
                : "Your next paid booking will appear here"
            }
            showToggle={false}
          >
            {selectedOrder ? (
              <div className="stack-layout" style={{ gap: 12 }}>
                <div className="cell-wrap">
                  <strong>{selectedOrder.product_name || "-"}</strong>
                  <span className="minor-text">{selectedOrder.offer_name || selectedOrder.sid}</span>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">TOTAL PAID</span>
                  <strong>{formatMoney(selectedOrder.total_amount || 0)}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">STATUS</span>
                  <strong style={{ color: statusTone(selectedOrder.status) }}>
                    {String(selectedOrder.status || "").toUpperCase()}
                  </strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">CONFIRMED AT</span>
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
            )}
          </ResponsivePanel>
        ) : null}
      </div>
    </section>
  );
}
