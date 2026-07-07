import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import DataTable from "../../../shared/components/DataTable";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import AdminPageToolbar from "../../../shared/components/AdminPageToolbar";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import { showToast } from "../../../shared/components/ToastContainer";
import MobileFullscreenModal from "../../../shared/components/MobileFullscreenModal";
import Pay42MediaThumb from "./Pay42MediaThumb";

const MOBILE_BREAKPOINT = 768;
const LOCAL_PRODUCT_IMAGE_BY_SID = Object.freeze({
  P42P_MARINA_BAY_SUITES: "/pay42/grand-hyatt-singapore.jpg",
  P42P_KYOTO_GARDEN_RYOKAN: "/pay42/park-hyatt-kyoto.jpg",
  P42P_ALPINE_LAKE_RETREAT: "/pay42/whole-foods-soma.jpg",
  P42P_OLD_QUARTER_HERITAGE: "/pay42/carrefour-city-louvre.jpg",
});

function resolveProductImage(row = {}) {
  const localImage = LOCAL_PRODUCT_IMAGE_BY_SID[String(row.sid || "").trim()];
  if (localImage) return localImage;
  return row.image || "";
}

function emptyForm() {
  return {
    sid: "",
    name: "",
    image: "",
    type: "hotel",
    status: "ACTIVE",
    city: "",
    country: "",
    nights: "2",
    description: "",
  };
}

