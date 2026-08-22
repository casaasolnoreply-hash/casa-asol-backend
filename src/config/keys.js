// ── Llaves RSA para firmar/verificar tokens de sesión (RS256) ──
// La llave privada firma el token al hacer login (solo el backend
// la conoce); la llave pública lo verifica en cada request protegido.
// Ambas viven en variables de entorno (nunca en el repo) con los
// saltos de línea escapados como "\n" porque un .env es de una sola
// línea por valor.
//
// Para generar un par nuevo:
//   node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});const e=s=>s.trim().split('\n').join('\\\\n');console.log('JWT_PRIVATE_KEY='+e(privateKey));console.log('JWT_PUBLIC_KEY='+e(publicKey));"

const unescape = (raw) => (raw ? raw.replace(/\\n/g, "\n") : null);

const PRIVATE_KEY = unescape(process.env.JWT_PRIVATE_KEY);
const PUBLIC_KEY  = unescape(process.env.JWT_PUBLIC_KEY);

module.exports = { PRIVATE_KEY, PUBLIC_KEY };
