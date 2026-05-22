const fs = require('fs');
let code = fs.readFileSync('web-ui/src/pages/DatabasePage.jsx', 'utf8');

// 1. Add state for schema
code = code.replace(/const \[rows, setRows\] = useState\(\[\]\);/, `const [rows, setRows] = useState([]);\n  const [schema, setSchema] = useState([]);\n  const [showSchema, setShowSchema] = useState(false);`);

// 2. Fetch schema
code = code.replace(/const data = await api\.dbRows\(query\);/, `const [data, schemaData] = await Promise.all([
        api.dbRows(query),
        api.dbSchema(query.table).catch(() => ({ schema: [] }))
      ]);
      setSchema(schemaData.schema || []);`);

// 3. Update tableHeaders to show all columns based on schema instead of priority blacklist
code = code.replace(/const tableHeaders = useMemo\(\(\) => \{[^]*?\}, \[rows\]\);/, `const tableHeaders = useMemo(() => {
    if (schema && schema.length > 0) {
      return schema.map(c => c.column_name);
    }
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows, schema]);`);

// 4. Update table rendering to have horizontal scrolling
code = code.replace(/<div className="events-table-wrap">/, `<div className="events-table-wrap" style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>`);

// 5. Add Schema Toggle button to toolbar
code = code.replace(/<div className="toolbar-group toolbar-bulk-action">/, `<button type="button" className="secondary-button" onClick={() => setShowSchema(!showSchema)}>{showSchema ? "HIDE SCHEMA" : "SHOW SCHEMA"}</button>
        <div className="toolbar-group toolbar-bulk-action">`);

// 6. Render Schema above the table if showSchema is true
const schemaRender = `{showSchema && schema.length > 0 && (
            <div className="panel" style={{ margin: "10px", padding: "10px" }}>
              <div className="panel-label">TABLE SCHEMA: {selectedTable}</div>
              <table className="events-table" style={{ width: "100%", fontSize: "12px" }}>
                <thead><tr><th>COLUMN_NAME</th><th>DATA_TYPE</th><th>NULLABLE</th><th>DEFAULT</th></tr></thead>
                <tbody>
                  {schema.map(c => (
                    <tr key={c.column_name}>
                      <td>{c.column_name}</td>
                      <td><span className="badge START">{c.data_type} {c.character_maximum_length ? \`(\${c.character_maximum_length})\` : ''}</span></td>
                      <td>{c.is_nullable}</td>
                      <td>{c.column_default || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="events-table-wrap"`;
code = code.replace(/<div className="events-table-wrap"/, schemaRender);

fs.writeFileSync('web-ui/src/pages/DatabasePage.jsx', code);
console.log("Patched DatabasePage.jsx");
