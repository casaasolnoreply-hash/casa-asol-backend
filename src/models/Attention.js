const { pool } = require("../config/db");

const FIELDS = `
  attentions.id, attentions.beneficiary_id, attentions.role, attentions.author_id,
  attentions.attention_date, attentions.type, attentions.notes, attentions.images,
  attentions.created_at, attentions.updated_at,
  users.username AS author_username, beneficiaries.full_name AS beneficiary_name
`;
// LEFT JOIN: beneficiary_id es opcional (actividades grupales/de
// equipo no son de un estudiante puntual — ver attentionFields.js).
const JOINS = `
  JOIN users ON users.id = attentions.author_id
  LEFT JOIN beneficiaries ON beneficiaries.id = attentions.beneficiary_id
`;

// Trae los integrantes de varias actividades de una sola consulta y
// los agrupa por attention_id, para no hacer una consulta por fila al
// listar (N+1). Cada integrante es un estudiante registrado
// (beneficiary_id, con su nombre ya resuelto) o una persona suelta
// (full_name) — ver attention_participants en schema.js.
const attachParticipants = async (rows) => {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const { rows: participants } = await pool.query(
    `SELECT p.id, p.attention_id, p.beneficiary_id, p.full_name,
            b.full_name AS beneficiary_full_name
     FROM attention_participants p
     LEFT JOIN beneficiaries b ON b.id = p.beneficiary_id
     WHERE p.attention_id = ANY($1)
     ORDER BY p.id`,
    [ids]
  );
  const byAttention = new Map();
  for (const p of participants) {
    const list = byAttention.get(p.attention_id) || [];
    list.push({
      id: p.id,
      beneficiaryId: p.beneficiary_id,
      fullName: p.beneficiary_id ? p.beneficiary_full_name : p.full_name,
      isStudent: !!p.beneficiary_id,
    });
    byAttention.set(p.attention_id, list);
  }
  for (const row of rows) {
    row.participants = byAttention.get(row.id) || [];
    row.participant_count = row.participants.length;
  }
  return rows;
};

// role: si se pasa, solo trae atenciones de ese rol (así un rol no ve
// las notas clínicas de otro). beneficiaryId: filtra a un estudiante
// (coincide tanto con el campo legado attentions.beneficiary_id como
// con la nueva tabla de integrantes).
const findAll = async ({ role, roleIn, beneficiaryId } = {}) => {
  const conditions = [];
  const params = [];
  if (role) { params.push(role); conditions.push(`attentions.role = $${params.length}`); }
  if (roleIn?.length) { params.push(roleIn); conditions.push(`attentions.role = ANY($${params.length})`); }
  if (beneficiaryId) {
    params.push(beneficiaryId);
    conditions.push(`(attentions.beneficiary_id = $${params.length} OR EXISTS (
      SELECT 1 FROM attention_participants p WHERE p.attention_id = attentions.id AND p.beneficiary_id = $${params.length}
    ))`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${FIELDS} FROM attentions ${JOINS} ${where} ORDER BY attentions.attention_date DESC, attentions.id DESC`,
    params
  );
  return attachParticipants(rows);
};

const findById = async (id) => {
  const { rows } = await pool.query(`SELECT ${FIELDS} FROM attentions ${JOINS} WHERE attentions.id = $1`, [id]);
  if (!rows[0]) return null;
  await attachParticipants(rows);
  return rows[0];
};

// Reemplaza por completo la lista de integrantes de una actividad —
// más simple que calcular un diff, y el formulario del panel siempre
// manda la lista completa de todas formas.
const setParticipants = async (attentionId, participants) => {
  await pool.query("DELETE FROM attention_participants WHERE attention_id = $1", [attentionId]);
  if (!participants?.length) return;
  const values = [];
  const params = [];
  participants.forEach((p, i) => {
    const base = i * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(attentionId, p.beneficiaryId || null, p.beneficiaryId ? null : (p.fullName || "").trim());
  });
  await pool.query(
    `INSERT INTO attention_participants (attention_id, beneficiary_id, full_name) VALUES ${values.join(",")}`,
    params
  );
};

const create = async ({ beneficiaryId, role, authorId, attentionDate, type, notes, images, participants }) => {
  const { rows } = await pool.query(
    `INSERT INTO attentions (beneficiary_id, role, author_id, attention_date, type, notes, images)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [beneficiaryId || null, role, authorId, attentionDate, type, notes || null, JSON.stringify(images || [])]
  );
  if (participants) await setParticipants(rows[0].id, participants);
  return findById(rows[0].id);
};

const update = async (id, { attentionDate, type, notes, images, participants }) => {
  await pool.query(
    `UPDATE attentions SET
       attention_date = COALESCE($1, attention_date),
       type = COALESCE($2, type),
       notes = $3,
       images = COALESCE($4, images)
     WHERE id = $5`,
    [attentionDate, type, notes ?? null, images ? JSON.stringify(images) : null, id]
  );
  if (participants) await setParticipants(id, participants);
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
