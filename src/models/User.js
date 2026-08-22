const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");

const PUBLIC_FIELDS = "id, username, email, role, active, photo_url, must_change_password, created_at, last_login";

const findAll = async () => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY created_at ASC`);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
};

const findByUsername = async (username) => {
  const { rows } = await pool.query(
    "SELECT id, username, email, password, role, photo_url, active, must_change_password FROM users WHERE LOWER(username) = LOWER($1)",
    [username]
  );
  return rows[0] || null;
};

const getPasswordHash = async (id) => {
  const { rows } = await pool.query("SELECT password FROM users WHERE id = $1", [id]);
  return rows[0]?.password || null;
};

const findByEmail = async (email) => {
  if (!email) return null;
  const { rows } = await pool.query(
    "SELECT id, username, email, role, active, google_sub, photo_url, must_change_password FROM users WHERE LOWER(email) = LOWER($1)",
    [email]
  );
  return rows[0] || null;
};

const findByGoogleSub = async (googleSub) => {
  const { rows } = await pool.query(
    "SELECT id, username, email, role, active, photo_url, must_change_password FROM users WHERE google_sub = $1",
    [googleSub]
  );
  return rows[0] || null;
};

const usernameTaken = async (username) => {
  const { rows } = await pool.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1)", [username]);
  return rows.length > 0;
};

// mustChangePassword: true por defecto porque quien crea la cuenta
// (admin/desarrollador, o el flujo de aprobar solicitud) es quien
// elige o genera la contraseña inicial — no es privada hasta que el
// usuario la cambie por una propia.
const create = async ({ username, email, password, role, mustChangePassword = true }) => {
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role`,
    [username.trim(), email?.trim() || null, hash, role, mustChangePassword]
  );
  return rows[0];
};

const updateRole = async (id, role) => pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
const updateActive = async (id, active) => pool.query("UPDATE users SET active = $1 WHERE id = $2", [!!active, id]);
const updateEmail = async (id, email) => pool.query("UPDATE users SET email = $1 WHERE id = $2", [email?.trim() || null, id]);
const updatePhoto = async (id, photoUrl) => pool.query("UPDATE users SET photo_url = $1 WHERE id = $2", [photoUrl || null, id]);
const updateLastLogin = async (id) => pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [id]);
const linkGoogle = async (id, googleSub) => pool.query("UPDATE users SET google_sub = $1 WHERE id = $2", [googleSub, id]);

// mustChangePassword se pasa explícito en cada llamada: false cuando
// el propio usuario cambia su contraseña sabiendo la actual (self-service),
// true cuando un admin/desarrollador la resetea por él.
const updatePassword = async (id, password, mustChangePassword) => {
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    "UPDATE users SET password = $1, must_change_password = $2 WHERE id = $3",
    [hash, !!mustChangePassword, id]
  );
};

const verifyPassword = async (candidate, hash) => {
  const dummyHash = "$2a$12$dummyhashfortimingprotectionXXXXXXXXXXXXXXXXXXXXXXXXX";
  return bcrypt.compare(candidate, hash ?? dummyHash);
};

const remove = async (id) => {
  const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
};

module.exports = {
  findAll, findById, findByUsername, findByEmail, findByGoogleSub, usernameTaken, getPasswordHash,
  create, updateRole, updateActive, updateEmail, updatePhoto, updateLastLogin,
  linkGoogle, updatePassword, verifyPassword, remove,
};
