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
// categories: agrupa los types por tema (se muestran agrupados en el
// selector del panel, en vez de una lista plana). SHARED_CATEGORIES
// son las mismas para cualquier rol que las incluya (Atenciones,
// Reuniones, Formación y recreación) — agregarlas a un rol nunca
// toca ni renombra sus types existentes, solo le suma opciones
// nuevas. Si un rol ya tenía sus propios types sueltos (como
// psicóloga), quedan agrupados bajo su propia categoría al principio.
//
// Agregar un rol nuevo aquí no requiere migración de base de datos.

const SHARED_CATEGORIES = [
  {
    name: "Atenciones",
    types: [
      { key: "atencion_medica",                  label: "Atención médica",                 requiresBeneficiary: true },
      { key: "atencion_psicologica_individual",  label: "Atención psicológica individual", requiresBeneficiary: true },
      { key: "atencion_psicologica_grupal",      label: "Atención psicológica grupal",     requiresBeneficiary: false },
      { key: "orientacion_vocacional",           label: "Orientación vocacional",          requiresBeneficiary: true },
    ],
  },
  {
    name: "Reuniones",
    types: [
      { key: "reunion_equipo_general", label: "Reunión de equipo",  requiresBeneficiary: false },
      { key: "reunion_aj",             label: "Reunión con AJ",     requiresBeneficiary: false },
      { key: "reunion_jd",             label: "Reunión JD",         requiresBeneficiary: false },
    ],
  },
  {
    name: "Formación y recreación",
    types: [
      { key: "recreacion",      label: "Recreación",     requiresBeneficiary: false },
      { key: "capacitaciones",  label: "Capacitaciones", requiresBeneficiary: false },
      { key: "excursiones",     label: "Excursiones",    requiresBeneficiary: false },
      { key: "encuentros",      label: "Encuentros",     requiresBeneficiary: false },
    ],
  },
];

const ATTENTION_FIELDS_RAW = {
  psicologa: {
    label: "Atención psicológica",
    categories: [
      {
        name: "Atención psicológica",
        types: [
          { key: "atenciones_individuales",        label: "Atención individual",              requiresBeneficiary: true },
          { key: "talleres_presencial",            label: "Taller presencial",                requiresBeneficiary: false },
          { key: "talleres_virtual",               label: "Taller virtual",                   requiresBeneficiary: false },
          { key: "talleres_padres_familia",        label: "Taller padres de familia",         requiresBeneficiary: false },
          { key: "reuniones_equipo",               label: "Reunión de equipo",                requiresBeneficiary: false },
          { key: "reuniones_atencion_psicosocial", label: "Reuniones con adolescentes para atención psicosocial", requiresBeneficiary: true },
        ],
      },
      ...SHARED_CATEGORIES,
    ],
  },

  trabajadora_social: {
    label: "Trabajo social",
    categories: [
      {
        name: "Trabajo social",
        types: [
          { key: "taller_mapaf",      label: "Taller MAPAF",      requiresBeneficiary: false },
          { key: "visita_domiciliar", label: "Visita domiciliar", requiresBeneficiary: true },
        ],
      },
      ...SHARED_CATEGORIES,
    ],
  },
};

// Aplana categories en un solo arreglo "types" (lo que ya esperaba el
// resto del backend: validación, resumen para informes, etc.) para no
// tener que tocar esa lógica al agregar categorías.
const ATTENTION_FIELDS = Object.fromEntries(
  Object.entries(ATTENTION_FIELDS_RAW).map(([role, cfg]) => [
    role,
    { ...cfg, types: cfg.categories.flatMap((c) => c.types) },
  ])
);

const getAttentionFields = (role) => ATTENTION_FIELDS[role] || null;

module.exports = { ATTENTION_FIELDS, getAttentionFields };
