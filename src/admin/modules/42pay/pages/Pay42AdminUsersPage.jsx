import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../app/api";
import DataTable from "../../../shared/components/DataTable";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import AdminPageToolbar from "../../../shared/components/AdminPageToolbar";
import InputComboSelect from "../../../shared/components/InputComboSelect";

export default function Pay42AdminUsersPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({ q: "", role: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const out = await api.pay42AdminUsers();
        if (!cancelled) {
          setItems(Array.isArray(out?.items) ? out.items : []);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError?.message || "Failed to load 42Pay users");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const query = String(filter.q || "").trim().toLowerCase();
    return items.filter((row) => {
      if (
        filter.role &&
        !(Array.isArray(row.roles) ? row.roles : []).includes(filter.role)
      ) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        row.user_id,
        row.name,
        row.email,
        ...(Array.isArray(row.roles) ? row.roles : []),
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
        header: "USER",
        cell: ({ row }) => (
          <div className="cell-wrap">
            <strong>{row.original.name || row.original.user_id}</strong>
            <span className="minor-text">{row.original.user_id}</span>
          </div>
        ),
      },
      {
        accessorKey: "roles",
        header: "ROLES",
        cell: ({ row }) =>
          Array.isArray(row.original.roles) ? row.original.roles.join(", ") : "-",
      },
      {
        accessorKey: "product_count",
        header: "PRODUCTS",
        cell: ({ row }) => row.original.product_count || 0,
      },
      {
        accessorKey: "offer_count",
        header: "OFFERS",
        cell: ({ row }) => row.original.offer_count || 0,
      },
      {
        accessorKey: "sales_count",
        header: "SALES",
        cell: ({ row }) => row.original.sales_count || 0,
      },
      {
        accessorKey: "buyer_order_count",
        header: "PURCHASES",
        cell: ({ row }) => row.original.buyer_order_count || 0,
      },
    ],
    [],
  );

  const mobileCard = useMemo(
    () => ({
      getImageLabel: (row) => row.name || row.user_id,
      getTitle: (row) => row.name || row.user_id || "-",
      getSubtitle: (row) => row.user_id || "",
      getBadges: (row) =>
        Array.isArray(row.roles)
          ? row.roles.map((role) => ({ label: String(role || "").toUpperCase() }))
          : [],
      getRows: (row) => [
        [
          { value: `${row.product_count || 0} products` },
          { value: `${row.offer_count || 0} offers` },
        ],
        [
          { value: `${row.sales_count || 0} sales` },
          { value: `${row.buyer_order_count || 0} purchases` },
        ],
      ],
    }),
    [],
  );

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title="Users"
        actions={
          <Link className="secondary-button" to="/system/users">
            Open System User Manager
          </Link>
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
                  placeholder="SEARCH USERS..."
                  onChange={(e) =>
                    setFilter((prev) => ({ ...prev, q: e.target.value }))
                  }
                />
                <InputComboSelect
                  value={filter.role}
                  onChange={(e) =>
                    setFilter((prev) => ({ ...prev, role: e.target.value }))
                  }
                >
                  <option value="">ALL ROLES</option>
                  <option value="admin">ADMIN</option>
                  <option value="seller">SELLER</option>
                  <option value="buyer">BUYER</option>
                </InputComboSelect>
              </div>
            </div>
          </ResponsivePanel>
        }
      />

      {error ? <div className="error">{error}</div> : null}

      <ResponsivePanel
        title={`${filteredItems.length} Users`}
        subtitle="Role coverage and activity"
        className="component-frozen-wrap"
        showToggle={false}
      >
        <DataTable
          columns={columns}
          data={filteredItems}
          loading={loading}
          emptyText="No 42Pay users found."
          className="events-table"
          mobileCard={mobileCard}
        />
      </ResponsivePanel>
    </section>
  );
}
