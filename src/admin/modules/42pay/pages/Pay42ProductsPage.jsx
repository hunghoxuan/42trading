import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import ComboButtonMenu from "../../../shared/components/ComboButtonMenu";
import CrudContainer from "../../../shared/components/CrudContainer";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import { showToast } from "../../../shared/components/ToastContainer";
import Pay42MediaThumb from "./Pay42MediaThumb";
import Pay42PageShell from "./Pay42PageShell";

const MOBILE_BREAKPOINT = 768;
const TABLE_MODE_ITEMS = [
  { value: "table", label: "Table" },
  { value: "grid", label: "Grid" },
  { value: "cards", label: "Cards" },
  { value: "carousel", label: "Carousel" },
];
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

function productToForm(row = {}) {
  return {
    sid: row.sid || "",
    name: row.name || "",
    image: row.image || "",
    type: row.type || "hotel",
    status: row.status || "ACTIVE",
    city: row.metadata?.city || "",
    country: row.metadata?.country || "",
    nights: String(row.metadata?.nights || ""),
    description: row.metadata?.description || "",
  };
}

export default function Pay42ProductsPage() {
  const navigate = useNavigate();
  const { productSid = "" } = useParams();
  const [items, setItems] = useState([]);
  const [isMobileList, setIsMobileList] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  const [detailOpen, setDetailOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= MOBILE_BREAKPOINT : true,
  );
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState({
    q: "",
    type: "",
    status: "",
  });
  const [tableMode, setTableMode] = useState("table");
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
  const selectedProduct = useMemo(
    () => items.find((row) => String(row.sid || "") === String(productSid || "")) || null,
    [items, productSid],
  );

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
            <div className="cell-wrap ui-data-stack">
              <strong className="ui-data-title">{row.original.name || "-"}</strong>
              <span className="ui-data-meta">{row.original.sid}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: "TYPE",
        cell: ({ row }) => (
          <span className="badge badge-mini">
            {String(row.original.type || "-").toUpperCase()}
          </span>
        ),
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
    setForm(productToForm(row));
    setDetailOpen(true);
    navigate(`/admin/42pay/products/${encodeURIComponent(row.sid || "")}`);
  }

  function startNewProduct() {
    setForm(emptyForm());
    setDetailOpen(true);
    navigate("/admin/42pay/products");
  }

  function closeDetail() {
    setDetailOpen(false);
    if (productSid) navigate("/admin/42pay/products");
  }

  useEffect(() => {
    if (selectedProduct) {
      setForm(productToForm(selectedProduct));
      setDetailOpen(true);
      return;
    }

    if (!productSid) {
      setForm(emptyForm());
      return;
    }

    if (!loading) {
      setForm(emptyForm());
      setDetailOpen(true);
    }
  }, [loading, productSid, selectedProduct]);

  useEffect(() => {
    if (isMobileList) return;
    if (productSid) setDetailOpen(true);
  }, [isMobileList, productSid]);

  const formPanel = (
    <div className="pay42-form-grid">
      <label className="pay42-form-field pay42-form-field--full">
        <span className="ui-field-label">NAME</span>
        <input
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Marina Bay Suites Singapore"
        />
      </label>
      <label className="pay42-form-field pay42-form-field--full">
        <span className="ui-field-label">IMAGE URL</span>
        <input
          value={form.image}
          onChange={(e) => setForm((prev) => ({ ...prev, image: e.target.value }))}
          placeholder="https://..."
        />
      </label>
      <label className="pay42-form-field">
        <span className="ui-field-label">TYPE</span>
        <InputComboSelect
          value={form.type}
          onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
        >
          <option value="hotel">HOTEL</option>
          <option value="supermarket">SUPERMARKET</option>
        </InputComboSelect>
      </label>
      <label className="pay42-form-field">
        <span className="ui-field-label">STATUS</span>
        <InputComboSelect
          value={form.status}
          onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </InputComboSelect>
      </label>
      <label className="pay42-form-field">
        <span className="ui-field-label">CITY</span>
        <input
          value={form.city}
          onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
          placeholder="Singapore"
        />
      </label>
      <label className="pay42-form-field">
        <span className="ui-field-label">COUNTRY</span>
        <input
          value={form.country}
          onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
          placeholder="Singapore"
        />
      </label>
      <label className="pay42-form-field pay42-form-field--full">
        <span className="ui-field-label">NIGHTS</span>
        <input
          value={form.nights}
          onChange={(e) => setForm((prev) => ({ ...prev, nights: e.target.value }))}
          placeholder="2"
        />
      </label>
      <label className="pay42-form-field pay42-form-field--full">
        <span className="ui-field-label">DESCRIPTION</span>
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
        <button
          type="button"
          className="secondary-button"
          onClick={() => setForm(emptyForm())}
        >
          Clear
        </button>
      </div>
    </div>
  );

  return (
    <Pay42PageShell>
      <PageHeader
        className="trades-page-header"
        title="Products"
      />

      {error ? <div className="error">{error}</div> : null}

      <CrudContainer
        className="pay42-crud-layout"
        toolbar={{
          displayMode: "top",
          filters: (
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
          ),
          actionItems: [
            {
              key: "new-product",
              label: "New Product",
              onClick: startNewProduct,
              className: "primary-button",
            },
            {
              key: "refresh-products",
              label: "Refresh products",
              onClick: load,
              className: "secondary-button",
              ariaLabel: "Refresh products",
              title: "Refresh products",
              children: "↻",
            },
          ],
        }}
        detailMode={isMobileList ? "modal" : "section"}
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
          title: `${filteredItems.length} Products`,
          headerActions: (
            <ComboButtonMenu
              selectId="pay42-products-mode"
              value={tableMode}
              buttonText={`Mode: ${TABLE_MODE_ITEMS.find((item) => item.value === tableMode)?.label || "Table"}`}
              onChange={setTableMode}
              items={TABLE_MODE_ITEMS}
              ariaLabel="Select products view mode"
              align="end"
              sideOffset={6}
              triggerClassName="data-table-mode-switcher"
            />
          ),
          panelClassName: "component-frozen-wrap",
          tableProps: {
            columns,
            data: filteredItems,
            loading,
            emptyText: "No products yet.",
            className: "events-table events-table--compact events-table--products",
            onRowClick: selectRow,
            mode: tableMode,
            getRowId: (row) => row.sid,
            selectedRowId: productSid || null,
            mobileCard,
          },
        }}
        detail={{
          title: form.sid ? "Edit Product" : "Create Product",
          subtitle: form.sid ? form.sid : "Catalog entry",
          children: formPanel,
        }}
      />
    </Pay42PageShell>
  );
}
