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
    permissions: { manageUsers: true, manageContent: true, manageSettings: true, viewMessages: true },
    selfRequestable: false,
  },
  {
    name: "directora_programatica",
    label: "Directora Programática",
    description: "Fondos, comunicación, voluntariados, programas, becas, presupuestos y pagos.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "directora_tecnica",
    label: "Directora Técnica",
    description: "Convenios educativos, atención médica, compras, mantenimiento, equipo y contratos.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "tutora",
    label: "Tutora",
    description: "Inscripciones escolares, tutorías, material educativo y becas universitarias.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "auxiliar",
    label: "Auxiliar",
    description: "Acompañamiento escolar, reforzamiento académico y actividades recreativas.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "psicologa",
    label: "Psicóloga",
    description: "Atención individual y grupal, ceremonias mayas, orientación vocacional.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "trabajadora_social",
    label: "Trabajadora Social",
    description: "Salidas y visitas, talleres MAPAF, coordinación interinstitucional.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "cocinera",
    label: "Cocinera",
    description: "Compra de víveres y preparación de alimentos.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "panadera",
    label: "Panadera",
    description: "Preparación de pan y documentación del curso de panadería.",
    permissions: {},
    selfRequestable: true,
  },
  {
    name: "contadora",
    label: "Contadora",
    description: "Cheques, contabilidad, balances mensuales y declaraciones a SAT.",
    permissions: {},
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

// Llaves de permiso editables desde el panel (Roles y permisos).
// "fullAccess" queda fuera a propósito: es exclusivo del rol
// "desarrollador" y nunca se otorga por esta vía.
const PERMISSION_KEYS = ["manageUsers", "manageContent", "manageSettings", "viewMessages", "manageBeneficiaries"];

module.exports = { ROLE_DEFINITIONS, PERMISSION_KEYS };
