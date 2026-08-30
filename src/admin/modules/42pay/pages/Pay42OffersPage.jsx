import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import ComboButtonMenu from "../../../shared/components/ComboButtonMenu";
import CrudContainer from "../../../shared/components/CrudContainer";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import PaginationBar from "../../../shared/components/PaginationBar";
import DateTimePicker from "../../../shared/components/DateTimePicker";
import { showToast } from "../../../shared/components/ToastContainer";
import Pay42MediaThumb from "./Pay42MediaThumb";
import Pay42PageShell from "./Pay42PageShell";
import {
  formatMoney,
  roleLabel,
} from "./pay42Ui";

function emptyOfferForm() {
  return {
    sid: "",
    product_id: "",
    price: "",
    tax: "",
    start_at: "",
    end_at: "",
    offer_name: "",
    qr_code: "",
    qr_code_image: "",
  };
}

function validateOfferForm(form = {}) {
  if (!String(form.product_id || "").trim()) {
    return "Select a product before saving the offer.";
  }
  if (!String(form.offer_name || "").trim()) {
    return "Offer name is required.";
  }
  if (Number(form.price || 0) <= 0) {
    return "Price must be greater than 0.";
  }
  return "";
}

const MOBILE_BREAKPOINT = 768;
const TABLE_MODE_ITEMS = [
  { value: "table", label: "Table" },
  { value: "grid", label: "Grid" },
  { value: "cards", label: "Cards" },
  { value: "carousel", label: "Carousel" },
];

