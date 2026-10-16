const { pool } = require("../config/db");

const FIELDS = `
  d.id, d.report_id, d.author_id, d.content, d.status, d.score,
  d.reviewed_by, d.reviewed_at, d.submitted_at,
  d.original_docx_url, d.original_docx_name, d.created_at, d.updated_at,
  r.report_code, r.role, r.period_type, r.period_start, r.period_end,
  author.username AS author_username, reviewer.username AS reviewer_username
`;

const BASE_JOIN = `
  FROM report_documents d
  JOIN reports r       ON r.id = d.report_id
  JOIN users   author   ON author.id = d.author_id
  LEFT JOIN users reviewer ON reviewer.id = d.reviewed_by
`;

// role/roleIn: igual que Report.findAll, recorta por el rol del informe
// (el "tipo de informe"). authorId/status/dateFrom/dateTo son filtros
// directos del listado (ver routes/documents.js).
const findAll = async ({ role, roleIn, authorId, status, dateFrom, dateTo } = {}) => {
  const conditions = [];
  const params = [];
  if (role) { params.push(role); conditions.push(`r.role = $${params.length}`); }
  if (roleIn?.length) { params.push(roleIn); conditions.push(`r.role = ANY($${params.length})`); }
  if (authorId) { params.push(authorId); conditions.push(`d.author_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`d.status = $${params.length}`); }
  if (dateFrom) { params.push(dateFrom); conditions.push(`d.created_at >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); conditions.push(`d.created_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ${FIELDS.replace("d.content, ", "")} ${BASE_JOIN} ${where} ORDER BY d.updated_at DESC`,
    params
  );
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`SELECT ${FIELDS} ${BASE_JOIN} WHERE d.id = $1`, [id]);
  return rows[0] || null;
};

const findByReportId = async (reportId) => {
  const { rows } = await pool.query(`SELECT ${FIELDS} ${BASE_JOIN} WHERE d.report_id = $1`, [reportId]);
  return rows[0] || null;
};

const create = async (reportId, authorId) => {
  const { rows } = await pool.query(
    `INSERT INTO report_documents (report_id, author_id) VALUES ($1, $2)
     ON CONFLICT (report_id) DO NOTHING RETURNING id`,
    [reportId, authorId]
  );
  const id = rows[0]?.id || (await findByReportId(reportId)).id;
  return findById(id);
};

// Autoguardado: solo contenido, nunca crea versión.
const updateContent = async (id, content) => {
  await pool.query("UPDATE report_documents SET content = $1 WHERE id = $2", [JSON.stringify(content), id]);
  return findById(id);
};

// Guardado manual: actualiza el contenido actual Y agrega una fila al
// historial — así "la versión actual" y "la última del historial"
// siempre coinciden.
const saveVersion = async (id, content, label, userId) => {
  await pool.query("UPDATE report_documents SET content = $1 WHERE id = $2", [JSON.stringify(content), id]);
  await pool.query(
    "INSERT INTO report_document_versions (document_id, content, label, created_by) VALUES ($1, $2, $3, $4)",
    [id, JSON.stringify(content), label || null, userId]
  );
  return findById(id);
};

const listVersions = async (documentId) => {
  const { rows } = await pool.query(
    `SELECT v.id, v.content, v.label, v.created_at, u.username AS created_by_username
     FROM report_document_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.document_id = $1 ORDER BY v.created_at DESC`,
    [documentId]
  );
  return rows;
};

const findVersionById = async (documentId, versionId) => {
  const { rows } = await pool.query(
    "SELECT * FROM report_document_versions WHERE id = $1 AND document_id = $2",
    [versionId, documentId]
  );
  return rows[0] || null;
};

// Restaurar NO reescribe el historial: copia el contenido de esa
// versión como el actual y agrega una versión nueva con ese mismo
// contenido (la restauración queda registrada, no se pierde nada).
const restoreVersion = async (documentId, versionId, userId) => {
  const version = await findVersionById(documentId, versionId);
  if (!version) return null;
  return saveVersion(documentId, version.content, "Restaurado de una versión anterior", userId);
};

const submit = async (id) => {
  await pool.query(
    "UPDATE report_documents SET status = 'enviado', submitted_at = NOW() WHERE id = $1",
    [id]
  );
  return findById(id);
};

const startReview = async (id, reviewerId) => {
  await pool.query(
    "UPDATE report_documents SET status = 'en_revision', reviewed_by = $1 WHERE id = $2",
    [reviewerId, id]
  );
  return findById(id);
};

const grade = async (id, reviewerId, score) => {
  await pool.query(
    "UPDATE report_documents SET status = 'calificado', score = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3",
    [score ?? null, reviewerId, id]
  );
  return findById(id);
};

const returnToAuthor = async (id, reviewerId) => {
  await pool.query(
    "UPDATE report_documents SET status = 'devuelto_a_correccion', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
    [reviewerId, id]
  );
  return findById(id);
};

const listComments = async (documentId) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.document_id, c.author_id, c.body, c.anchor_from, c.anchor_to, c.quote, c.resolved, c.created_at,
            u.username AS author_username
     FROM report_document_comments c JOIN users u ON u.id = c.author_id
     WHERE c.document_id = $1 ORDER BY c.created_at ASC`,
    [documentId]
  );
  return rows;
};

const addComment = async (documentId, authorId, { body, anchorFrom, anchorTo, quote }) => {
  const { rows } = await pool.query(
    `INSERT INTO report_document_comments (document_id, author_id, body, anchor_from, anchor_to, quote)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [documentId, authorId, body, anchorFrom ?? null, anchorTo ?? null, quote ?? null]
  );
  const { rows: all } = await pool.query(
    `SELECT c.id, c.document_id, c.author_id, c.body, c.anchor_from, c.anchor_to, c.quote, c.resolved, c.created_at,
            u.username AS author_username
     FROM report_document_comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
    [rows[0].id]
  );
  return all[0];
};

const resolveComment = async (commentId, resolved) => {
  await pool.query("UPDATE report_document_comments SET resolved = $1 WHERE id = $2", [!!resolved, commentId]);
};

const setOriginalDocx = async (id, url, name) => {
  await pool.query(
    "UPDATE report_documents SET original_docx_url = $1, original_docx_name = $2 WHERE id = $3",
    [url, name, id]
  );
  return findById(id);
};

// Quita la referencia al .docx original subido por error (ej. se
// adjuntó el archivo equivocado) — no borra el archivo de Cloudinary
// (mismo criterio que el resto del sitio: cambiar/quitar una imagen
// nunca borra el archivo de Cloudinary, solo deja de referenciarlo).
const clearOriginalDocx = async (id) => {
  await pool.query(
    "UPDATE report_documents SET original_docx_url = NULL, original_docx_name = NULL WHERE id = $1",
    [id]
  );
  return findById(id);
};

module.exports = {
  findAll, findById, findByReportId, create, updateContent, saveVersion,
  listVersions, findVersionById, restoreVersion, submit, startReview,
  grade, returnToAuthor, listComments, addComment, resolveComment,
  setOriginalDocx, clearOriginalDocx,
};
