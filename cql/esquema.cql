-- Estacion UTHH · esquema de la base de datos en Apache Cassandra
-- En Cassandra primero se piensa en las CONSULTAS y despues en las tablas:
-- cada tabla responde una pregunta de la aplicacion.
-- Keyspace: el contenedor de las tablas (como la "base de datos" en MySQL).
-- replication_factor 1: una sola copia, porque tenemos un solo nodo.
CREATE KEYSPACE IF NOT EXISTS estacion
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
USE estacion;
-- Catalogo de sensores. Pregunta: "¿que sensores hay y cual es su umbral?"
CREATE TABLE IF NOT EXISTS sensores (
id text PRIMARY KEY, -- llave de particion: un sensor por particion
nombre text,
ubicacion text,
tipo text, -- interior o exterior
temp_max float -- umbral de alerta en °C
);
-- Historial. Pregunta: "¿como cambio la temperatura de UN sensor en UN dia?"
CREATE TABLE IF NOT EXISTS lecturas_por_sensor_dia (
sensor text,
dia date,
hora timestamp,
temperatura float,
humedad int,
PRIMARY KEY ((sensor, dia), hora) -- particion (sensor, dia); dentro, ordenadas por hora
) WITH CLUSTERING ORDER BY (hora DESC); -- la mas reciente primero
-- Tablero. Pregunta: "¿cual es la ultima lectura de cada sensor?"
CREATE TABLE IF NOT EXISTS ultima_lectura (
sensor text PRIMARY KEY, -- cada INSERT con el mismo sensor SOBRESCRIBE (upsert)
hora timestamp,
temperatura float,
humedad int
);
-- Alertas. Pregunta: "¿que alertas hubo en un dia?"
CREATE TABLE IF NOT EXISTS alertas_por_dia (
dia date,
hora timestamp,
sensor text,
temperatura float,
mensaje text,
PRIMARY KEY ((dia), hora, sensor) -- particion: el dia
) WITH CLUSTERING ORDER BY (hora DESC, sensor ASC);
-- Contador. Pregunta: "¿cuantas lecturas lleva cada sensor por dia?"
CREATE TABLE IF NOT EXISTS conteo_por_dia (
sensor text,
dia date,
lecturas counter, -- tipo especial: solo se suma o se resta
PRIMARY KEY ((sensor), dia)
) WITH CLUSTERING ORDER BY (dia DESC);
-- Los tres sensores de la escuela
INSERT INTO sensores (id, nombre, ubicacion, tipo, temp_max) VALUES ('uthh-01', 'Biblioteca',
'Edificio A, planta alta', 'interior', 30);
INSERT INTO sensores (id, nombre, ubicacion, tipo, temp_max) VALUES ('uthh-02', 'Cafeteria',
'Edificio C', 'interior', 32);
INSERT INTO sensores (id, nombre, ubicacion, tipo, temp_max) VALUES ('uthh-03', 'Explanada', 'Patio
central', 'exterior', 35);