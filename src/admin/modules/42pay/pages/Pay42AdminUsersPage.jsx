import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../app/api";
import ComboButtonMenu from "../../../shared/components/ComboButtonMenu";
import CrudContainer from "../../../shared/components/CrudContainer";
import PageHeader from "../../../shared/components/PageHeader";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import Pay42PageShell from "./Pay42PageShell";

const TABLE_MODE_ITEMS = [
  { value: "table", label: "Table" },
  { value: "grid", label: "Grid" },
  { value: "cards", label: "Cards" },
  { value: "carousel", label: "Carousel" },
];

export default function Pay42AdminUsersPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({ q: "", role: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tableMode, setTableMode] = useState("table");

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
          <div className="cell-wrap ui-data-stack">
            <strong className="ui-data-title">{row.original.name || row.original.user_id}</strong>
            <span className="ui-data-meta">{row.original.user_id}</span>
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
    <Pay42PageShell>
      <PageHeader className="trades-page-header" title="Users" />

      {error ? <div className="error">{error}</div> : null}

      <CrudContainer
        toolbar={{
          displayMode: "top",
          filters: (
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
          ),
          actions: (
            <Link className="primary-button" to="/system/users">
              Open System User Manager
            </Link>
          ),
        }}
        detailVisible={false}
        list={{
          title: `${filteredItems.length} Users`,
          subtitle: "Role coverage and activity",
          panelClassName: "component-frozen-wrap",
          headerActions: (
            <ComboButtonMenu
              selectId="pay42-users-mode"
              value={tableMode}
              buttonText={`Mode: ${TABLE_MODE_ITEMS.find((item) => item.value === tableMode)?.label || "Table"}`}
              onChange={setTableMode}
              items={TABLE_MODE_ITEMS}
              ariaLabel="Select users view mode"
              align="end"
              sideOffset={6}
              triggerClassName="data-table-mode-switcher"
            />
          ),
          tableProps: {
            columns,
            data: filteredItems,
            loading,
            emptyText: "No 42Pay users found.",
            className: "events-table events-table--compact",
            mode: tableMode,
            onModeChange: setTableMode,
            mobileCard,
          },
        }}
      />
    </Pay42PageShell>
  );
}
