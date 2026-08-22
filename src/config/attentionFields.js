// ── Expediente de atenciones ────────────────────────────────────
// Qué tipos de atención/actividad puede registrar cada rol. Cada
// registro tiene una fecha exacta — por eso este expediente es la
// fuente para AUTOCALCULAR los totales y series del informe
// periódico (ver reportFields.js): sus llaves ("key") coinciden a
// propósito con los statFields/monthlyFields.sourceType de ese rol,
// así que un simple COUNT agrupado por tipo y fecha basta.
//
// requiresBeneficiary: true si ese tipo es una atención a UN
// estudiante puntual (pide elegir a quién); false si es una
// actividad grupal/de equipo que no se registra por persona
// (taller, reunión...).
//
// Agregar un rol nuevo aquí no requiere migración de base de datos.

const ATTENTION_FIELDS = {
  psicologa: {
    label: "Atención psicológica",
    types: [
      { key: "atenciones_individuales",        label: "Atención individual",              requiresBeneficiary: true },
      { key: "talleres_presencial",            label: "Taller presencial",                requiresBeneficiary: false },
      { key: "talleres_virtual",               label: "Taller virtual",                   requiresBeneficiary: false },
      { key: "talleres_padres_familia",        label: "Taller padres de familia",         requiresBeneficiary: false },
      { key: "reuniones_equipo",               label: "Reunión de equipo",                requiresBeneficiary: false },
      { key: "reuniones_atencion_psicosocial", label: "Reuniones con adolescentes para atención psicosocial", requiresBeneficiary: true },
    ],
  },
};

const getAttentionFields = (role) => ATTENTION_FIELDS[role] || null;

module.exports = { ATTENTION_FIELDS, getAttentionFields };
