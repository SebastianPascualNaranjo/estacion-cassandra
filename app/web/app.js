// Estacion UTHH · funciones que comparten todas las paginas.
// Las paginas NO hablan con Cassandra: le piden los datos a la API (/api/...)

// Pide algo a la API y devuelve el JSON; si hay error, lanza el mensaje del servidor
async function api(ruta, metodo = "GET", datos) {
  const opciones = { method: metodo, headers: { "Content-Type": "application/json" } };
  if (datos) opciones.body = JSON.stringify(datos);
  let r;
  try { r = await fetch("/api" + ruta, opciones); }
  catch (e) { throw new Error("Sin conexion con el servidor: revisa que node servidor.js siga corriendo."); }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || "Error HTTP " + r.status);
  return json;
}

// Crea un elemento HTML con clase y texto
function el(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

// Formatos: Cassandra guarda la hora en UTC; el navegador la muestra en hora local
const horaLocal = s => new Date(s).toLocaleTimeString("es-MX");
const num = n => (n === null || n === undefined) ? "—" : Number(n).toFixed(1);

function hoyLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function hace(s) {
  const seg = Math.round((Date.now() - new Date(s)) / 1000);
  return seg < 60 ? "hace " + Math.max(seg, 0) + " s" : seg < 3600 ? "hace " + Math.round(seg / 60) + " min" : new Date(s).toLocaleString("es-MX");
}

// Muestra un aviso (tipo "error" en rojo) dentro de un contenedor
function aviso(contenedor, texto, tipo = "") {
  contenedor.textContent = "";
  if (texto) contenedor.append(el("div", "aviso " + tipo, texto));
}

// Muestra el CQL que ejecuto la API
function verCql(contenedor, lineas) {
  contenedor.textContent = "";
  const d = el("details");
  d.append(el("summary", null, "CQL que ejecuto la API (" + lineas.length + ")"), el("pre", null, lineas.join("\n")));
  contenedor.append(d);
}

// Menu superior y estado de la conexion con Cassandra
function menu(actual) {
  const nav = el("nav");
  nav.append(el("b", null, "Estacion UTHH"));
  for (const [pagina, texto] of [["index.html", "Tablero"], ["sensor.html", "Sensor"], ["registrar.html", "Registrar"]]) {
    const a = el("a", null, texto); a.href = pagina;
    if (pagina === actual) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  const estado = el("span", null, "Conectando..."); estado.id = "estado";
  nav.append(estado);
  const header = el("header"); header.append(nav);
  document.body.prepend(header);
  api("/estado")
    .then(e => { estado.textContent = "● Cassandra " + e.version + (e.faltan.length ? " · faltan tablas" : ""); })
    .catch(e => { estado.textContent = "● Sin conexion"; estado.title = e.message; });
}

// Grafica SVG: temperatura (naranja, eje izquierdo) y humedad (azul, 0 a 100 %)
function grafica(contenedor, lecturas) {
  contenedor.textContent = "";
  if (!lecturas.length) { contenedor.append(el("p", "nota", "Sin lecturas en esta particion (sensor + dia).")); return; }
  const d = lecturas.slice().reverse(); // vienen de la mas nueva a la mas vieja
  const W = 800, H = 280, m = 40;
  const t0 = new Date(d[0].hora).getTime(), t1 = Math.max(new Date(d[d.length - 1].hora).getTime(), t0 + 1);
  const temps = d.map(x => x.temperatura);
  const tMin = Math.floor(Math.min(...temps) - 1), tMax = Math.ceil(Math.max(...temps) + 1);
  const x = t => m + (t - t0) / (t1 - t0) * (W - 2 * m);
  const yT = v => 10 + (1 - (v - tMin) / (tMax - tMin)) * (H - m - 10);
  const yH = v => 10 + (1 - v / 100) * (H - m - 10);
  const linea = (f, color) => `<path fill="none" stroke="${color}" stroke-width="2" d="${d.map((p, i) => (i ? "L" : "M") + x(new Date(p.hora).getTime()).toFixed(1) + " " + f(p).toFixed(1)).join(" ")}"/>`;
  let ejes = "";
  for (let k = 0; k <= 4; k++) {
    const v = tMin + (tMax - tMin) * k / 4, t = t0 + (t1 - t0) * k / 4;
    ejes += `<line x1="${m}" x2="${W - m}" y1="${yT(v)}" y2="${yT(v)}" stroke="#8899AA" stroke-opacity=".25"/>`
      + `<text x="${m - 6}" y="${yT(v) + 4}" text-anchor="end">${v.toFixed(0)}°</text>`
      + `<text x="${W - m + 6}" y="${yH(k * 25) + 4}">${k * 25}%</text>`
      + `<text x="${x(t)}" y="${H - 12}" text-anchor="middle">${new Date(t).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</text>`;
  }
  contenedor.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Grafica de temperatura y humedad">`
    + ejes + linea(p => yH(p.humedad), "#3A9BD9") + linea(p => yT(p.temperatura), "#D9822B") + "</svg>";
}