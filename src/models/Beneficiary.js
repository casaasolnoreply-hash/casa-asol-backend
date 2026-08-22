const { pool } = require("../config/db");

const FIELDS = "id, full_name, birth_date, school, grade_level, status, admission_date, notes, created_by, created_at, updated_at";

const findAll = async ({ status } = {}) => {
  if (status) {
    const { rows } = await pool.query(`SELECT ${FIELDS} FROM beneficiaries WHERE status = $1 ORDER BY full_name`, [status]);
    return rows;
  }
  const { rows } = await pool.query(`SELECT ${FIELDS} FROM beneficiaries ORDER BY full_name`);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`SELECT ${FIELDS} FROM beneficiaries WHERE id = $1`, [id]);
  return rows[0] || null;
};

const create = async ({ fullName, birthDate, school, gradeLevel, admissionDate, notes, createdBy }) => {
  const { rows } = await pool.query(
    `INSERT INTO beneficiaries (full_name, birth_date, school, grade_level, admission_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${FIELDS}`,
    [fullName.trim(), birthDate || null, school || null, gradeLevel || null, admissionDate || null, notes || null, createdBy || null]
  );
  return rows[0];
};

const update = async (id, { fullName, birthDate, school, gradeLevel, status, admissionDate, notes }) => {
  const { rows } = await pool.query(
    `UPDATE beneficiaries SET
       full_name = COALESCE($1, full_name),
       birth_date = $2,
       school = $3,
       grade_level = $4,
       status = COALESCE($5, status),
       admission_date = $6,
       notes = $7
     WHERE id = $8 RETURNING ${FIELDS}`,
    [fullName?.trim(), birthDate || null, school || null, gradeLevel || null, status, admissionDate || null, notes || null, id]
  );
  return rows[0] || null;
};

const remove = async (id) => {
  const { rowCount } = await pool.query("DELETE FROM beneficiaries WHERE id = $1", [id]);
  return rowCount > 0;
};

module.exports = { findAll, findById, create, update, remove };
