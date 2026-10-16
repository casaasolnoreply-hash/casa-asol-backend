// ── Definición de roles de Casa ASOL ──────────────────────────
// Única fuente de verdad para los roles del sistema. db.js siembra
// estos registros al iniciar (INSERT ... ON CONFLICT DO NOTHING),
// así que agregar/editar un rol aquí y reiniciar el backend basta
// para que quede disponible.
//
// `permissions` son llaves de alto nivel usadas por el middleware
// (ver middleware/authorize.js). Los roles operativos (tutora,
// psicóloga, etc.) no tienen permisos especiales todavía: podrán
// iniciar sesión y ver su panel, y sus módulos de datos propios se
// añadirán permiso por permiso más adelante sin tener que tocar
// esta lista.
//
// `selfRequestable`: si aparece en el formulario público de
// "Solicitar acceso". admin y desarrollador se asignan solo desde
// el panel de usuarios, nunca por autoservicio.

// Valores por defecto de los 6 permisos "escalables" (ver abajo,
// SCOPED_PERMISSION_KEYS) elegidos para reproducir EXACTAMENTE el
// comportamiento que ya existía antes de que estos permisos fueran
// configurables (lo que antes eran listas de roles fijas en el
// código, p.ej. reports.js `canSeeAll` o la condición de la barra
// lateral para Actividades/Galería).
const OPERATIONAL_DEFAULTS = { crearInformes: true, verEstudiantes: true, crearActividades: true };
const DIRECTOR_DEFAULTS    = { ...OPERATIONAL_DEFAULTS, verInformes: true, verInformesPorUsuario: true, aceptarInformes: true, crearActividades: false };

const ROLE_DEFINITIONS = [
  {
    name: "desarrollador",
    label: "Desarrollador",
    description: "Acceso total: código, datos, usuarios, roles y configuración del sistema.",
    permissions: { fullAccess: true },
    selfRequestable: false,
  },
  {
    name: "admin",
    label: "Administrador",
    description: "Gestión de usuarios, contenido del sitio, mensajes y ajustes.",
    permissions: {
      manageUsers: true, manageContent: true, manageSettings: true, viewMessages: true,
      verImagenes: true, verInformes: true, verInformesPorUsuario: true, aceptarInformes: true, crearInformes: true,
      verEstudiantes: true, crearActividades: true, gestionarTiposActividad: true,
    },
    selfRequestable: false,
  },
  {
    name: "directora_programatica",
    label: "Directora Programática",
    description: "Fondos, comunicación, voluntariados, programas, becas, presupuestos y pagos.",
    permissions: { ...DIRECTOR_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "directora_tecnica",
    label: "Directora Técnica",
    description: "Convenios educativos, atención médica, compras, mantenimiento, equipo y contratos.",
    permissions: { ...DIRECTOR_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "tutora",
    label: "Tutora",
    description: "Inscripciones escolares, tutorías, material educativo y becas universitarias.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "auxiliar",
    label: "Auxiliar",
    description: "Acompañamiento escolar, reforzamiento académico y actividades recreativas.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "psicologa",
    label: "Psicóloga",
    description: "Atención individual y grupal, ceremonias mayas, orientación vocacional.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "trabajadora_social",
    label: "Trabajadora Social",
    description: "Salidas y visitas, talleres MAPAF, coordinación interinstitucional.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "cocinera",
    label: "Cocinera",
    description: "Compra de víveres y preparación de alimentos.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "panadera",
    label: "Panadera",
    description: "Preparación de pan y documentación del curso de panadería.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },
  {
    name: "contadora",
    label: "Contadora",
    description: "Cheques, contabilidad, balances mensuales y declaraciones a SAT.",
    permissions: { ...OPERATIONAL_DEFAULTS },
    selfRequestable: true,
  },

  // ── Roles heredados ──────────────────────────────────────────
  // Ya no se asignan desde el panel (no aparecen en los formularios),
  // pero se siembran para que las cuentas creadas antes de este
  // cambio sigan funcionando sin migrar datos a la fuerza.
  {
    name: "editor",
    label: "Editor (heredado)",
    description: "Rol heredado: edita contenido del sitio, sin gestión de usuarios.",
    permissions: { manageContent: true, viewMessages: true },
    selfRequestable: false,
  },
  {
    name: "viewer",
    label: "Visor (heredado)",
    description: "Rol heredado: solo lectura del panel de administración.",
    permissions: {},
    selfRequestable: false,
  },
];

// Llaves de permiso simples (sí/no) editables desde el panel.
// "fullAccess" queda fuera a propósito: es exclusivo del rol
// "desarrollador" y nunca se otorga por esta vía.
const PERMISSION_KEYS = ["manageUsers", "manageContent", "manageSettings", "viewMessages", "manageBeneficiaries", "gestionarTiposActividad"];

// Llaves de permiso "escalables": en vez de solo sí/no, cada una
// puede valer `true` (todos los roles), `false`/ausente (ninguno) o
// un arreglo de nombres de rol (algunos en concreto) — ver
// middleware/authorize.js `scopeValue()`. Controlan qué tan lejos ve
// o actúa un rol sobre los datos de OTROS roles.
const SCOPED_PERMISSION_KEYS = [
  "verImagenes", "verInformes", "verInformesPorUsuario", "aceptarInformes", "crearInformes", "verEstudiantes", "crearActividades",
];

module.exports = { ROLE_DEFINITIONS, PERMISSION_KEYS, SCOPED_PERMISSION_KEYS, OPERATIONAL_DEFAULTS };
