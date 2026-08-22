const { pool } = require("../config/db");

const FIELDS = `
  reports.id, reports.report_code, reports.role, reports.author_id, reports.period_type,
  reports.period_start, reports.period_end, reports.stats, reports.narrative,
  reports.status, reports.review_comment, reports.reviewed_by, reports.reviewed_at,
  reports.submitted_at, reports.created_at, reports.updated_at,
  users.username AS author_username
`;

// authorId: si se pasa, solo trae los informes de ese autor (self-service).
// Sin authorId trae todos (uso: admin/desarrollador).
const findAll = async ({ role, authorId } = {}) => {
  const conditions = [];
  const params = [];
  if (role) { params.push(role); conditions.push(`reports.role = $${params.length}`); }
  if (authorId) { params.push(authorId); conditions.push(`reports.author_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${FIELDS} FROM reports JOIN users ON users.id = reports.author_id
     ${where} ORDER BY reports.period_start DESC`,
    params
  );
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(
    `SELECT ${FIELDS} FROM reports JOIN users ON users.id = reports.author_id WHERE reports.id = $1`,
    [id]
  );
  return rows[0] || null;
};

// Correlativo atómico por rol (ej. PSI-0001, PSI-0002...). No se
// reutiliza un número aunque se borren informes: el contador vive
// aparte, en report_sequences, no se calcula con COUNT(*).
const nextCode = async (role, prefix) => {
  const { rows } = await pool.query(
    `INSERT INTO report_sequences (role, next_value) VALUES ($1, 2)
     ON CONFLICT (role) DO UPDATE SET next_value = report_sequences.next_value + 1
     RETURNING next_value - 1 AS n`,
    [role]
  );
  return `${prefix}-${String(rows[0].n).padStart(4, "0")}`;
};

const create = async ({ role, authorId, periodType, periodStart, periodEnd, stats, narrative, codePrefix }) => {
  const reportCode = codePrefix ? await nextCode(role, codePrefix) : null;
  const { rows } = await pool.query(
    `INSERT INTO reports (report_code, role, author_id, period_type, period_start, period_end, stats, narrative)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [reportCode, role, authorId, periodType || null, periodStart || null, periodEnd || null, JSON.stringify(stats || {}), JSON.stringify(narrative || {})]
  );
  return findById(rows[0].id);
};

// "" (campo del formulario todavía vacío) se normaliza a NULL: un
// CHECK constraint solo deja pasar NULL, no una cadena vacía, y
// COALESCE solo conserva el valor existente cuando recibe NULL.
const update = async (id, { periodType, periodStart, periodEnd, stats, narrative }) => {
  await pool.query(
    `UPDATE reports SET
       period_type = COALESCE($1, period_type),
       period_start = COALESCE($2, period_start),
       period_end = COALESCE($3, period_end),
       stats = COALESCE($4, stats),
       narrative = COALESCE($5, narrative)
     WHERE id = $6`,
    [periodType || null, periodStart || null, periodEnd || null, stats ? JSON.stringify(stats) : null, narrative ? JSON.stringify(narrative) : null, id]
  );
  return findById(id);
};

const submit = async (id) => {
  await pool.query("UPDATE reports SET status = 'enviado', submitted_at = NOW(), review_comment = NULL WHERE id = $1", [id]);
  return findById(id);
};

const accept = async (id, reviewerId) => {
  await pool.query(
    "UPDATE reports SET status = 'aceptado', reviewed_by = $1, reviewed_at = NOW(), review_comment = NULL WHERE id = $2",
    [reviewerId, id]
  );
  return findById(id);
};

const returnForCorrection = async (id, reviewerId, comment) => {
  await pool.query(
    "UPDATE reports SET status = 'devuelto', reviewed_by = $1, reviewed_at = NOW(), review_comment = $2 WHERE id = $3",
    [reviewerId, comment || null, id]
  );
  return findById(id);
};

const remove = async (id) => {
  const { rowCount } = await pool.query("DELETE FROM reports WHERE id = $1", [id]);
  return rowCount > 0;
};

module.exports = { findAll, findById, create, update, submit, accept, returnForCorrection, remove };