export default function Pay42ProductsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [isMobileList, setIsMobileList] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState({
    q: "",
    type: "",
    status: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      const out = await api.pay42Products();
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (nextError) {
      setError(nextError?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (event) => setIsMobileList(event.matches);
    setIsMobileList(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const filteredItems = useMemo(() => {
    const query = String(filter.q || "").trim().toLowerCase();
    return items.filter((row) => {
      if (filter.type && String(row.type || "") !== filter.type) return false;
      if (filter.status && String(row.status || "") !== filter.status) return false;
      if (!query) return true;
      const haystack = [
        row.sid,
        row.name,
        row.type,
        row.metadata?.city,
        row.metadata?.country,
        row.metadata?.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filter, items]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "PRODUCT",
        cell: ({ row }) => (
          <div className="pay42-cell-media">
            <Pay42MediaThumb
              src={resolveProductImage(row.original)}
              alt={row.original.name || row.original.sid}
              label={row.original.name || row.original.sid}
              className="pay42-thumb"
            />
            <div className="cell-wrap">
              <strong>{row.original.name || "-"}</strong>
              <span className="minor-text">{row.original.sid}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: "TYPE",
        cell: ({ row }) => String(row.original.type || "-").toUpperCase(),
      },
      {
        accessorKey: "location",
        header: "LOCATION",
        cell: ({ row }) =>
          [row.original.metadata?.city, row.original.metadata?.country]
            .filter(Boolean)
            .join(", ") || "-",
      },
      {
        accessorKey: "status",
        header: "STATUS",
        cell: ({ row }) => String(row.original.status || "-").toUpperCase(),
      },
      {
        accessorKey: "offer_count",
        header: "OFFERS",
        cell: ({ row }) => row.original.offer_count || 0,
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
      getImageSrc: (row) => resolveProductImage(row),
      getImageAlt: (row) => row.name || row.sid,
      getImageLabel: (row) => row.name || row.sid,
      getTitle: (row) => row.name || "-",
      getSubtitle: (row) => row.sid || "",
      getBadges: (row) => [
        { label: String(row.type || "-").toUpperCase() },
        { label: String(row.status || "-").toUpperCase(), tone: String(row.status || "-").toUpperCase() },
      ],
      getRows: (row) => [
        [
          {
            value:
              [row.metadata?.city, row.metadata?.country].filter(Boolean).join(", ") || "-",
          },
          { value: `${row.offer_count || 0} offer${row.offer_count === 1 ? "" : "s"}` },
        ],
      ],
      getFooterText: (row) => showDateTime(row.create_at).replace(" ", " · "),
      getActions: (row) => [
        {
          label: "+ Add offer",
          className: "data-table-mobile-card__action--brass",
          onClick: () =>
            navigate(`/admin/42pay/offers?product_id=${encodeURIComponent(row.sid || "")}&new=1`),
        },
      ],
    }),
    [navigate],
  );

  async function submit() {
    try {
      setSaving(true);
      setError("");
      const payload = {
        sid: form.sid || undefined,
        name: form.name,
        image: form.image,
        type: form.type,
        status: form.status,
        metadata: {
          city: form.city,
          country: form.country,
          nights: Number(form.nights || 0),
          description: form.description,
        },
      };
      if (form.sid) {
        await api.pay42UpdateProduct(form.sid, payload);
      } else {
        await api.pay42CreateProduct(payload);
      }
      showToast({ type: "success", message: "42Pay product saved." });
      setForm(emptyForm());
      await load();
    } catch (nextError) {
      setError(nextError?.message || "Failed to save product");
    } finally {
      setSaving(false);
    }
  }

  function selectRow(row) {
    setForm({
      sid: row.sid,
      name: row.name || "",
      image: row.image || "",
      type: row.type || "hotel",
      status: row.status || "ACTIVE",
      city: row.metadata?.city || "",
      country: row.metadata?.country || "",
      nights: String(row.metadata?.nights || ""),
      description: row.metadata?.description || "",
    });
    if (isMobileList) setMobileEditorOpen(true);
  }

  function startNewProduct() {
    setForm(emptyForm());
    if (isMobileList) setMobileEditorOpen(true);
  }

  function closeMobileEditor() {
    setMobileEditorOpen(false);
  }

  const formPanel = (
    <ResponsivePanel
      title={isMobileList ? "" : form.sid ? "Edit Product" : "Create Product"}
      subtitle={isMobileList ? "" : form.sid ? form.sid : "Catalog entry"}
      showToggle={false}
    >
      <div className="pay42-form-grid">
        <label className="pay42-form-field pay42-form-field--full">
          <span className="minor-text">NAME</span>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Marina Bay Suites Singapore"
          />
        </label>
        <label className="pay42-form-field pay42-form-field--full">
          <span className="minor-text">IMAGE URL</span>
          <input
            value={form.image}
            onChange={(e) => setForm((prev) => ({ ...prev, image: e.target.value }))}
            placeholder="https://..."
          />
        </label>
        <label className="pay42-form-field">
          <span className="minor-text">TYPE</span>
          <InputComboSelect
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="hotel">HOTEL</option>
            <option value="supermarket">SUPERMARKET</option>
          </InputComboSelect>
        </label>
        <label className="pay42-form-field">
          <span className="minor-text">STATUS</span>
          <InputComboSelect
            value={form.status}
            onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </InputComboSelect>
        </label>
        <label className="pay42-form-field">
          <span className="minor-text">CITY</span>
          <input
            value={form.city}
            onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
            placeholder="Singapore"
          />
        </label>
        <label className="pay42-form-field">
          <span className="minor-text">COUNTRY</span>
          <input
            value={form.country}
            onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
            placeholder="Singapore"
          />
        </label>
        <label className="pay42-form-field pay42-form-field--full">
          <span className="minor-text">NIGHTS</span>
          <input
            value={form.nights}
            onChange={(e) => setForm((prev) => ({ ...prev, nights: e.target.value }))}
            placeholder="2"
          />
        </label>
        <label className="pay42-form-field pay42-form-field--full">
          <span className="minor-text">DESCRIPTION</span>
          <textarea
            rows={5}
            value={form.description}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Skyline-view suites with breakfast for two."
          />
        </label>
        <div className="pay42-inline-actions pay42-form-field--full">
          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={submit}
          >
            {saving ? "Saving..." : form.sid ? "Update Product" : "Create Product"}
          </button>
          {isMobileList ? (
            <button
              type="button"
              className="secondary-button"
              onClick={closeMobileEditor}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setForm(emptyForm())}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </ResponsivePanel>
  );

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title="Products"
        actions={
          <div className="pay42-inline-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={startNewProduct}
            >
              New Product
            </button>
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
                  placeholder="SEARCH PRODUCTS..."
                  onChange={(e) =>
                    setFilter((prev) => ({ ...prev, q: e.target.value }))
                  }
                />
                <InputComboSelect
                  value={filter.type}
                  onChange={(e) =>
                    setFilter((prev) => ({ ...prev, type: e.target.value }))
                  }
                >
                  <option value="">ALL TYPES</option>
                  <option value="hotel">HOTEL</option>
                  <option value="supermarket">SUPERMARKET</option>
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
          </ResponsivePanel>
        }
      />

      {error ? <div className="error">{error}</div> : null}

      <div className="pay42-split-layout pay42-split-layout--list-first">
        <ResponsivePanel
          title={`${filteredItems.length} Products`}
          subtitle={isMobileList ? "Tap a card to edit" : "Tap a row to edit"}
          className="component-frozen-wrap"
          showToggle={false}
        >
          <DataTable
            columns={columns}
            data={filteredItems}
            loading={loading}
            emptyText="No products yet."
            className="events-table"
            onRowClick={selectRow}
            mobileCard={mobileCard}
          />
        </ResponsivePanel>

        {!isMobileList ? formPanel : null}
      </div>

      {isMobileList ? (
        <MobileFullscreenModal
          open={mobileEditorOpen}
          title={form.sid ? "Edit Product" : "Create Product"}
          subtitle={form.sid ? form.sid : "Catalog entry"}
          onClose={closeMobileEditor}
        >
          {formPanel}
        </MobileFullscreenModal>
      ) : null}
    </section>
  );
}
