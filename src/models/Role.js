const { pool } = require("../config/db");

const findAll = async () => {
  const { rows } = await pool.query("SELECT * FROM roles ORDER BY id");
  return rows;
};

// Roles que pueden aparecer en el formulario público de "Solicitar acceso".
const findSelfRequestable = async () => {
  const { rows } = await pool.query(
    "SELECT name, label, description FROM roles WHERE self_requestable = TRUE ORDER BY label"
  );
  return rows;
};

const findByName = async (name) => {
  const { rows } = await pool.query("SELECT * FROM roles WHERE name = $1", [name]);
  return rows[0] || null;
};

const exists = async (name) => !!(await findByName(name));

const updateLabel = async (name, label, description) => {
  const { rows } = await pool.query(
    "UPDATE roles SET label = $1, description = $2 WHERE name = $3 RETURNING *",
    [label, description || "", name]
  );
  return rows[0] || null;
};

const updatePermissions = async (name, permissions) => {
  const { rows } = await pool.query(
    "UPDATE roles SET permissions = $1 WHERE name = $2 RETURNING *",
    [JSON.stringify(permissions), name]
  );
  return rows[0] || null;
};

const create = async ({ name, label, description, permissions, selfRequestable }) => {
  const { rows } = await pool.query(
    `INSERT INTO roles (name, label, description, permissions, self_requestable)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, label, description || "", JSON.stringify(permissions || {}), !!selfRequestable]
  );
  return rows[0];
};

const remove = async (name) => {
  const { rowCount } = await pool.query("DELETE FROM roles WHERE name = $1", [name]);
  return rowCount > 0;
};

// Registra que este nombre se borró a propósito, para que seedRoles()
// no lo vuelva a crear en el próximo arranque si era un rol de fábrica.
const markDeleted = async (name) => {
  await pool.query("INSERT INTO deleted_roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
};

// Cuántas cuentas tienen asignado este rol — para impedir borrarlo
// mientras alguien lo esté usando.
const countUsers = async (name) => {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = $1", [name]);
  return rows[0].n;
};

module.exports = { findAll, findSelfRequestable, findByName, exists, updateLabel, updatePermissions, create, remove, markDeleted, countUsers };
