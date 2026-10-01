const { Pool } = require("pg");
const bcrypt   = require("bcryptjs");
const { SCHEMA_SQL, TABLES_IN_DROP_ORDER } = require("./schema");
const { ROLE_DEFINITIONS } = require("./roles.seed");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL requerido en proveedores cloud (Supabase, Railway, Neon, etc.)
  // Se desactiva automáticamente para conexiones locales
  ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

// ── Crear / recrear tablas ────────────────────────────────
// La estructura vive en config/schema.js (archivo único). Si
// RESET_DB=true la BD se borra por completo y se recrea desde ahí;
// por seguridad, RESET_DB se ignora cuando NODE_ENV=production para
// no borrar datos reales de Casa ASOL por accidente.
// Devuelve true si de verdad se ejecutó el borrado, para que app.js
// lo muestre en el resumen de arranque.
const initDB = async () => {
  const resetRequested = process.env.RESET_DB?.trim().toLowerCase() === "true";
  const isProduction   = process.env.NODE_ENV === "production";
  const ts = () => new Date().toLocaleTimeString("es-GT", { hour12: false });
  let didReset = false;

  if (resetRequested && isProduction) {
    console.warn(`[${ts()}] [DB] RESET_DB=true fue IGNORADO: NODE_ENV=production. La base de datos NO se tocó.`);
  } else if (resetRequested) {
    console.log("");
    console.log("[DB] ────────────────────────────────────────────────────");
    console.log(`[DB] [${ts()}] RESET_DB=true detectado — borrando la base de datos`);
    console.log("[DB] ────────────────────────────────────────────────────");
    for (const table of TABLES_IN_DROP_ORDER) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      console.log(`[DB]   tabla "${table}" borrada`);
    }
    console.log(`[DB] [${ts()}] Recreando estructura desde config/schema.js...`);
    didReset = true;
  } else {
    console.log(`[${ts()}] [DB] RESET_DB=false — arranque normal, no se borra nada.`);
  }

  await pool.query(SCHEMA_SQL);

  if (didReset) {
    console.log(`[DB] [${ts()}] Base de datos recreada desde cero.`);
    console.log("[DB] ────────────────────────────────────────────────────");
    console.log("");
  }

  return didReset;
};

