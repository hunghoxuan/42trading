import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import DataTable from "../../../shared/components/DataTable";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import AdminPageToolbar from "../../../shared/components/AdminPageToolbar";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import { showToast } from "../../../shared/components/ToastContainer";
import Pay42MediaThumb from "./Pay42MediaThumb";

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
  const [items, setItems] = useState([]);
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
              src={row.original.image}
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

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title="42Pay Products"
        actions={
          <div className="pay42-inline-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setForm(emptyForm())}
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

      <div className="pay42-split-layout">
        <ResponsivePanel
          title={form.sid ? "Edit Product" : "Create Product"}
          subtitle={form.sid ? form.sid : "Catalog entry"}
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
              <button
                type="button"
                className="secondary-button"
                onClick={() => setForm(emptyForm())}
              >
                Clear
              </button>
            </div>
          </div>
        </ResponsivePanel>

        <ResponsivePanel
          title={`${filteredItems.length} Products`}
          subtitle="Tap a row to edit"
          className="component-frozen-wrap"
          showToggle={false}
        >
          <DataTable
            columns={columns}
            data={filteredItems}
            loading={loading}
            emptyText="No products yet."
            className="events-table"
            onRowClick={(row) =>
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
              })
            }
          />
        </ResponsivePanel>
      </div>
    </section>
  );
}
