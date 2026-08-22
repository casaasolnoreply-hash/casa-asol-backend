const crypto = require("crypto");

// Convierte "Maria Jose Ramirez" + "maria@x.com" en un candidato de
// username legible (se desambigua con sufijos numéricos si ya existe).
const suggestUsername = (name, email) => {
  const base = (name || email.split("@")[0])
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // quitar acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return base || "usuario";
};

const generateTempPassword = () => crypto.randomBytes(9).toString("base64url"); // 12 chars, url-safe

module.exports = { suggestUsername, generateTempPassword };