// ── Migraciones aditivas para BDs existentes que no pasaron por
//    un reset (agregar columnas nuevas es seguro; no se tocan datos) ──
const migrateDB = async () => {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE");

  // updated_at + trigger (ver schema.js para la versión "de fábrica")
  await pool.query("ALTER TABLE roles     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE users     ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE site_data ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");

  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  for (const table of ["roles", "users", "site_data"]) {
    await pool.query(`DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table}`);
    await pool.query(`
      CREATE TRIGGER trg_${table}_updated_at BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }

  // CHECK constraints para BDs creadas antes de que existieran
  // (ALTER TABLE ADD CONSTRAINT no tiene "IF NOT EXISTS": se valida
  // contra el catálogo del sistema para que sea seguro repetir esto
  // en cada arranque).
  const addCheckIfMissing = async (table, constraintName, definition) => {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.table_constraints WHERE table_name = $1 AND constraint_name = $2",
      [table, constraintName]
    );
    if (rows.length === 0) {
      await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} ${definition}`);
    }
  };
  await addCheckIfMissing("messages", "messages_type_check", "CHECK (type IN ('contacto', 'voluntario'))");
  await addCheckIfMissing("user_requests", "user_requests_source_check", "CHECK (source IN ('system', 'google'))");
  await addCheckIfMissing("user_requests", "user_requests_status_check", "CHECK (status IN ('pending', 'approved', 'rejected'))");

  // reports.period_type: la lista de periodos válidos se amplió
  // (ahora incluye diario/semanal/anual). A diferencia de los CHECK
  // de arriba, este SÍ hay que reemplazarlo si ya existe con la
  // definición vieja, no solo crearlo si falta.
  await pool.query("ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_period_type_check");
  await pool.query(`
    ALTER TABLE reports ADD CONSTRAINT reports_period_type_check
      CHECK (period_type IN ('diario', 'semanal', 'mensual', 'trimestral', 'semestral', 'anual'))
  `);

  // Flujo de revisión: borrador -> enviado -> aceptado (final) / devuelto
  // (vuelve a editable). Columnas nuevas + ampliar el CHECK de status.
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_code TEXT UNIQUE");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS review_comment TEXT");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP");
  await pool.query("ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_status_check");
  await pool.query(`
    ALTER TABLE reports ADD CONSTRAINT reports_status_check
      CHECK (status IN ('borrador', 'enviado', 'aceptado', 'devuelto'))
  `);

  // Un borrador se puede guardar aunque todavía no tenga periodo
  // definido (se completa en el paso 1 del formulario) — antes era
  // obligatorio desde el primer guardado, lo que impedía guardar un
  // borrador a medio llenar.
  await pool.query("ALTER TABLE reports ALTER COLUMN period_type DROP NOT NULL");
  await pool.query("ALTER TABLE reports ALTER COLUMN period_start DROP NOT NULL");
  await pool.query("ALTER TABLE reports ALTER COLUMN period_end DROP NOT NULL");

  // Correlativo por rol para el código de cada informe (PSI-0001, ...)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_sequences (
      role       TEXT PRIMARY KEY REFERENCES roles(name),
      next_value INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Expediente de atenciones (individuales y grupales/de equipo) — ver schema.js
  await pool.query(`
    CREATE TABLE IF NOT EXISTS attentions (
      id             SERIAL PRIMARY KEY,
      beneficiary_id INTEGER REFERENCES beneficiaries(id),
      role           TEXT NOT NULL REFERENCES roles(name),
      author_id      INTEGER NOT NULL REFERENCES users(id),
      attention_date DATE NOT NULL,
      type           TEXT NOT NULL,
      notes          TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  // Fotos de respaldo de cada registro del expediente (evidencia de la
  // actividad) — arreglo de URLs de Cloudinary, igual que las galerías
  // del contenido público.
  await pool.query("ALTER TABLE attentions ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb");

  await pool.query(`DROP TRIGGER IF EXISTS trg_attentions_updated_at ON attentions`);
  await pool.query(`
    CREATE TRIGGER trg_attentions_updated_at BEFORE UPDATE ON attentions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

// ── Sembrar roles ──────────────────────────────────────────
const seedRoles = async () => {
  for (const r of ROLE_DEFINITIONS) {
    await pool.query(
      `INSERT INTO roles (name, label, description, permissions, self_requestable)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING`,
      [r.name, r.label, r.description, JSON.stringify(r.permissions || {}), !!r.selfRequestable]
    );
  }
};

// ── Sembrar cuenta inicial de desarrollador ───────────────
// Usa las mismas variables ADMIN_USER/ADMIN_PASS de siempre, pero
// la cuenta queda con rol "desarrollador" (acceso total) para que
// siempre exista alguien que pueda crear el resto de cuentas
// (admin y roles operativos) desde el panel.
const seedAdmin = async () => {
  const devUser = process.env.ADMIN_USER || "admin";
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
    [devUser]
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASS || "admin123", 12);
    await pool.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, 'desarrollador')",
      [devUser, hash]
    );
    console.log(`   Usuario desarrollador "${devUser}" creado en PostgreSQL`);
  }
};

// ── Helpers para site_data ────────────────────────────────
const getData = async (key) => {
  const { rows } = await pool.query("SELECT value FROM site_data WHERE key = $1", [key]);
  return rows.length ? JSON.parse(rows[0].value) : null;
};

const setData = async (key, value) => {
  await pool.query(
    `INSERT INTO site_data (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
};

module.exports = { pool, getData, setData, initDB, migrateDB, seedRoles, seedAdmin };
