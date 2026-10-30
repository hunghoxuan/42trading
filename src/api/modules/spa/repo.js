"use strict";

const path = require("node:path");
const fs = require("node:fs");

// One shared chain, deliberately separate from the trading/user databases.
const definitions = {
  branches: { name: "TEXT NOT NULL", address: "TEXT NOT NULL", is_active: "BOOLEAN NOT NULL" },
  employees: { name: "TEXT NOT NULL", phone: "TEXT NOT NULL", branch_id: "BIGINT NOT NULL REFERENCES spa_branches(id)", start_date: "TEXT NOT NULL", end_date: "TEXT NOT NULL", base_salary: "NUMERIC NOT NULL", salary_effective_from: "TEXT NOT NULL", is_active: "BOOLEAN NOT NULL", notes: "TEXT NOT NULL" },
  salary_rates: { employee_id: "BIGINT NOT NULL REFERENCES spa_employees(id)", effective_from: "TEXT NOT NULL", monthly_salary: "NUMERIC NOT NULL" },
  services: { name: "TEXT NOT NULL", branch_id: "BIGINT REFERENCES spa_branches(id)", duration_minutes: "INTEGER NOT NULL", onsite_price: "NUMERIC NOT NULL", home_price: "NUMERIC NOT NULL", onsite_commission: "NUMERIC NOT NULL", home_commission: "NUMERIC NOT NULL", is_active: "BOOLEAN NOT NULL", notes: "TEXT NOT NULL" },
  customers: { name: "TEXT NOT NULL", phone: "TEXT NOT NULL", address: "TEXT NOT NULL", notes: "TEXT NOT NULL", is_active: "BOOLEAN NOT NULL" },
  consultations: { customer_id: "BIGINT NOT NULL REFERENCES spa_customers(id)", employee_id: "BIGINT NOT NULL REFERENCES spa_employees(id)", consulted_on: "TEXT NOT NULL", needs: "TEXT NOT NULL", advice: "TEXT NOT NULL", follow_up_on: "TEXT NOT NULL" },
  treatment_plans: { customer_id: "BIGINT NOT NULL REFERENCES spa_customers(id)", service_id: "BIGINT NOT NULL REFERENCES spa_services(id)", name: "TEXT NOT NULL", total_sessions: "INTEGER NOT NULL", start_date: "TEXT NOT NULL", end_date: "TEXT NOT NULL", status: "TEXT NOT NULL", notes: "TEXT NOT NULL" },
  work_logs: { employee_id: "BIGINT NOT NULL REFERENCES spa_employees(id)", branch_id: "BIGINT NOT NULL REFERENCES spa_branches(id)", starts_at: "TEXT NOT NULL", ends_at: "TEXT NOT NULL", actual_starts_at: "TEXT NOT NULL", actual_ends_at: "TEXT NOT NULL", status: "TEXT NOT NULL", notes: "TEXT NOT NULL" },
  appointments: { branch_id: "BIGINT NOT NULL REFERENCES spa_branches(id)", employee_id: "BIGINT NOT NULL REFERENCES spa_employees(id)", customer_id: "BIGINT NOT NULL REFERENCES spa_customers(id)", service_id: "BIGINT NOT NULL REFERENCES spa_services(id)", treatment_plan_id: "BIGINT REFERENCES spa_treatment_plans(id)", starts_at: "TEXT NOT NULL", ends_at: "TEXT NOT NULL", location: "TEXT NOT NULL", address: "TEXT NOT NULL", travel_minutes: "INTEGER NOT NULL", travel_fee: "NUMERIC NOT NULL", travel_allowance: "NUMERIC NOT NULL", service_price: "NUMERIC NOT NULL", commission: "NUMERIC NOT NULL", status: "TEXT NOT NULL", notes: "TEXT NOT NULL", completed_at: "TEXT NOT NULL" },
};

