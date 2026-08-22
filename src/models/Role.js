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

const updatePermissions = async (name, permissions) => {
  const { rows } = await pool.query(
    "UPDATE roles SET permissions = $1 WHERE name = $2 RETURNING *",
    [JSON.stringify(permissions), name]
  );
  return rows[0] || null;
};

module.exports = { findAll, findSelfRequestable, findByName, exists, updatePermissions };