export default function Pay42OffersPage({ authUser }) {
  const [searchParams] = useSearchParams();
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [isMobileEditor, setIsMobileEditor] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  const [detailOpen, setDetailOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= MOBILE_BREAKPOINT : true,
  );
  const [form, setForm] = useState(emptyOfferForm());
  const [filter, setFilter] = useState({
    q: "",
    status: "",
    product_id: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tableMode, setTableMode] = useState("table");

  const currentRole = roleLabel(authUser);
  const canManage = currentRole === "seller" || currentRole === "admin";

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [offersOut, productsOut] = await Promise.all([
        api.pay42Offers(),
        // The buyer-facing version of this page is labelled "Points". Buyers can read
        // active offers, but deliberately do not have products.read permission; requesting
        // that seller/admin resource is masked by the API as a 404 "Not found".
        canManage ? api.pay42Products() : Promise.resolve({ items: [] }),
      ]);
      setOffers(Array.isArray(offersOut?.items) ? offersOut.items : []);
      setProducts(Array.isArray(productsOut?.items) ? productsOut.items : []);
    } catch (nextError) {
      setError(nextError?.message || "Failed to load offers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [canManage]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (event) => setIsMobileEditor(event.matches);
    setIsMobileEditor(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const filteredOffers = useMemo(() => {
    const query = String(filter.q || "").trim().toLowerCase();
    return offers.filter((row) => {
      if (filter.status && String(row.status || "") !== filter.status) return false;
      if (filter.product_id && String(row.product_id || "") !== filter.product_id) return false;
      if (!query) return true;
      const haystack = [
        row.sid,
        row.product_name,
        row.metadata?.offer_name,
        row.type,
        row.seller_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, offers]);

  const totalPages = Math.max(1, Math.ceil(filteredOffers.length / pageSize));
  const pagedOffers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredOffers.slice(start, start + pageSize);
  }, [filteredOffers, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filter.q, filter.product_id, filter.status, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const seededProductId = String(searchParams.get("product_id") || "").trim();
    const wantsNew = String(searchParams.get("new") || "").trim() === "1";
    if (!seededProductId) return;
    setFilter((current) => ({ ...current, product_id: seededProductId }));
    setForm((current) => ({
      ...emptyOfferForm(),
      product_id: seededProductId,
      offer_name: wantsNew ? current.offer_name || "" : current.offer_name,
    }));
    if (wantsNew) setDetailOpen(true);
  }, [searchParams, isMobileEditor]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "product_name",
        header: "OFFER",
        cell: ({ row }) => (
            <div className="pay42-cell-media">
              <Pay42MediaThumb
                src={row.original.product_image}
                alt={row.original.product_name || row.original.sid}
                label={row.original.product_name || row.original.sid}
                className="pay42-thumb"
              />
            <div className="cell-wrap ui-data-stack">
              <strong className="ui-data-title">
                {row.original.metadata?.offer_name || row.original.product_name || "-"}
              </strong>
              <span className="ui-data-meta">{row.original.sid}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "product_name2",
        header: "PRODUCT",
        cell: ({ row }) => row.original.product_name || "-",
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
        accessorKey: "total",
        header: "TOTAL",
        cell: ({ row }) =>
          formatMoney(Number(row.original.price || 0) + Number(row.original.tax || 0)),
      },
      {
        accessorKey: "end_at",
        header: "VALID UNTIL",
        cell: ({ row }) => showDateTime(row.original.end_at),
      },
      {
        accessorKey: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="pay42-row-actions">
            <button
              type="button"
              className="secondary-button icon-button"
              title="Edit offer"
              aria-label={`Edit offer ${row.original.sid || ""}`}
              onClick={(e) => {
                e.stopPropagation();
                selectOffer(row.original);
              }}
            >
              ✏
            </button>
            <Link
              className="secondary-button icon-button pay42-row-action-link"
              title="Payment QR"
              aria-label={`Payment QR for offer ${row.original.sid || ""}`}
              to={`/admin/42pay/offers/${encodeURIComponent(row.original.sid || "")}/payment`}
              onClick={(e) => e.stopPropagation()}
            >
              💳
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  const mobileCard = useMemo(
    () => ({
      getImageSrc: (row) => row.product_image || "",
      getImageAlt: (row) => row.product_name || row.sid,
      getImageLabel: (row) => row.product_name || row.sid,
      getTitle: (row) => row.metadata?.offer_name || row.product_name || "-",
      getSubtitle: (row) => row.sid || "",
      getAmount: (row) => ({
        value: formatMoney(Number(row.price || 0) + Number(row.tax || 0)),
        tone: "accent",
        subvalue: showDateTime(row.end_at),
      }),
      getBadges: (row) => [
        {
          label: String(row.status || "-").toUpperCase(),
          tone: String(row.status || "-").toUpperCase(),
        },
      ],
      getRows: (row) => [
        [{ value: row.product_name || "-" }],
        [
          { value: `Base ${formatMoney(row.price)}` },
          { value: `Tax ${formatMoney(row.tax)}` },
        ],
      ],
      getFooterText: (row) => showDateTime(row.end_at).replace(" ", " · "),
    }),
    [],
  );

  async function submitOffer() {
    try {
      setSaving(true);
      setError("");
      const validationError = validateOfferForm(form);
      if (validationError) {
        setError(validationError);
        return;
      }
      const payload = {
        sid: form.sid || undefined,
        product_id: form.product_id,
        price: Number(form.price || 0),
        tax: Number(form.tax || 0),
        status: "ACTIVE",
        start_at: form.start_at,
        end_at: form.end_at,
        metadata: {
          offer_name: form.offer_name,
        },
      };
      if (form.sid) {
        const out = await api.pay42UpdateOffer(form.sid, payload);
        const nextOffer = out?.offer || null;
        if (nextOffer) {
          setForm((prev) => ({
            ...prev,
            sid: nextOffer.sid || prev.sid,
            qr_code: nextOffer.qr_code || "",
            qr_code_image: nextOffer.qr_code_image || "",
          }));
        }
      } else {
        const out = await api.pay42CreateOffer(payload);
        const nextOffer = out?.offer || null;
        if (nextOffer) {
          setForm({
            sid: nextOffer.sid || "",
            product_id: nextOffer.product_id || "",
            price: String(nextOffer.price || ""),
            tax: String(nextOffer.tax || ""),
            start_at: nextOffer.start_at || "",
            end_at: nextOffer.end_at || "",
            offer_name: nextOffer.metadata?.offer_name || "",
            qr_code: nextOffer.qr_code || "",
            qr_code_image: nextOffer.qr_code_image || "",
          });
        }
      }
      showToast({ type: "success", message: "42Pay offer saved." });
      await load();
    } catch (nextError) {
      setError(nextError?.message || "Failed to save offer");
    } finally {
      setSaving(false);
    }
  }

  function selectOffer(row) {
    setForm({
      sid: row.sid,
      product_id: row.product_id || "",
      price: String(row.price || ""),
      tax: String(row.tax || ""),
      start_at: row.start_at || "",
      end_at: row.end_at || "",
      offer_name: row.metadata?.offer_name || "",
      qr_code: row.qr_code || "",
      qr_code_image: row.qr_code_image || "",
    });
    setDetailOpen(true);
  }

  function startNewOffer() {
    setForm(emptyOfferForm());
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  const offerFormPanel = (
      <div className="pay42-form-grid pay42-offer-form-grid">
        <label className="pay42-form-field pay42-form-field--full">
          <span className="ui-field-label">PRODUCT</span>
          <InputComboSelect
            value={form.product_id}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, product_id: e.target.value }))
            }
          >
            <option value="">SELECT PRODUCT</option>
            {products.map((product) => (
              <option key={product.sid} value={product.sid}>
                {product.name}
              </option>
            ))}
          </InputComboSelect>
        </label>
        {form.product_id ? (
          <>
            <label className="pay42-form-field pay42-form-field--full">
              <span className="ui-field-label">OFFER NAME</span>
              <input
                value={form.offer_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, offer_name: e.target.value }))
                }
                placeholder="2 Nights Skyline Escape"
              />
            </label>
            <label className="pay42-form-field">
              <span className="ui-field-label">PRICE</span>
              <input
                value={form.price}
                onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                placeholder="680"
              />
            </label>
            <label className="pay42-form-field">
              <span className="ui-field-label">TAX</span>
              <input
                value={form.tax}
                onChange={(e) => setForm((prev) => ({ ...prev, tax: e.target.value }))}
                placeholder="47.6"
              />
            </label>
            <label className="pay42-form-field">
              <span className="ui-field-label">START AT</span>
              <DateTimePicker
                mode="datetime"
                value={form.start_at}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, start_at: e.target.value }))
                }
              />
            </label>
            <label className="pay42-form-field">
              <span className="ui-field-label">END AT</span>
              <DateTimePicker
                mode="datetime"
                value={form.end_at}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, end_at: e.target.value }))
                }
              />
            </label>
            <ResponsivePanel
              title="Buyer Payment QR"
              subtitle="Scan-ready payment code for buyers"
              className="pay42-form-field pay42-form-field--full pay42-inline-panel"
              bodyClassName="pay42-inline-panel__body"
              border="always"
              defaultOpen
            >
              <div className="pay42-offer-hero pay42-offer-hero--qr-only">
                <Pay42MediaThumb
                  src={form.qr_code_image}
                  alt={`${form.sid || form.offer_name || "offer"} qr`}
                  label={form.sid || form.offer_name || "offer"}
                  className="pay42-qr-thumb pay42-qr-thumb--detail"
                  kind="qr"
                />
              </div>
            </ResponsivePanel>
            <div className="pay42-inline-actions pay42-form-field--full">
              <button
                type="button"
                className="primary-button"
                disabled={saving || !form.product_id || !form.offer_name.trim()}
                onClick={submitOffer}
              >
                {saving ? "Saving..." : form.sid ? "Update Offer" : "Create Offer"}
              </button>
              {isMobileEditor ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeDetail}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setForm(emptyOfferForm())}
                >
                  Clear
                </button>
              )}
            </div>
          </>
        ) : isMobileEditor ? (
          <div className="pay42-inline-actions pay42-form-field--full">
            <button
              type="button"
              className="secondary-button"
              onClick={closeDetail}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
  );

  return (
    <Pay42PageShell>
      <PageHeader className="trades-page-header" title={canManage ? "Offers" : "Points"} />

      {error ? <div className="error">{error}</div> : null}

      {canManage ? (
        <CrudContainer
          className="pay42-crud-layout"
          toolbar={{
            displayMode: "top",
            filters: (
              <div className="trades-toolbar-row">
                <div className="trades-toolbar-filters">
                  <input
                    value={filter.q}
                    placeholder="SEARCH OFFERS..."
                    onChange={(e) =>
                      setFilter((prev) => ({ ...prev, q: e.target.value }))
                    }
                  />
                  <InputComboSelect
                    value={filter.product_id}
                    onChange={(e) =>
                      setFilter((prev) => ({ ...prev, product_id: e.target.value }))
                    }
                  >
                    <option value="">ALL PRODUCTS</option>
                    {products.map((product) => (
                      <option key={product.sid} value={product.sid}>
                        {product.name}
                      </option>
                    ))}
                  </InputComboSelect>
                  <InputComboSelect
                    value={filter.status}
                    onChange={(e) =>
                      setFilter((prev) => ({ ...prev, status: e.target.value }))
                    }
                  >
                    <option value="">ALL STATUS</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </InputComboSelect>
                </div>
              </div>
            ),
            actionItems: [
              {
                key: "new-offer",
                label: "New Offer",
                onClick: startNewOffer,
                className: "primary-button",
              },
              {
                key: "refresh-offers",
                label: "Refresh offers",
                onClick: load,
                className: "secondary-button",
                ariaLabel: "Refresh offers",
                title: "Refresh offers",
                children: "↻",
              },
            ],
          }}
          detailMode={isMobileEditor ? "modal" : "section"}
          detailOpen={detailOpen}
          onDetailOpenChange={(open) => {
            if (open) {
              setDetailOpen(true);
              return;
            }
            closeDetail();
          }}
          detailCloseButton
          list={{
            title: `${filteredOffers.length} Offers`,
            panelClassName: "component-frozen-wrap",
            headerActions: (
              <>
                <PaginationBar
                  page={page}
                  pages={totalPages}
                  total={filteredOffers.length}
                  pageSize={pageSize}
                  pageSizeOptions={[10, 20, 50]}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  label={`${Math.min(filteredOffers.length, (page - 1) * pageSize + 1)}-${Math.min(filteredOffers.length, page * pageSize)} / ${filteredOffers.length}`}
                />
                <ComboButtonMenu
                  selectId="pay42-offers-mode"
                  value={tableMode}
                  buttonText={`Mode: ${TABLE_MODE_ITEMS.find((item) => item.value === tableMode)?.label || "Table"}`}
                  onChange={setTableMode}
                  items={TABLE_MODE_ITEMS}
                  ariaLabel="Select offers view mode"
                  align="end"
                  sideOffset={6}
                  triggerClassName="data-table-mode-switcher"
                />
              </>
            ),
            tableProps: {
              columns,
              data: pagedOffers,
              loading,
              emptyText: "No offers yet.",
              className: "events-table events-table--compact",
              onRowClick: selectOffer,
              mode: tableMode,
              onModeChange: setTableMode,
              getRowId: (row) => row.sid,
              selectedRowId: form.sid || null,
              mobileCard,
            },
          }}
          detail={{
            title: form.sid ? "Edit Offer" : "Create Offer",
            subtitle: form.sid ? form.sid : "Seller pricing",
            panelClassName: "pay42-offer-detail",
            children: offerFormPanel,
          }}
        />
      ) : (
        <div className="pay42-card-grid">
          {filteredOffers.map((row) => (
            <ResponsivePanel
              key={row.sid}
              title={row.metadata?.offer_name || row.product_name || row.sid}
              subtitle={`${row.product_name || "-"} • ${String(row.status || "").toUpperCase()}`}
              showToggle={false}
            >
              <div className="stack-layout">
                <div className="pay42-offer-hero">
                  <Pay42MediaThumb
                    src={row.qr_code_image}
                    alt={`${row.sid} qr`}
                    label={row.sid}
                    className="pay42-qr-thumb"
                    kind="qr"
                  />
                  <div className="stack-layout" style={{ gap: 10 }}>
                    <div className="cell-wrap">
                      <strong style={{ fontSize: "22px" }}>
                        {formatMoney(Number(row.price || 0) + Number(row.tax || 0))}
                      </strong>
                      <span className="minor-text">
                        Base {formatMoney(row.price)} + Tax {formatMoney(row.tax)}
                      </span>
                    </div>
                    <div className="pay42-offer-metrics">
                      <div className="pay42-stat-card">
                        <span className="minor-text">INVENTORY</span>
                        <strong>{row.metadata?.inventory || 0}</strong>
                      </div>
                      <div className="pay42-stat-card">
                        <span className="minor-text">VALID UNTIL</span>
                        <strong>{showDateTime(row.end_at)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="pay42-inline-actions">
                  <Link
                    className="primary-button"
                    to={`/admin/42pay/scan?qr=${encodeURIComponent(row.qr_code || "")}`}
                  >
                    Scan QR / Pay
                  </Link>
                </div>
              </div>
            </ResponsivePanel>
          ))}
        </div>
      )}
    </Pay42PageShell>
  );
}
