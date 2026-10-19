// Estacion UTHH · simulador de sensores.
//   node simulador.js              -> una lectura por sensor cada segundo (Ctrl + C para detener)
//   node simulador.js historico 7  -> genera los ultimos 7 dias, una lectura cada 2 minutos

const { crearCliente, leerSensores, guardarLectura } = require("./bd");

const cliente = crearCliente();

// Temperatura y humedad "realistas": ciclo del dia (maximo a las 15 h) + ruido
function simular(sensor, fecha) {
  const hora = (fecha.getUTCHours() - 6 + 24) % 24 + fecha.getUTCMinutes() / 60; // hora en Mexico
  const exterior = sensor.tipo === "exterior";
  const base = exterior ? 28 : 25, amplitud = exterior ? 7 : 3;
  let t = base + amplitud * Math.cos(2 * Math.PI * (hora - 15) / 24) + (Math.random() - 0.5);
  if (Math.random() < 0.01) t += 5; // pico ocasional
  const h = Math.max(30, Math.min(95, 75 - (t - base) * 2.5 + (Math.random() - 0.5) * 4));
  return { hora: fecha, temperatura: Math.round(t * 10) / 10, humedad: Math.round(h) };
}

async function enVivo(sensores) {
  console.log("Simulando " + sensores.length + " sensores cada segundo. Ctrl + C para detener.");
  setInterval(async () => {
    const ahora = new Date();
    const partes = [];
    for (const s of sensores) {
      const l = simular(s, ahora);
      const r = await guardarLectura(cliente, s, l);
      partes.push(s.id + " " + l.temperatura + "°C " + l.humedad + "%" + (r.alerta ? " ALERTA" : ""));
    }
    console.log(ahora.toLocaleTimeString("es-MX") + "  " + partes.join(" | "));
  }, 1000);
}

async function historico(sensores, dias) {
  const paso = 2 * 60 * 1000, fin = Date.now() - 60000, inicio = fin - dias * 86400000;
  const tareas = [];
  for (const s of sensores) {
    for (let t = inicio; t <= fin; t += paso) tareas.push([s, simular(s, new Date(t))]);
  }
  console.log("Escribiendo " + tareas.length + " lecturas de " + dias + " dias...");
  const t0 = Date.now();
  let i = 0;
  async function trabajador() { // 50 trabajadores escriben al mismo tiempo
    while (i < tareas.length) {
      const [s, l] = tareas[i++];
      await guardarLectura(cliente, s, l, null, true);
      if (i % 2000 === 0) console.log("  " + i + " lecturas...");
    }
  }
  await Promise.all(Array.from({ length: 50 }, trabajador));
  const seg = (Date.now() - t0) / 1000;
  console.log("Listo: " + tareas.length + " lecturas en " + seg.toFixed(1) + " s (" +
    Math.round(tareas.length / seg) + " por segundo).");
  await cliente.shutdown();
}

leerSensores(cliente).then(mapa => {
  const sensores = Object.values(mapa);
  if (!sensores.length) { console.log("Primero inserta los sensores en estacion.sensores."); process.exit(1); }
  if (process.argv[2] === "historico") return historico(sensores, Number(process.argv[3]) || 7);
  return enVivo(sensores);
}).catch(e => { console.error("Error:", e.message); process.exit(1); });