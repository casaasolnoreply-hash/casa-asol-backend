const { pool } = require("../config/db");

const FIELDS = `
  attentions.id, attentions.beneficiary_id, attentions.role, attentions.author_id,
  attentions.attention_date, attentions.type, attentions.notes,
  attentions.created_at, attentions.updated_at,
  users.username AS author_username, beneficiaries.full_name AS beneficiary_name
`;
// LEFT JOIN: beneficiary_id es opcional (actividades grupales/de
// equipo no son de un estudiante puntual — ver attentionFields.js).
const JOINS = `
  JOIN users ON users.id = attentions.author_id
  LEFT JOIN beneficiaries ON beneficiaries.id = attentions.beneficiary_id
`;

// role: si se pasa, solo trae atenciones de ese rol (así un rol no ve
// las notas clínicas de otro). beneficiaryId: filtra a un estudiante.
const findAll = async ({ role, beneficiaryId } = {}) => {
  const conditions = [];
  const params = [];
  if (role) { params.push(role); conditions.push(`attentions.role = $${params.length}`); }
  if (beneficiaryId) { params.push(beneficiaryId); conditions.push(`attentions.beneficiary_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${FIELDS} FROM attentions ${JOINS} ${where} ORDER BY attentions.attention_date DESC, attentions.id DESC`,
    params
  );
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`SELECT ${FIELDS} FROM attentions ${JOINS} WHERE attentions.id = $1`, [id]);
  return rows[0] || null;
};

const create = async ({ beneficiaryId, role, authorId, attentionDate, type, notes }) => {
  const { rows } = await pool.query(
    `INSERT INTO attentions (beneficiary_id, role, author_id, attention_date, type, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [beneficiaryId || null, role, authorId, attentionDate, type, notes || null]
  );
  return findById(rows[0].id);
};

const update = async (id, { attentionDate, type, notes }) => {
  await pool.query(
    `UPDATE attentions SET
       attention_date = COALESCE($1, attention_date),
       type = COALESCE($2, type),
       notes = $3
     WHERE id = $4`,
    [attentionDate, type, notes ?? null, id]
  );
  return findById(id);
};

const remove = async (id) => {
  const { rowCount } = await pool.query("DELETE FROM attentions WHERE id = $1", [id]);
  return rowCount > 0;
};

// Para autocalcular el informe periódico: cuenta cuántas atenciones
// de cada tipo hay en el rango, y además las agrupa por periodo
// (día/semana/mes) para llenar las series. Una sola consulta
// devuelve todos los tipos de una vez — el llamador se queda solo
// con lo que le interesa (statFields por count, monthlyFields por series).
const summary = async (role, periodStart, periodEnd, granularity = "mensual") => {
  const bucketUnit = granularity === "diario" ? "day" : granularity === "semanal" ? "week" : "month";

  const { rows: counts } = await pool.query(
    `SELECT type, COUNT(*)::int AS n FROM attentions
     WHERE role = $1 AND attention_date BETWEEN $2 AND $3
     GROUP BY type`,
    [role, periodStart, periodEnd]
  );

  const { rows: seriesRows } = await pool.query(
    `SELECT type, date_trunc($1, attention_date) AS bucket, COUNT(*)::int AS n
     FROM attentions
     WHERE role = $2 AND attention_date BETWEEN $3 AND $4
     GROUP BY type, bucket ORDER BY bucket`,
    [bucketUnit, role, periodStart, periodEnd]
  );

  const result = {};
  for (const { type, n } of counts) result[type] = { count: n, series: [] };
  for (const { type, bucket, n } of seriesRows) {
    if (!result[type]) result[type] = { count: 0, series: [] };
    result[type].series.push({ bucket: bucket.toISOString().slice(0, 10), value: n });
  }
  return result;
};

module.exports = { findAll, findById, create, update, remove, summary };