function schema(backend) {
  const id = backend === "postgres" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const time = backend === "postgres" ? "TIMESTAMPTZ" : "TEXT";
  return Object.entries(definitions).map(([name, fields]) =>
    `CREATE TABLE IF NOT EXISTS spa_${name} (id ${id}, sid TEXT UNIQUE NOT NULL, ${Object.entries(fields).map(([key, type]) => `${key} ${type}`).join(", ")}, created_at ${time} NOT NULL, updated_at ${time} NOT NULL, updated_by TEXT NOT NULL);`
  ).join("\n") + `
    CREATE UNIQUE INDEX IF NOT EXISTS spa_salary_rate_date ON spa_salary_rates(employee_id, effective_from);
    CREATE INDEX IF NOT EXISTS spa_appointments_schedule ON spa_appointments(employee_id, starts_at);
    CREATE INDEX IF NOT EXISTS spa_appointments_plan ON spa_appointments(treatment_plan_id, status);
    CREATE INDEX IF NOT EXISTS spa_work_logs_schedule ON spa_work_logs(employee_id, starts_at);
  `;
}

function createSpaRepository(options = {}) {
  const backend = String(options.provider || process.env.MT5_STORAGE || "sqlite").toLowerCase();
  if (!["sqlite", "postgres"].includes(backend)) throw new Error("Unsupported Spa storage backend");
  let raw;
  let ownsPool = false;
  let ready;
  let queue = Promise.resolve();

  async function initialize() {
    if (backend === "sqlite") {
      const file = options.sqlitePath || path.resolve(process.cwd(), "data/modules/spa/data.db");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      raw = new (require("better-sqlite3"))(file);
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      raw.pragma("busy_timeout = 5000");
      raw.exec(schema(backend));
    } else {
      if (!options.pool && !options.postgresUrl) throw new Error("Spa requires the configured Postgres connection");
      ownsPool = !options.pool;
      raw = options.pool || new (require("pg").Pool)({ connectionString: options.postgresUrl, max: 5 });
      await raw.query(schema(backend));
    }
  }

  function runExclusive(fn) {
    const result = queue.then(async () => { await (ready ||= initialize()); return fn(); });
    queue = result.catch(() => {});
    return result;
  }

  function session(connection) {
    const query = async (sql, args = []) => {
      if (backend === "postgres") {
        let n = 0;
        return (await connection.query(sql.replace(/\?/g, () => `$${++n}`), args)).rows;
      }
      return connection.prepare(sql).all(...args.map(value => typeof value === "boolean" ? Number(value) : value));
    };
    const table = name => {
      if (!Object.hasOwn(definitions, name)) throw new Error("Unknown Spa table");
      return `spa_${name}`;
    };
    const normalize = row => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k,
      k === "is_active" ? Boolean(v) : v instanceof Date ? v.toISOString() :
        (k === "id" || k.endsWith("_id") || /salary|price|commission|fee|allowance|minutes|sessions/.test(k)) && v != null && !k.includes("effective") ? Number(v) : v]));
    return {
      async list(name) { return (await query(`SELECT * FROM ${table(name)} ORDER BY id DESC`)).map(normalize); },
      async get(name, id) { return normalize((await query(`SELECT * FROM ${table(name)} WHERE id = ?`, [id]))[0]); },
      async save(name, row) {
        const keys = ["sid", ...Object.keys(definitions[name]), "created_at", "updated_at", "updated_by"];
        const values = keys.map(key => row[key]);
        const sql = row.id
          ? `UPDATE ${table(name)} SET ${keys.map(key => `${key} = ?`).join(", ")} WHERE id = ? RETURNING *`
          : `INSERT INTO ${table(name)} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING *`;
        return normalize((await query(sql, row.id ? [...values, row.id] : values))[0]);
      },
    };
  }

  return {
    backend,
    read(fn) { return runExclusive(() => fn(session(raw))); },
    transaction(fn) {
      return runExclusive(async () => {
        const connection = backend === "postgres" ? await raw.connect() : raw;
        try {
          if (backend === "postgres") {
            await connection.query("BEGIN");
            // All schedule/package writes are serialized, including other API processes.
            await connection.query("SELECT pg_advisory_xact_lock(424207)");
          } else connection.exec("BEGIN IMMEDIATE");
          const result = await fn(session(connection));
          if (backend === "postgres") await connection.query("COMMIT");
          else connection.exec("COMMIT");
          return result;
        } catch (error) {
          if (backend === "postgres") await connection.query("ROLLBACK");
          else connection.exec("ROLLBACK");
          throw error;
        } finally { if (backend === "postgres") connection.release(); }
      });
    },
    async close() { await queue; if (raw) { if (backend === "sqlite") raw.close(); else if (ownsPool) await raw.end(); } },
  };
}

module.exports = { createSpaRepository, definitions, schema };
