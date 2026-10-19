// Estacion UTHH · servidor web y API REST sobre Cassandra.
// Entrega las paginas de la carpeta web/ y responde las rutas /api/... con JSON.
// Cada respuesta trae "cql": las sentencias que se ejecutaron en Cassandra.

const http = require("http");   // servidor web incluido en Node.js
const fs = require("fs");       // para leer los archivos de web/
const path = require("path");
const { KS, LocalDate, crearCliente, diaLocal, ejecutar, guardarLectura, leerSensores } = require("./bd");

const PUERTO = 3000;
const WEB = path.join(__dirname, "web");
const TABLAS = ["sensores", "lecturas_por_sensor_dia", "ultima_lectura", "alertas_por_dia", "conteo_por_dia"];

const cliente = crearCliente(); // UNA conexion para todo el servidor

// ------------------------------------------------------------------ rutas de la API

// GET /api/estado : version de Cassandra y tablas que ya existen en el keyspace
async function estado() {
  const cql = [];
  const v = (await ejecutar(cliente, "SELECT release_version FROM system.local", [], cql)).first();
  const t = await ejecutar(cliente, "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?", [KS], cql);
  const tablas = t.rows.map(r => r.table_name);
  return { version: v.release_version, tablas, faltan: TABLAS.filter(x => !tablas.includes(x)), cql };
}

// GET /api/sensores : catalogo + ultima lectura + lecturas de hoy de cada sensor
async function sensores() {
  const cql = [];
  const hoy = diaLocal();
  const catalogo = await leerSensores(cliente, cql);
  const ultimas = {};
  const u = await ejecutar(cliente, `SELECT sensor, hora, temperatura, humedad FROM ${KS}.ultima_lectura`, [], cql);
  for (const r of u.rows) ultimas[r.sensor] = { hora: r.hora, temperatura: r.temperatura, humedad: r.humedad };
  const lista = [];
  for (const s of Object.values(catalogo)) {
    const c = await ejecutar(cliente, `SELECT lecturas FROM ${KS}.conteo_por_dia WHERE sensor = ? AND dia = ?`,
      [s.id, LocalDate.fromString(hoy)], cql);
    const fila = c.first();
    lista.push({ ...s, ultima: ultimas[s.id] || null, lecturasHoy: fila ? Number(fila.lecturas) : 0 });
  }
  lista.sort((a, b) => a.id.localeCompare(b.id));
  return { hoy, sensores: lista, cql };
}

// GET /api/sensores/uthh-01/lecturas?dia=AAAA-MM-DD&limite=1000 : UNA particion (sensor, dia)
async function lecturas(id, q) {
  const cql = [];
  const dia = q.get("dia") || diaLocal();
  const limite = Math.min(Number(q.get("limite")) || 1000, 5000);
  const r = await ejecutar(cliente,
    `SELECT hora, temperatura, humedad FROM ${KS}.lecturas_por_sensor_dia WHERE sensor = ? AND dia = ? LIMIT ?`,
    [id, LocalDate.fromString(dia), limite], cql);
  return { sensor: id, dia, lecturas: r.rows.map(x => ({ hora: x.hora, temperatura: x.temperatura, humedad: x.humedad })), cql };
}

// GET /api/alertas?dia=AAAA-MM-DD : las alertas de un dia (una sola particion)
async function alertas(q) {
  const cql = [];
  const dia = q.get("dia") || diaLocal();
  const r = await ejecutar(cliente,
    `SELECT hora, sensor, temperatura, mensaje FROM ${KS}.alertas_por_dia WHERE dia = ? LIMIT 200`,
    [LocalDate.fromString(dia)], cql);
  return { dia, alertas: r.rows.map(x => ({ hora: x.hora, sensor: x.sensor, temperatura: x.temperatura, mensaje: x.mensaje })), cql };
}

// POST /api/lecturas {"sensor":"uthh-01","temperatura":27.5,"humedad":70}
async function registrar(datos) {
  const cql = [];
  const s = (await leerSensores(cliente, cql))[datos.sensor];
  if (!s) throw new Error("No existe el sensor " + datos.sensor);
  const t = Number(datos.temperatura), h = Number(datos.humedad);
  if (!(t >= -20 && t <= 60)) throw new Error("La temperatura debe estar entre -20 y 60 °C");
  if (!(h >= 0 && h <= 100)) throw new Error("La humedad debe estar entre 0 y 100 %");
  const r = await guardarLectura(cliente, s, { hora: new Date(), temperatura: t, humedad: h }, cql);
  return { sensor: s.id, dia: r.dia, alerta: r.alerta, cql };
}

// ------------------------------------------------------------------ servidor

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ruta = url.pathname;

  // 1) Archivos de la carpeta web/ (index.html, estilos.css, app.js...)
  if (!ruta.startsWith("/api/")) {
    const archivo = path.join(WEB, ruta === "/" ? "index.html" : path.normalize(ruta));
    if (!archivo.startsWith(WEB)) { res.writeHead(403); return res.end(); }
    return fs.readFile(archivo, (e, contenido) => {
      if (e) { res.writeHead(404); return res.end("No encontrado"); }
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "text/plain" });
      res.end(contenido);
    });
  }

  // 2) Rutas de la API: siempre responden JSON
  let codigo = 200, respuesta;
  try {
    let m;
    if (req.method === "GET" && ruta === "/api/estado") respuesta = await estado();
    else if (req.method === "GET" && ruta === "/api/sensores") respuesta = await sensores();
    else if (req.method === "GET" && (m = ruta.match(/^\/api\/sensores\/([\w-]+)\/lecturas$/))) respuesta = await lecturas(m[1], url.searchParams);
    else if (req.method === "GET" && ruta === "/api/alertas") respuesta = await alertas(url.searchParams);
    else if (req.method === "POST" && ruta === "/api/lecturas") {
      let cuerpo = "";
      for await (const parte of req) cuerpo += parte; // lee el JSON que envio la pagina
      respuesta = await registrar(JSON.parse(cuerpo || "{}"));
    }
    else { codigo = 404; respuesta = { error: "Ruta no encontrada: " + ruta }; }
  } catch (e) {
    codigo = 400;
    respuesta = { error: e.message };
    console.error("Error:", e.message);
  }
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(respuesta));
}).listen(PUERTO, () => console.log("Estacion UTHH en el puerto " + PUERTO + " (pestana Puertos -> 3000)"));