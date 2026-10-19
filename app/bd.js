// Estacion UTHH · conexion con Cassandra y escritura de lecturas.
// Lo usan el servidor web y el simulador.

const cassandra = require("cassandra-driver"); // controlador oficial de Cassandra para Node.js
const { LocalDate } = cassandra.types;         // tipo para las columnas "date"

const KS = "estacion";                // keyspace (el equivalente a la "base de datos")
const ZONA = "America/Mexico_City";   // zona horaria para decidir el "dia" de cada lectura

// Cliente: se conecta al nodo de Cassandra que corre en Docker, puerto 9042
function crearCliente() {
  return new cassandra.Client({
    contactPoints: ["127.0.0.1"],     // direccion del nodo
    localDataCenter: "datacenter1",   // centro de datos (el nombre por defecto)
  });
}

// Dia local en formato AAAA-MM-DD (en Mexico, no en UTC)
function diaLocal(fecha = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(fecha);
}

// Arma el texto del CQL con los valores en lugar de los ?, para mostrarlo en la pagina
function mostrar(cql, params) {
  let i = 0;
  return cql.replace(/\?/g, () => {
    const v = params[i++];
    if (typeof v === "number") return String(v);
    if (v instanceof Date) return "'" + v.toISOString() + "'";
    return "'" + String(v) + "'";
  });
}

// Ejecuta una sentencia preparada (los ? se llenan con params) y la anota en la bitacora
async function ejecutar(cliente, cql, params, bitacora) {
  if (bitacora) bitacora.push(mostrar(cql, params));
  return cliente.execute(cql, params, { prepare: true });
}

// Lee la tabla sensores y la devuelve como { "uthh-01": {...}, ... }
async function leerSensores(cliente, bitacora) {
  const r = await ejecutar(cliente, `SELECT id, nombre, ubicacion, tipo, temp_max FROM ${KS}.sensores`, [], bitacora);
  const mapa = {};
  for (const f of r.rows) {
    mapa[f.id] = { id: f.id, nombre: f.nombre, ubicacion: f.ubicacion, tipo: f.tipo, temp_max: f.temp_max };
  }
  return mapa;
}

// Guarda UNA lectura en todas las tablas que la necesitan (modelo desnormalizado):
//   lecturas_por_sensor_dia -> historial (grafica)    ultima_lectura -> tablero (se sobrescribe)
//   alertas_por_dia -> solo si supera el umbral       conteo_por_dia -> contador del dia
async function guardarLectura(cliente, sensor, lectura, bitacora, historico = false) {
  const { hora, temperatura, humedad } = lectura;
  const dia = diaLocal(hora);
  const fecha = LocalDate.fromString(dia);

  const lote = [{
    query: `INSERT INTO ${KS}.lecturas_por_sensor_dia (sensor, dia, hora, temperatura, humedad) VALUES (?, ?, ?, ?, ?)`,
    params: [sensor.id, fecha, hora, temperatura, humedad],
  }];

  if (!historico) lote.push({   // los datos viejos no deben pisar la ultima lectura
    query: `INSERT INTO ${KS}.ultima_lectura (sensor, hora, temperatura, humedad) VALUES (?, ?, ?, ?)`,
    params: [sensor.id, hora, temperatura, humedad],
  });

  const alerta = temperatura > sensor.temp_max;
  if (alerta) lote.push({
    query: `INSERT INTO ${KS}.alertas_por_dia (dia, hora, sensor, temperatura, mensaje) VALUES (?, ?, ?, ?, ?)`,
    params: [fecha, hora, sensor.id, temperatura, sensor.nombre + " supera " + sensor.temp_max + " °C"],
  });

  if (bitacora) bitacora.push("BEGIN BATCH", ...lote.map(l => "  " + mostrar(l.query, l.params) + ";"), "APPLY BATCH;");
  await cliente.batch(lote, { prepare: true });   // BATCH: se aplican juntas

  // Un contador no puede ir en el mismo BATCH que tablas normales
  await ejecutar(cliente, `UPDATE ${KS}.conteo_por_dia SET lecturas = lecturas + 1 WHERE sensor = ? AND dia = ?`,
    [sensor.id, fecha], bitacora);

  return { dia, alerta };
}

module.exports = { KS, LocalDate, crearCliente, diaLocal, ejecutar, leerSensores, guardarLectura };