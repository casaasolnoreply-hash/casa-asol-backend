const { pool } = require("../config/db");

const create = async ({ name, email, phone, requestedRole, message, source = "system", googleSub = null, googlePhoto = null }) => {
  const { rows } = await pool.query(
    `INSERT INTO user_requests (name, email, phone, requested_role, message, source, google_sub, google_photo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [name.trim(), email.trim(), phone?.trim() || null, requestedRole, message?.trim() || null, source, googleSub, googlePhoto]
  );
  return rows[0];
};

const findPending = async () => {
  const { rows } = await pool.query(
    "SELECT * FROM user_requests WHERE status = 'pending' ORDER BY created_at ASC"
  );
  return rows;
};

const findPendingByEmail = async (email) => {
  const { rows } = await pool.query(
    "SELECT id FROM user_requests WHERE LOWER(email) = LOWER($1) AND status = 'pending'",
    [email]
  );
  return rows[0] || null;
};

const findById = async (id) => {
  const { rows } = await pool.query("SELECT * FROM user_requests WHERE id = $1", [id]);
  return rows[0] || null;
};

const markReviewed = async (id, status, reviewerId) => {
  await pool.query(
    "UPDATE user_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3",
    [status, reviewerId, id]
  );
};

const countPending = async () => {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM user_requests WHERE status = 'pending'");
  return rows[0].n;
};

module.exports = { create, findPending, findPendingByEmail, findById, markReviewed, countPending };
