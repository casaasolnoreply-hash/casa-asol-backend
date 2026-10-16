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
      { key: "talleres_mapaf",                   label: "Talleres con MAPAF",              requiresBeneficiary: false },
    ],
  },
  {
    name: "Reuniones",
    types: [
      { key: "reunion_equipo_general",     label: "Reunión de equipo",          requiresBeneficiary: false },
      { key: "reunion_aj",                 label: "Reunión con AJ",             requiresBeneficiary: false },
      { key: "reunion_jd",                 label: "Reunión JD",                 requiresBeneficiary: false },
      { key: "reunion_interinstitucional", label: "Reunión interinstitucional", requiresBeneficiary: false },
      { key: "asamblea",                   label: "Asamblea",                   requiresBeneficiary: false },
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
  {
    name: "Varios",
    types: [
      { key: "mantenimiento", label: "Mantenimiento", requiresBeneficiary: false },
      { key: "gestiones",     label: "Gestiones",     requiresBeneficiary: false },
      { key: "comunicacion",  label: "Comunicación",  requiresBeneficiary: false },
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

  // El resto de roles operativos no tiene (todavía) tipos propios,
  // pero todas las personas del equipo pueden registrar las
  // categorías compartidas (Atenciones, Reuniones, Formación y
  // recreación, Varios) — antes solo psicóloga y trabajadora social
  // tenían acceso a Actividades.
  directora_programatica: { label: "Directora Programática", categories: [...SHARED_CATEGORIES] },
  directora_tecnica:      { label: "Directora Técnica",      categories: [...SHARED_CATEGORIES] },
  tutora:                 { label: "Tutora",                 categories: [...SHARED_CATEGORIES] },
  auxiliar:                { label: "Auxiliar",               categories: [...SHARED_CATEGORIES] },
  cocinera:               { label: "Cocinera",                categories: [...SHARED_CATEGORIES] },
  panadera:               { label: "Panadera",                categories: [...SHARED_CATEGORIES] },
  contadora:              { label: "Contadora",                categories: [...SHARED_CATEGORIES] },
};

// ── Tipos de actividad creados desde el panel (además de los de arriba) ──
// Se guardan en site_data (key "activityCustomCategories") para que un
// admin pueda agregar/editar/borrar tipos de actividad SIN que yo tenga
// que tocar este archivo. Cada uno es { categoryName, key, label,
// requiresBeneficiary }: `categoryName` no es una categoría aparte, es
// solo la etiqueta bajo la que se agrupa — si coincide con el nombre de
// una categoría que el rol ya tenía (de código, como "Atenciones", o
// personalizada), el tipo se SUMA a esa misma categoría; si no coincide
// con ninguna, se crea una categoría nueva con ese nombre. Así, "editar
// una categoría" o "agregar un tipo a una categoría que ya existía" es
// lo mismo: cambiar/poner ese `categoryName`.
//
// Solo se puede agregar/editar/borrar tipos personalizados — los que
// traía el código siguen fijos (varios están conectados a
// reportFields.js para autocalcular informes y tocarlos rompería eso).
let customTypes = [];
let dynamicRoles = []; // [{ name, label }] — roles creados desde "Roles y permisos"
                       // (ver routes/roles.js), que no están en el código. Reciben
                       // las categorías compartidas por defecto, igual que
                       // cualquier rol operativo simple (tutora, auxiliar...).
let ATTENTION_FIELDS = {};

// Suma los tipos personalizados a un arreglo de categorías ya clonado
// (mutándolo in-place) — lo usan tanto los roles de código como los
// dinámicos, para no repetir este bucle dos veces.
const applyCustomTypesTo = (categories) => {
  for (const ct of customTypes) {
    const typeObj = { key: ct.key, label: ct.label, requiresBeneficiary: !!ct.requiresBeneficiary };
    const target = categories.find((c) => c.name === ct.categoryName);
    if (target) target.types.push(typeObj);
    else categories.push({ name: ct.categoryName, types: [typeObj] });
  }
};

// Reconstruye ATTENTION_FIELDS (lo que el resto del backend consulta)
// combinando los roles de código + los roles dinámicos + los tipos
// personalizados. Se llama al arrancar y cada vez que se guardan
// cambios desde el panel (tipos nuevos o un rol nuevo).
const rebuild = () => {
  const entries = Object.entries(ATTENTION_FIELDS_RAW).map(([role, cfg]) => {
    const categories = cfg.categories.map((c) => ({ name: c.name, types: [...c.types] }));
    applyCustomTypesTo(categories);
    return [role, { ...cfg, categories, types: categories.flatMap((c) => c.types) }];
  });

  for (const r of dynamicRoles) {
    if (ATTENTION_FIELDS_RAW[r.name]) continue; // por si algún día se agrega en código, no duplicar
    const categories = SHARED_CATEGORIES.map((c) => ({ name: c.name, types: [...c.types] }));
    applyCustomTypesTo(categories);
    entries.push([r.name, { label: r.label, categories, types: categories.flatMap((c) => c.types) }]);
  }

  ATTENTION_FIELDS = Object.fromEntries(entries);
};
rebuild();

// Todas las llaves ("key") ya usadas en el código, de cualquier rol —
// para que el panel no deje crear un tipo nuevo que choque con uno
// existente y quede inalcanzable (ver validateCustomCategories en
// routes/attentions.js).
const getBuiltinKeys = () => {
  const keys = new Set();
  for (const cfg of Object.values(ATTENTION_FIELDS_RAW)) {
    for (const cat of cfg.categories) {
      for (const t of cat.types) keys.add(t.key);
    }
  }
  return keys;
};

const getAttentionFields = (role) => ATTENTION_FIELDS[role] || null;
// Nombres de rol con expediente configurado — función (no un objeto
// exportado directo) para que quien la llame siempre vea el estado
// actual, incluso después de que se agreguen categorías nuevas desde
// el panel en caliente (un `const { ATTENTION_FIELDS } = require(...)`
// de otro archivo se quedaría con la foto de cuando se importó).
const getConfiguredRoleNames = () => Object.keys(ATTENTION_FIELDS);
const getCustomTypes = () => customTypes;

// Nombres de categoría que ya existen en código, de cualquier rol —
// para sugerirlos en el panel (agregar un tipo con uno de estos nombres
// lo suma a esa categoría en vez de crear una nueva).
const getKnownCategoryNames = () => {
  const names = new Set();
  for (const cfg of Object.values(ATTENTION_FIELDS_RAW)) {
    for (const cat of cfg.categories) names.add(cat.name);
  }
  for (const ct of customTypes) names.add(ct.categoryName);
  return [...names];
};

const setCustomTypes = (types) => {
  customTypes = Array.isArray(types) ? types : [];
  rebuild();
};

// Se llama una sola vez al arrancar el servidor (ver app.js), para
// que lo guardado en una sesión anterior quede disponible de
// inmediato sin esperar a que alguien vuelva a guardar.
const loadCustomTypes = async () => {
  const { getData } = require("./db");
  const saved = await getData("activityCustomCategories");
  if (Array.isArray(saved)) setCustomTypes(saved);
};

// Registra un rol creado desde "Roles y permisos" (ver
// routes/roles.js POST /) para que tenga Actividades (categorías
// compartidas) de inmediato, sin reiniciar el servidor.
const addDynamicRole = (role) => {
  if (!dynamicRoles.some((r) => r.name === role.name)) dynamicRoles.push(role);
  rebuild();
};

const removeDynamicRole = (name) => {
  dynamicRoles = dynamicRoles.filter((r) => r.name !== name);
  rebuild();
};

// Al arrancar: trae todos los roles de la base de datos y registra
// como dinámicos los que no vengan ya de ATTENTION_FIELDS_RAW — así
// un rol creado en una sesión anterior sigue teniendo Actividades
// después de reiniciar el servidor.
const loadDynamicRoles = async () => {
  const Role = require("../models/Role");
  const roles = await Role.findAll();
  dynamicRoles = roles
    .filter((r) => !ATTENTION_FIELDS_RAW[r.name])
    .map((r) => ({ name: r.name, label: r.label }));
  rebuild();
};

module.exports = {
  getAttentionFields, getConfiguredRoleNames, getCustomTypes, setCustomTypes,
  getKnownCategoryNames, loadCustomTypes, getBuiltinKeys,
  addDynamicRole, removeDynamicRole, loadDynamicRoles,
};
