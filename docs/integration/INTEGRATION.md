# OTC Engine — Guía de integración

Este paquete contiene el **motor de mercado OTC**, el **panel de administración** y
el **Lab**, preparados para integrarse en un bróker. No lleva documentación de
proceso, gobernanza ni planificación: solo lo necesario para ejecutar, conectar y
operar.

Verificado antes de empaquetar, en este mismo árbol y sin nada más
(2026-09-05, construido desde el commit `4ee4986` del repositorio — el ciclo 9
completo con los arreglos del Cycle Audit 9):

```
npm install         → 364 paquetes
npm run build       → exit 0
npm run test:unit   → 142 ficheros, 2.651 pruebas, exit 0
node apps/api/dist/main.js  → 30 mercados, /health "ok", ticks en vivo
node examples/ticks-client.mjs eurusd-otc  → reanuda por secuencia y convierte precios
```

Este paquete es el árbol del repositorio sin su documentación de proceso. Tres
pruebas que solo vigilan esa documentación (`documentation`, `stateConsistency`,
`traceability`, bajo `packages/core/src/guardrails/`) no vienen; `ADR-0003`
sí viene, porque `mirror.test.ts` lo cita y es la razón de que el motor no sea
predecible.

Los ejemplos de respuesta de esta guía son respuestas reales de esa ejecución, no
inventadas.

---

> Este documento es la fuente de la guía: vive en `docs/integration/INTEGRATION.md`
> y se versiona con el código que describe (PH-29.5). El paquete de integración lo
> copia tal cual. El contrato de la API, ruta por ruta, está en
> [`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md); el motor
> lo sirve en `GET /contract`.

## 1. Qué es cada pieza

| Pieza               | Ruta                    | Qué hace                                                                                                                                                    |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Motor**           | `apps/api`              | Servicio HTTP (NestJS). Genera y publica los mercados, sirve el histórico y el stream de ticks. Es el único que crea precios.                               |
| **Panel**           | `apps/web`              | Aplicación Next.js: vista de mercados, alta y gestión de activos, y las pantallas del Lab. Habla con el motor a través de sus propios proxies.              |
| **Lab**             | `apps/api/src/lab`      | Composición alternativa del mismo motor, con controles de simulación (empujar el precio, fijar el cierre de una vela, escenarios). **Nunca en producción.** |
| **Núcleo**          | `packages/core`         | Tiempo, entropía determinista y primitivas de mercado. Sin dependencias.                                                                                    |
| **Modelo**          | `packages/engine`       | El modelo de generación de precios y el catálogo de activos.                                                                                                |
| **Runtime**         | `packages/runtime`      | Mercados hospedados, persistencia, reanudación tras reinicio.                                                                                               |
| **Distribución**    | `packages/distribution` | Publicación de ticks direccionada por secuencia y su contrato de consistencia.                                                                              |
| **Trading**         | `packages/trading`      | **Liquidación determinista** de opciones binarias contra el registro publicado. Es lo que integra tu bróker.                                                |
| **Chart**           | `packages/chart`        | Reducción de ticks a velas para dibujar, preservando extremos.                                                                                              |
| **Lab (analítica)** | `packages/lab`          | Batería adversarial y métricas de realismo que usan las rutas de calidad del Lab.                                                                           |
| **Fixtures**        | `packages/fixtures`     | Mercados con defectos plantados, para calibrar la batería. Solo pruebas.                                                                                    |
| **Sim**             | `tools/sim`             | Ejecutor de simulaciones fuera de línea y generación de evidencia estadística.                                                                              |

Los comentarios del código citan secciones (`§68`), decisiones (`ADR-0003`) y fases
(`PH-24.13`) del repositorio de desarrollo. Son referencias históricas: no hace
falta nada de eso para ejecutar el sistema.

---

## 2. Arrancar en cinco minutos

Requiere **Node 24** (ver `.nvmrc`).

```bash
npm install
npm run build

export OTC_MASTER_SECRET=$(openssl rand -hex 32)   # ← guárdalo, ver §4
export OTC_ADMIN_TOKEN=$(openssl rand -hex 24)
export OTC_STATE_DIR=/var/lib/otc

node apps/api/dist/main.js
```

Salida esperada:

```
[bootstrap] hosting 30 markets on 127.0.0.1:3000 (this machine only); writes need the bearer token
```

Comprobación:

```bash
curl -s localhost:3000/health
curl -s localhost:3000/catalogue | head
curl -N "localhost:3000/markets/eurusd-otc/stream"      # ticks en vivo (SSE)
```

El panel, en otro proceso:

```bash
npm run build:web
OTC_API_BASE=http://127.0.0.1:3000 \
OTC_ADMIN_TOKEN=$OTC_ADMIN_TOKEN \
npx next start apps/web -p 3001
```

---

## 3. La API del motor

Todo lo que sigue es lectura pública salvo lo marcado como **admin**.

Cuatro hechos generales antes de las rutas:

- **No hay prefijo global ni versionado.** Las rutas cuelgan de la raíz:
  `/health`, `/markets`, no `/api/v1/…`. Si quieres un prefijo, ponlo en tu proxy.
- **La autorización va por método, no por ruta**: un guardia global deja pasar
  `GET`, `HEAD` y `OPTIONS`, y exige el token para todo lo demás — hoy y para
  cualquier ruta que se añada mañana.
- **Los errores tienen una forma fija**:
  `{ "message": "…", "error": "Bad Request", "statusCode": 400 }`.
- **Un `POST` correcto devuelve 201**, incluido `POST /assets/:id/retire`.
- El literal `/markets/stream` se declara antes que `/markets/:id`, así que gana
  la ruta literal: no llames `stream` a un activo.

### 3.1 Estado

```
GET /health
→ { "status": "ok" | "degraded", "assets": 30, "stalled": [], "bootNonce": null }
```

`degraded` significa que algún mercado dejó de imprimir ticks; `stalled` los nombra.
Úsalo como _readiness probe_.

### 3.2 Catálogo

`GET /catalogue` devuelve las treinta entradas compiladas (y las que se hayan
dado de alta en caliente), cada una con el asiento del que se sorteó —
arquetipo, carácter y fuente del precio de referencia — y nada privado:

```json
{
  "seat": {
    "archetype": "major-fx",
    "character": "The deepest ladder and the longest excitation memory of the eight pairs: sixteen rungs at the tightest spacing the box allows, and a regime that holds.",
    "priceSource": "X-Rates monthly average table, August 2026, fetched 2026-09-04: 1.158853"
  },
  "id": "eurusd-otc",
  "displayName": "EUR/USD OTC",
  "family": "forex",
  "live": true,
  "retired": false,
  "referencePrice": 1.16,
  "displayPrecision": 7,
  "logQuantum": 3.131447750503912e-7,
  "meanIntervalMs": 348.0060488739902,
  "tieRate": 0.00949646086803194,
  "excessKurtosis": 47.668265194532125,
  "dispersion": { "quarterlyLogSigma": 0.038, "quarterlyPercent": 0.03804117794545922 }
}
```

`GET /markets` y `GET /markets/:id` describen los mercados hospedados ahora mismo:

```json
{
  "id": "eurusd-otc",
  "displayName": "EUR/USD OTC",
  "family": "forex",
  "price": -156,
  "displayPrice": "1.1599433",
  "sequence": 9,
  "instant": 1788609132652,
  "recovery": { "kind": "fresh" }
}
```

`price` es el entero canónico — lo que liquida — y `displayPrice` es su
representación, que nunca se compara.

`GET /archetypes` lista el vocabulario de alta de activos: ocho arquetipos, cada
uno una región del espacio de rasgos, con su banda de dispersión en unidades
logarítmicas y en porcentaje.

### 3.3 El precio, y cómo convertirlo

Un tick es:

```json
{ "instant": 1788535473042, "sequence": 14, "price": 106 }
```

`price` **no es un precio**: es un índice entero del retículo logarítmico del
activo. La conversión es:

```
precioMostrado = referencePrice * exp(logQuantum * price)
```

redondeado a `displayPrecision` decimales. En TypeScript:

```ts
import { displayPrice } from '@otc/chart';

const shown = displayPrice(tick.price, {
  logQuantum: asset.logQuantum,
  referencePrice: asset.referencePrice,
  displayPrecision: asset.displayPrecision,
}).toFixed(asset.displayPrecision);
```

Usa esa función y no `Math.exp` propio: el núcleo trae un `exp` portable porque
ECMAScript no especifica los últimos bits de `Math.exp`, y dos motores podrían
mostrar precios distintos para el mismo tick.

**Compara siempre en enteros.** La liquidación se decide sobre `price`, nunca sobre
el número mostrado.

### 3.4 Stream de ticks (SSE)

Un activo:

```
GET /markets/:id/stream?from=<sequence>&onGap=live
```

- Cada evento es `id: <sequence>` y `data: <Tick JSON>`.
- Sin `from`, empieza en el borde vivo.
- Con `from=N`, reproduce desde esa secuencia. Si ya fue desalojada → **400**, no
  un stream vacío: un cliente no puede detectar lo que nunca recibió.
- Se honra la cabecera `Last-Event-ID` de la reconexión automática del navegador
  con el mismo significado que `from`.
- `onGap=live` pide que, ante un hueco, el servidor emita **primero** un evento
  `gap` y a continuación **toda la ventana que aún retiene**, desde su secuencia
  más antigua — no el borde vivo:

  ```
  event: gap
  data: {"asset":"eurusd-otc","requested":481775,"reason":"...","resumesAt":483102}
  ```

  `requested` es lo que pediste; `resumesAt` es la primera secuencia que vas a
  recibir. El hueco es exactamente `[requested, resumesAt − 1]`: recarga ese
  tramo del histórico de velas, porque esos ticks ya no vas a ver. Solo cuando
  el rechazo se debe al presupuesto de reproducción del proceso (no a la
  ventana) el servidor te une al borde vivo, y entonces `resumesAt` es `null`.

- Una reproducción cortada por el tope de 1 MB por conexión se cierra **una
  sola vez** con `event: close` y un motivo que nombra el tope y la secuencia
  desde la que reanudar (`replay capped at 1000000 bytes after sequence N;
resume from N+1`): reconecta con `from=N+1`.

Varios activos por una sola conexión (un navegador solo permite seis por origen):

```
GET /markets/stream?assets=eurusd-otc,btcusdt-otc&from=eurusd-otc:481775,btcusdt-otc:9912&onGap=live
```

- Cada evento nombra su activo en el payload.
- Un activo ausente de `from` arranca en el borde vivo.
- El `id:` lleva la posición completa, `activo:secuencia` separadas por comas, así
  que la reconexión del navegador es tan informativa como un `from` explícito.
- Un hueco en un activo no derriba la conexión de los otros siete: el evento
  `gap` nombra el activo afectado.

**Tres límites que hay que respetar en el cliente.** La reproducción que se sirve
al conectar está acotada a 1 MB por conexión (unos trece mil ticks): pedir un
`from` muy antiguo no devuelve medio histórico sino ese tope, cerrado con el
motivo de arriba, y un cliente que no consume lo bastante rápido se desconecta
en vez de degradar su vista. Los ticks se retienen **50.000 por activo** — algo
más de una hora en el activo más rápido, varias horas en los lentos —
cómodamente por encima del contrato más largo (15 min): más atrás de eso se
recarga del histórico de velas, no del stream. Y **la ventana depende de cómo
fue el reinicio del motor**. Con registro durable (`OTC_RECORD_DB`, §3.7) un
reinicio **rápido** — el punto de control tiene menos de 15 s — continúa sin
salto: el stream se ceba con la cola del registro y un `from` anterior al
arranque se sirve como si el proceso no hubiera muerto. Un reinicio **más largo
que 15 s** — lo que es cualquier despliegue — produce una **costura**: el
mercado continúa desde el último precio publicado con las secuencias
adelantadas (saltan del orden de 100.000), el stream empieza en la costura, y un
`from` anterior recibe el 400 que nombra dónde empieza la ventana (o, con
`onGap=live`, el `gap` con su `resumesAt`). Lo publicado antes de la costura no
se pierde: sigue en el registro, por secuencia (`/ticks/:sequence`) y por
instante (`/price?at=`), y en el histórico de velas — pero el **hueco** no tiene
precio: un `at` dentro de la costura es `409`, y la costura misma se lee en
`GET /markets/:id/seams` (§3.7, §5). La cadena de compromisos
**se reinicia** en la costura en vez de puentearla: `verifyCommitmentsFile`
(de `@otc/distribution`) verifica las dos cadenas y nombra la ruptura en
`breaks`.

### 3.5 Histórico de velas

```
GET /markets/:id/history?timeframe=1m&from=<epoch ms>&to=<epoch ms>
```

- Solo lee lo grabado; nunca genera.
- Pedir un marco más fino que el almacenado es **400**, no una serie más gruesa
  bajo el nombre pedido.
- Hay un tope por número de velas (dos órdenes de magnitud por encima de
  cualquier petición legítima); por encima responde 400.

### 3.6 Escritura (admin)

Requieren `Authorization: Bearer $OTC_ADMIN_TOKEN` **y**
`Content-Type: application/json`. Las respuestas de rechazo son explícitas:

| Situación                   | Respuesta                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `OTC_ADMIN_TOKEN` sin poner | `403` — «Writes are refused on this engine…»                                                                                |
| Token ausente o incorrecto  | `403` — «This write needs "Authorization: Bearer …"»                                                                        |
| Otro `Content-Type`         | `415` — una escritura que un navegador pudiera enviar sin _preflight_ sería una escritura que cualquier página podría hacer |
| Id duplicado al crear       | `409`                                                                                                                       |
| Brief mal formado           | `400`                                                                                                                       |

```
POST  /assets            crea un activo
PATCH /assets/:id        renombra / superpone campos mutables
POST  /assets/:id/retire retira un activo
GET   /registrations     estado de los trabajos de registro (lectura)
```

El alta de un activo es un trabajo por etapas — identidad, seguridad, autoría,
dispersión, calibración y diferenciación — porque cuatro de ellas son simulación
y cuestan entre medio segundo y veinte según la familia. `POST /assets` devuelve
un **trabajo**, no un activo, y `GET /registrations/:id` cuenta en qué etapa va.

---

### 3.7 Consulta de liquidación (PH-29.1)

Las dos cifras que tu liquidación necesita, y su prueba, las responde el motor
desde su propio registro persistente. No hace falta guardar una copia del stream
para liquidar.

- **`GET /markets/:id/ticks/:sequence`** — el tick publicado con esa secuencia
  (`sequence`, `instant`, `price`, `displayPrice`). `404` con los límites del
  registro (`holds 1–N`) si la secuencia no está.
- **`GET /markets/:id/price?at=<instante>`** — el precio en vigor en ese
  instante: **el último tick con instante menor o igual**, la misma regla que usa
  `settle()` y que dibujan las velas. La respuesta la nombra
  (`"rule": "last-tick-at-or-before"`). `404` si el registro empieza después del
  instante; `400` si el instante es posterior al último publicado — un precio
  para un instante sin publicar es una predicción, no un registro; **`409` si el
  instante cae dentro de una costura** (§5): ahí no se publicó nada y nunca se
  publicará, y la respuesta nombra los dos lados del hueco.
- **`GET /markets/:id/seams`** — las costuras que el registro guarda para ese
  mercado, de la más antigua a la más reciente: `assetId`, `lastSequence`,
  `lastInstant`, `resumesAtSequence`, `resumesAtInstant`. Es lo que `settle()`
  espera en `seams` (§5). Array vacío en un motor que nunca ha costurado.
- **`GET /markets/:id/proof/:sequence`** — la prueba de inclusión: el
  compromiso firmado de la ventana que contiene la secuencia, la ruta Merkle y
  la clave pública del publicador. Con eso, `verifyInclusion` y
  `verifyCommitment` de `@otc/distribution` (o `VenueClient.proof`) verifican
  el tick sin confiar en nadie. `409` mientras la ventana está abierta
  (publicado, aún no archivado; la respuesta dice hasta dónde llega la cadena);
  `404` si el despliegue no publica (`OTC_PUBLICATION_DIR` sin definir).

```
GET /markets/eurusd-otc/price?at=1788492000000
{ "assetId": "eurusd-otc", "at": 1788492000000, "rule": "last-tick-at-or-before",
  "sequence": 41209, "instant": 1788491999412, "price": -3118, "displayPrice": "1.09657" }
```

### 3.8 El contrato y el cliente de referencia

- **`GET /contract`** sirve el contrato de la API como datos (rutas, parámetros,
  claves y tipos de cada respuesta, negativas), con `version` y `digest`;
  `/health` lleva `apiVersion`. Un cambio que rompa el contrato es una versión
  nueva o una compilación en rojo, nunca una sorpresa.
- **`@otc/client`** (`packages/client`) es lo que tu bróker embebe: `VenueClient`
  — cada lectura comprobada contra el contrato (una desviación lanza
  `ContractViolation` con la ruta y la clave), las negativas listadas devueltas
  como valor, `proof()` verificada antes de devolverla, y `subscribe()`, un
  iterador asíncrono que reanuda desde la última secuencia entregada más uno si
  se cae la conexión, entrega un hueco anunciado como evento, nunca repite un
  tick y rechaza un salto que el motor no anunció.
- **`npm run conformance -- --base http://host:puerto [--out informe.md]`** es la
  lista de verificación ejecutable: versión y digest del contrato, cada ruta
  contratada por claves y tipos, orden y reanudación exacta del stream y su hueco
  anunciado, la regla del precio sobre los ticks entregados, y una prueba
  verificada contra la clave del publicador. Sale con 0 si todo pasa y 1 si no.

```ts
import { VenueClient, isRefusal } from '@otc/client';

const venue = new VenueClient({ baseUrl: 'http://127.0.0.1:3000' });
const entry = await venue.priceAt('eurusd-otc', contract.entryInstant);
const expiry = await venue.priceAt('eurusd-otc', contract.entryInstant + contract.horizonMs);
if (isRefusal(expiry)) {
  // 400: aún no hay precio publicado para ese instante — reintenta más tarde.
}
for await (const event of venue.subscribe('eurusd-otc', { from: lastSequence + 1 })) {
  if (event.kind === 'tick') store(event.tick);
  if (event.kind === 'gap') reloadHistory(event.gap.resumesAt);
}
```

## 3.1 La biblioteca de activos

El motor trae **treinta activos predefinidos**, compilados en
`packages/engine/src/catalogue.ts` y servidos por `GET /catalogue`. La tabla
completa, generada desde el catálogo y verificada por un test que la rehace,
está en `docs/integration/CATALOGUE.md` de este paquete.

| Grupo                 | Activos                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| Divisas (8)           | EUR/USD, GBP/USD, USD/JPY, GBP/JPY, EUR/JPY, AUD/USD, USD/CHF, EUR/GBP |
| Acciones (8)          | Apple, Tesla, NVIDIA, Amazon, Microsoft, Meta, Petrobras, Nubank       |
| Cripto (6)            | BTC, ETH, SOL, XRP, DOGE, BNB — todos contra USDT                      |
| Índices temáticos (8) | MMX, AIX, CGX, TCX, GMX, SCX, EVX, BRX — todos en USDT, abren en 1 000 |

Cada entrada de `GET /catalogue` lleva:

```json
{
  "id": "eurusd-otc",
  "displayName": "EUR/USD OTC",
  "family": "forex",
  "live": true,
  "retired": false,
  "referencePrice": 1.16,
  "displayPrecision": 7,
  "logQuantum": 3.13e-7,
  "meanIntervalMs": 348,
  "tieRate": 0.0095,
  "excessKurtosis": 51.7,
  "dispersion": { "quarterlyLogSigma": 0.038, "quarterlyPercent": 3.8 },
  "seat": {
    "archetype": "major-fx",
    "character": "The deepest ladder and the longest excitation memory of the eight pairs…",
    "priceSource": "X-Rates monthly average table, August 2026, fetched 2026-09-04: 1.158853"
  }
}
```

**Lo que es estable y lo que no.**

- `id`, `displayPrecision`, `logQuantum` y `referencePrice` **no cambian nunca**
  para un activo. El `id` es la etiqueta de derivación de claves y el nombre del
  fichero de estado: el motor se niega a reanudar un checkpoint que otra
  personalidad escribió bajo el mismo id, y los ids de los cinco activos
  anteriores (`eurusd`, `gbpjpy`, `btcusd`, `spx`, `xauusd`) están retirados y
  no se reutilizan.
- `displayName` puede renombrarse desde el panel (`PATCH /assets/:id`);
  `live`/`retired` cambian con `POST /assets/:id/retire`. Nada más es editable.
- `seat` es `null` para un activo registrado en caliente por un operador: sólo
  los treinta compilados tienen asiento.

**Precios de referencia.** Son el origen de la retícula logarítmica, no una
cotización: el mercado no sigue a nada. Para los 22 instrumentos reales es la
**media de agosto de 2026** medida contra la fuente fechada que aparece en
`priceSource`; los ocho índices inventados abren en 1 000 USDT. Cámbialos en tu
copia si quieres otro origen — antes del primer arranque, porque después forman
parte del registro publicado.

**Precisión.** `displayPrecision` la deriva la calibración, no un operador: es
el mínimo de decimales con el que un paso de la retícula sigue siendo visible al
precio de referencia. En un activo que cae mucho (DOGE, XRP) un paso puede dejar
de verse con esos decimales; muestra siempre el precio con `displayPrecision`
decimales y nunca menos.

## 4. Configuración

| Variable                 | Por defecto                 | Qué hace                                                                                                                                                                                          |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTC_MASTER_SECRET`      | — **obligatoria**           | 64 caracteres hex (32 bytes). De aquí se deriva todo el mercado.                                                                                                                                  |
| `OTC_KEY_ID`             | `primary`                   | **Solo una etiqueta**, anotada en los puntos de control para saber qué secreto los generó. **No entra en la derivación**: cambiarla no cambia el mercado.                                         |
| `PORT`                   | `3000`                      | Puerto del motor.                                                                                                                                                                                 |
| `OTC_BIND`               | `127.0.0.1`                 | Interfaz. Rechaza `0`, `*`, `any`, `all`: si quieres exponerlo, escribe `0.0.0.0` — y pon el token antes.                                                                                         |
| `OTC_TRUSTED_PROXIES`    | `0`                         | Saltos de proxy en los que confiar para leer la dirección del cliente (`X-Forwarded-For`). `1` detrás del nginx incluido; `0` si el motor se expone directamente. Lo lee el límite de peticiones. |
| `OTC_ADMIN_TOKEN`        | —                           | Sin él, toda escritura se rechaza (403). **Mínimo 16 caracteres**: uno más corto impide arrancar.                                                                                                 |
| `OTC_CORS_ORIGIN`        | `*` (solo `GET, HEAD`)      | Orígenes permitidos, separados por comas. CORS no es autorización.                                                                                                                                |
| `OTC_STATE_DIR`          | `./.otc-state`              | Directorio de estado durable.                                                                                                                                                                     |
| `OTC_HISTORY_DB`         | `$OTC_STATE_DIR/history.db` | Base SQLite del histórico.                                                                                                                                                                        |
| `OTC_ASSET_REGISTRY_DIR` | `$OTC_STATE_DIR/assets`     | Activos creados y sus superposiciones.                                                                                                                                                            |
| `OTC_BOOT_NONCE`         | —                           | Se devuelve en `/health` como `bootNonce`; sirve para saber **qué** proceso contestó en un puerto.                                                                                                |
| `OTC_BACKFILL_DAYS`      | `0`                         | Días de pasado sintético que se dan a un activo **sin registro previo**. Solo dígitos, tope 365. **Irreversible**: una vez generado, ese pasado es el pasado de ese mercado.                      |
| `OTC_PUBLICATION_DIR`    | —                           | Activa la publicación firmada del registro. Si la pones, `OTC_PUBLISHING_KEY` pasa a ser obligatoria.                                                                                             |
| `OTC_PUBLISHING_KEY`     | —                           | Semilla Ed25519, 64 hex. **Se rechaza si es igual a `OTC_MASTER_SECRET`**: firmar con el secreto del que se deriva el mercado lo filtraría.                                                       |
| `OTC_LAB_PORT`           | `PORT` o `3100`             | Puerto del proceso Lab.                                                                                                                                                                           |

Toda la configuración se lee **una vez, al componer el proceso**. No hay recarga
en caliente: un cambio de variable es un reinicio. Dos cosas que **no** son
configurables y conviene conocer: el punto de control se escribe cada 5 segundos
y el motor se pone al día en pasos de 15 segundos como máximo.

### `OTC_MASTER_SECRET` es la identidad del mercado

De ese secreto se derivan todos los flujos de aleatoriedad. Consecuencias directas:

- **Si lo cambias, es otro mercado.** Los precios ya publicados dejan de ser
  reproducibles y las liquidaciones históricas dejan de poder re-derivarse.
- **Si lo pierdes, no puedes reconstruir el pasado** aunque conserves el estado.
- El proceso **se niega a arrancar** sin él en vez de inventarse uno.

Trátalo como una clave de producción: gestor de secretos, copia de seguridad
separada del estado, y rotación solo con un plan de migración explícito.

### Estado durable

Todo bajo `OTC_STATE_DIR`:

- puntos de control por mercado, para que un reinicio rápido continúe **sin
  salto** y uno largo cosa desde el último precio publicado (§3.4);
- `history.db`, el histórico de velas;
- `assets/`, los activos creados y sus superposiciones;
- con el Lab, además el fichero de sesión del Lab.

Arranque en frío sin estado: el motor crea los mercados del catálogo desde el
secreto. Arranque con estado: reanuda desde el último punto de control. La copia de
seguridad es copiar el directorio con el proceso parado; moverlo a otra máquina
funciona si va acompañado del mismo `OTC_MASTER_SECRET`.

Orden de arranque: los mercados se levantan **antes** de que escuche el puerto, así
que nadie observa un motor a medio recuperar. El apagado es el espejo: deja de
publicar, escribe un último punto de control, cierra el histórico y sale.

---

## 5. Liquidación — lo que el motor responde y lo que tu bróker guarda

El motor **no sabe nada de dinero**: no hay posiciones, ni contratos, ni
liquidación en `apps/api`. Esa frontera es deliberada: el precio no puede
depender de si tú ganas (INV-001). Lo que el motor sí hace, desde PH-29, es
responder las dos cifras que una liquidación necesita y demostrarlas:

1. **El precio de entrada**: `GET /markets/:id/price?at=<entryInstant>`.
2. **El precio de expiración**: `GET /markets/:id/price?at=<entryInstant + horizonMs>`.
   Si aún no hay precio publicado para ese instante, la respuesta es `400`:
   el contrato no ha vencido; reintenta después.
3. **La prueba**: `GET /markets/:id/proof/:sequence` para la secuencia que cada
   precio nombra, verificable con la clave pública del publicador.

Con eso, tu bróker liquida con la librería de referencia o con la suya; en ambos
casos la regla es la misma y el motor la nombra en cada respuesta.

```ts
import { settle, type Contract, type TickRecord } from '@otc/trading';

const contract: Contract = {
  id: 'ticket-1001',
  assetId: 'eurusd-otc',
  direction: 'up', // 'up' | 'down'
  stake: 10_000, // ENTERO en tu unidad menor (céntimos, satoshis…)
  entryInstant: 1788492000000,
  horizonMs: 60_000, // expiración fija: 30 s … 15 min
  payoutRatio: 0.85, // decimal de hasta cuatro cifras
};

// El registro: los ticks publicados, en arrays paralelos y en orden de secuencia
// (los que entregó `VenueClient.subscribe`, o los que devuelve el stream).
const record: TickRecord = {
  instants: new Float64Array(ticks.map((t) => t.instant)),
  prices: new Int32Array(ticks.map((t) => t.price)),
};

const settlement = settle(contract, record);
// → { contractId, outcome: 'win' | 'loss' | 'refund', entryPrice, expiryPrice,
//     returned, net, ... }  — returned y net son ENTEROS
```

Reglas que importan:

- **El dinero es un entero en tu unidad menor** (Issue #11). `stake` debe ser
  un entero positivo; `payoutRatio` un decimal con como mucho cuatro cifras. Un
  contrato ganado devuelve `stake + floor(stake × payoutRatio)`, calculado con
  enteros exactos: la fracción de unidad menor que un pago no puede llevar se
  queda con el operador, siempre menos de una unidad. `tally` suma enteros.
- **Inclusivo en los dos extremos.** El precio de entrada es el vigente en
  `entryInstant` — el último tick con instante **menor o igual** — y el de
  expiración, el vigente en `entryInstant + horizonMs`. Un tick que imprime
  exactamente en el instante de expiración **es** el precio de expiración.
  `GET /markets/:id/price` aplica exactamente esta regla.
- **No hay interpolación.** Entre dos ticks, el precio en vigor es el del tick
  anterior. Interpolar inventaría precios que el mercado nunca visitó.
- **Entre ticks del mismo milisegundo gana el último** en orden de secuencia.
  Por eso el registro debe construirse **en orden de secuencia**: la búsqueda es
  binaria y sobre un array desordenado devuelve cualquier cosa, sin avisar.
- **Empate** (`expiryPrice === entryPrice`): lo decide `AtMoneyPolicy`, por
  defecto `'refund'`. Puedes pasar `'loss'` o `'win'`.
- **Se niega antes que inventar.** Si el registro empieza después de la entrada, o
  termina antes de la expiración, lanza `NotSettleableError`. Un contrato cuya
  expiración aún no ha ocurrido no se liquida: se reintenta más tarde.

### El borde de la vela

El gráfico agrupa en `[inicio, fin)` — un tick a las `14:33:00.000` **abre** la
vela de las 14:33 — mientras que la liquidación es inclusiva: ese mismo tick es
el precio de expiración de un contrato que vence a las 14:33:00.000. Son dos
reglas correctas que discrepan en un punto. No las mezcles en la interfaz del
cliente: el precio que decide el contrato es el de la liquidación.

### Qué guardar para poder re-derivar

«Perdiste» no es una explicación; «entraste en el tick 41.209 a −3.118 y expiró
en el 41.238 a −3.140, y aquí está la prueba firmada de los dos» sí. Guarda, por
contrato:

1. **El contrato completo**, con `horizonMs` — no una expiración ya calculada:
   `expiryOf` la recalcula y cualquier desvío cambia la comparación.
2. **La política de empate**, si no es `'refund'`.
3. **Las dos respuestas de `/price`** (entrada y expiración) tal cual llegaron:
   nombran la secuencia, el instante, el precio y la regla.
4. **Las dos pruebas de `/proof`**, una vez cerradas sus ventanas, con la clave
   pública del publicador que verificaste: eso convierte una disputa en una
   verificación que cualquiera puede repetir (INV-009).
5. **La especificación del instrumento** (`logQuantum`, `referencePrice`,
   `displayPrecision`) para poder mostrar los enteros en un extracto.
6. **El `Settlement` devuelto**, para que re-derivar sea comparar y no recalcular.

**No guardes `entryIndex` / `expiryIndex` como identificadores**: son posiciones
dentro del array exacto que pasaste. La identidad estable de un tick es su
`sequence`.

### Las discontinuidades: de dónde salen las costuras

`TickRecord` acepta un campo `seams` — discontinuidades del registro — y `settle`
se niega a liquidar un contrato cuya ventana toque una. **Rellénalo desde
`GET /markets/:id/seams`**, no desde el stream:

```ts
const seams = await client.seams('eurusd-otc'); // RecordedSeam[]
const record = {
  instants,
  prices,
  seams: seams.map((s) => ({
    lastInstant: s.lastInstant,
    resumesAtInstant: s.resumesAtInstant,
  })),
};
settle(contract, record); // NotSettleableError si la ventana toca una costura
```

Léelo una vez por pasada de liquidación, no por contrato: una costura cuesta un
reinicio más largo que el límite de 15 s, así que la lista es corta y cambia poco.

**Por qué no desde el evento `gap`.** Hasta la versión 2.0.0 del contrato esta
sección decía «rellena `seams` con el evento `gap`», y no se puede hacer: el
`gap` lleva **secuencias** (`requested`, `resumesAt`) donde `seams` necesita
**instantes**, sólo lo ve un cliente que estuviera conectado en ese momento, y no
dice nada de las costuras de arranques anteriores — que son las que importan al
liquidar un contrato de la semana pasada. `recovery` en `GET /markets/:id`
tampoco sirve: nombra el arranque **actual**. El registro es lo único que las
recuerda todas, y `/seams` es cómo se leen (Auditoría de Ciclo 10).

**Si liquidas sin las costuras** el resultado no es un error: es un precio. El
motor devolvía —y `settle()` sin `seams` sigue devolviendo— el último tick
_anterior_ al hueco como precio de expiración, y con la entrada antes de la
costura eso es una pérdida liquidada contra un precio de un intervalo que nadie
generó. Por eso `/price?at=` dentro de una costura ahora responde `409` en vez de
un precio: la API y `settle()` se niegan en el mismo sitio.

`packages/trading` trae además `tally` (ledger), `assessBookRisk` /
`exposureByEvent` (exposición por evento) y `ExposureBook` / `admit` (límites),
todos con la misma aritmética entera. Nada de eso toca el motor.

---

## 6. El panel

Next.js. Pantallas:

| Ruta                       | Para qué                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/`                        | Redirige a `/preview`.                                                                                                  |
| `/preview`                 | Vista principal: catálogo a la izquierda, gráfico de velas a la derecha, marcos de 1m a 1d.                             |
| `/preview/ticks/[assetId]` | Microestructura: los ticks crudos, dibujados en SVG propio. Existe porque el histórico no sirve nada más fino que `1m`. |
| `/assets/new`              | Alta de activo.                                                                                                         |
| `/assets/manage`           | Renombrar y retirar.                                                                                                    |
| `/lab`                     | Panel de control del Lab (solo en un despliegue Lab).                                                                   |
| `/lab/avanzado`            | El instrumento completo del Lab.                                                                                        |

Proxies propios (el navegador nunca ve el token):

| Ruta           | Destino        | Notas                                   |
| -------------- | -------------- | --------------------------------------- |
| `/engine/*`    | `OTC_API_BASE` | Añade el token de admin en el servidor. |
| `/lab/*`       | `OTC_LAB_BASE` | Escrituras firmadas en el servidor.     |
| `/labengine/*` | `OTC_LAB_BASE` | Solo lectura: el gráfico del Lab.       |
| `/labmode`     | —              | Dice si este despliegue es un Lab.      |

Variables:

| Variable                   | Por defecto             | Qué hace                                                     |
| -------------------------- | ----------------------- | ------------------------------------------------------------ |
| `OTC_API_BASE`             | `http://127.0.0.1:3000` | Motor al que apunta el proxy.                                |
| `OTC_ADMIN_TOKEN`          | —                       | El panel lo añade a las escrituras.                          |
| `OTC_LAB_BASE`             | —                       | Si está, el panel es un panel de Lab.                        |
| `NEXT_PUBLIC_OTC_API_BASE` | `/engine`               | Base que usa el navegador. Se fija **en el build**.          |
| `OTC_NEXT_DIST_DIR`        | `.next`                 | Directorio de build.                                         |
| `OTC_PANEL_BIND`           | `127.0.0.1`             | Interfaz en la que escucha `npm start` dentro de `apps/web`. |

**El panel no trae autenticación.** Ponlo detrás de la tuya (SSO, VPN, proxy con
auth). Quien alcance el panel alcanza las escrituras de administración, porque el
token lo pone el servidor del panel.

Otras cosas que conviene saber antes de integrarlo:

- **Next.js 15 (App Router) y React 19**, sin framework de CSS ni librería de
  componentes. El gráfico usa `lightweight-charts`.
- **Todo el texto está en español**, en un único fichero: `apps/web/src/lib/es.ts`.
  El `layout.tsx` fija `<html lang="es">`. No hay i18n: para otro idioma se
  sustituye ese fichero. Los identificadores, los `data-testid` y los nombres de
  campo de la API están deliberadamente sin traducir.
- **No hay `basePath` ni `assetPrefix`.** Servirlo bajo un subcamino
  (`/admin/…`) requiere configurarlos en `next.config.mjs` y reconstruir.
- La barra lateral consulta `/health` cada 5 segundos y muestra el estado del
  motor.

### Dibujar las velas en tu propio frontend

`packages/chart` exporta la reducción a columnas que preserva extremos y
`displayPrice`. Dos avisos si lo consumes **desde el código fuente** en vez de
desde `dist/`:

- El panel declara `transpilePackages: ['@otc/chart', '@otc/core']`.
- Esos paquetes están escritos para NodeNext, así que sus imports internos llevan
  sufijo `.js` apuntando a ficheros `.ts`. El panel lo resuelve con
  `resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }` en webpack. Con
  Vite o esbuild necesitas el equivalente — o, más simple, consume el `dist/`
  compilado.

---

## 7. El Lab

Un proceso Lab es **el mismo motor en modo simulación**: una composición distinta
del mismo servicio, con rutas que permiten empujar el precio, mantener una
dirección, fijar el cierre exacto de una vela y jugar escenarios — todo eligiendo
entre los futuros que el propio motor podía producir, nunca sumando al precio.

```bash
OTC_LAB_PORT=3100 OTC_STATE_DIR=/var/lib/otc-lab node apps/api/dist/lab/lab.main.js
```

Rutas principales (todas bajo el proceso Lab):

| Ruta                                                           | Qué hace                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /markets/:id/state`                                       | Estado interno: precio, nivel del retículo, régimen, unidad de distancia.  |
| `POST /markets/:id/push?distance=±N&pace=`                     | Empuja N unidades (¼ de vela de 1m) al ritmo elegido.                      |
| `POST /markets/:id/bias?direction=up\|down\|off`               | Dirección sostenida. **Se apaga sola a los dos minutos.**                  |
| `POST /markets/:id/close?price=&bucket=&timeframe=&condition=` | Fija el cierre de la vela: exacto, o por encima / por debajo de una marca. |
| `POST /markets/:id/release`, `POST /release-all`               | Devuelve el mercado (o todos) a su keystream.                              |
| `GET /markets/:id/control`, `GET /control`                     | Qué hay activo, por mercado y en conjunto.                                 |
| `GET /session`, `GET /session/export`                          | El registro de la sesión: cada acto, con su estado antes y después.        |
| `GET /markets/:id/quality`                                     | Batería adversarial y métricas de realismo sobre este mercado.             |
| `POST /markets/:id/positions`, `.../preset`                    | Posiciones simuladas y presets, liquidadas contra el registro del Lab.     |

**Las escrituras del Lab llevan el mismo token que las del motor.** El guardia es
global y va por método: todo lo que no sea `GET`, `HEAD` u `OPTIONS` necesita
`Authorization: Bearer $OTC_ADMIN_TOKEN` y `Content-Type: application/json`, con
cuerpo `{}` si el acto solo lleva parámetros de consulta. **Las lecturas del Lab
no llevan autenticación ninguna**, y ahí está el peligro: `GET
/markets/:id/state` devuelve los cursores del keystream — con la clave, un cursor
reconstruye todos los precios futuros — y `GET /session` devuelve el registro
completo de actos del operador. Lo único que separa eso de un desconocido es la
dirección de escucha.

Tres reglas de seguridad, no negociables:

1. **Producción nunca se compone como Lab.** El proceso de producción
   (`apps/api/dist/main.js`) no registra ninguna fuente de signos; las rutas del
   Lab no existen en él.
2. **Un despliegue, un motor.** El proceso Lab _es_ el motor de ese despliegue; no
   pongas un Lab al lado de un motor de producción esperando que compartan
   mercado: son mercados distintos.
3. **El Lab no se expone.** Quien alcance sus rutas lee el estado interno del
   motor, y con el token puede decidir el precio de liquidación de cualquier
   posición que venza en un instante dado. Déjalo en `127.0.0.1`, con su propio
   `OTC_STATE_DIR`, alcanzable solo a través de un panel interno autenticado que
   ponga el token en su servidor. El proceso Lab no configura CORS precisamente
   porque no está pensado para que lo alcance un navegador directamente.

**Y una advertencia de composición**: el proceso Lab sirve _además_ todas las
rutas públicas del motor, porque su módulo importa el del motor. Es un
superconjunto, no un servicio aparte.

---

## 8. Despliegue

### Procesos

| Proceso                  | Comando                              | Puerto                |
| ------------------------ | ------------------------------------ | --------------------- |
| Motor                    | `node apps/api/dist/main.js`         | `PORT` (3000)         |
| Panel                    | `npx next start apps/web -p 3001`    | 3001                  |
| Lab (opcional, separado) | `node apps/api/dist/lab/lab.main.js` | `OTC_LAB_PORT` (3100) |

### Proxy inverso

El motor debe quedar accesible para tus clientes solo en lectura. Un esquema que
funciona:

```nginx
location /otc/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Connection '';   # SSE
    proxy_buffering off;              # SSE: sin esto los ticks llegan a ráfagas
    proxy_read_timeout 1h;
}
```

`proxy_buffering off` no es opcional para el stream.

### Bloquear la administración

`POST /assets`, `PATCH /assets/:id` y `POST /assets/:id/retire` no deberían salir
a Internet. O los cortas en el proxy, o dejas el motor en loopback y expones solo
el panel detrás de tu autenticación.

### Los ficheros de despliegue (`deploy/`)

Desde PH-30.1 el repositorio trae lo que un despliegue arranca:

- `deploy/otc-engine.service` — la unidad de systemd (SIGTERM, `Restart=always`,
  el directorio de estado, el fichero de secretos).
- `deploy/Dockerfile` y `deploy/docker-compose.yml` — la imagen y el compose
  del motor con un volumen para el estado, `healthcheck` sobre `/health/ready`,
  y un servicio `backup` que ejecuta `deploy/backup.sh` cada seis horas.
- `deploy/nginx.conf` — el proxy con el stream sin búfer, las rutas de escritura
  cortadas, `/metrics` y `/health/ready` solo para tu red, y la dirección del
  cliente reenviada (el límite de peticiones la usa).
- `deploy/backup.sh` — `npm run state:backup` en bucle, conservando las últimas N.

### Operación: vivo, listo, métricas, límite

- `GET /health/live` responde en cuanto el proceso sirve HTTP; `GET /health/ready`
  responde `200` cuando todos los mercados han reanudado y ninguno está parado, y
  `503` con el motivo si no. Apunta tu orquestador a `ready` y tu reinicio a `live`.
- `GET /metrics` sirve los contadores en formato Prometheus: mercados, parados,
  `otc_ready`, ticks publicados, suscriptores del stream, presupuesto de replay,
  uptime, memoria residente y la cabeza del registro por activo.
- **Límite de peticiones**: `OTC_RATE_LIMIT_PER_MINUTE` (600 por defecto, `0` lo
  desactiva) por dirección de cliente; el exceso recibe `429` con `Retry-After`.
  Una conexión de stream cuenta una vez; sus tramas no. **Las tres sondas de
  operación — `/health/live`, `/health/ready` y `/metrics` — nunca se
  rechazan**: una avalancha que dejara al motor respondiendo `429` a su propio
  orquestador lo sacaría de rotación estando sano.
- **Si pones un proxy delante, dile al motor cuántos saltos confiar**:
  `OTC_TRUSTED_PROXIES` (0 por defecto, es decir no confiar en ninguna
  cabecera; `1` detrás del `nginx.conf` que se incluye). Sin esto el motor solo
  ve la dirección del proxy y **todos tus clientes comparten un único cubo** de
  600 peticiones por minuto. El `docker-compose.yml` y la unidad de systemd que
  se incluyen ya lo ponen a 1. Déjalo en 0 si el motor se expone directamente:
  confiar en `X-Forwarded-For` sin proxy delante deja que el cliente elija su
  propio cubo.
- La credencial de administración es `OTC_ADMIN_TOKEN` (a6-01): sin ella toda
  escritura se rechaza; el proxy corta las rutas además, no en su lugar.

### systemd

```ini
[Unit]
Description=OTC market engine
After=network.target

[Service]
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=OTC_STATE_DIR=/var/lib/otc
EnvironmentFile=/etc/otc/secrets.env    # OTC_MASTER_SECRET, OTC_ADMIN_TOKEN
ExecStart=/usr/bin/node /opt/otc/apps/api/dist/main.js
Restart=always
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

`SIGTERM` es la señal correcta: el proceso escribe un último punto de control antes
de salir. Un `SIGKILL` no rompe nada — el siguiente arranque reanuda desde el punto
anterior — pero alarga la reproducción.

---

## 9. Comandos

```bash
npm run build        # compila todo (tsc -b)
npm run build:web    # compila el panel
npm run test:unit    # suite rápida (142 ficheros, ~2 min)
npm run test:stat    # suite estadística, en serie (~75 min)
npm run lint         # ESLint con tipos — requiere build previo
npm run format:check # Prettier
npm run assurance:served -- --base http://127.0.0.1:3000 --out verdict.md
                     # el trabajo permanente: lee la ventana retenida de cada activo
                     # por el stream, corre la batería anti-predicción sobre lo servido
                     # y escribe un informe; sale con 2 si algo es explotable
npm run conformance -- --base http://127.0.0.1:3000 --out conformance.md
                     # la lista de verificación ejecutable contra tu despliegue (0/1)
npm run state:verify -- --dir ./.otc-state          # el directorio de estado es coherente
npm run state:backup -- --dir ./.otc-state --out DIR # copia coherente y verificada
npm run contract:render                              # regenera docs/architecture/API_CONTRACT.md
```

Dos avisos que ahorran tiempo:

- **`build` antes de `lint`.** Las reglas con tipos resuelven los tipos entre
  paquetes a través de las declaraciones emitidas; sobre un árbol limpio, lintar
  antes de compilar da decenas de errores falsos.
- **`npm run test:stat`, nunca `npx vitest run --project statistical` a pelo.** El
  script lleva `--no-file-parallelism`, y ese flag no puede vivir en la
  configuración: Vitest 3 lo descarta dentro de un bloque de proyecto. Sin él, los
  ficheros compiten entre sí y las medidas de tiempo miden la contención.
- Si copias este árbol a otra máquina, borra los `*.tsbuildinfo` antes de compilar
  o `tsc -b` creerá que ya está construido y no emitirá las declaraciones.

---

## 10. Lista de verificación de la integración

- [ ] `OTC_MASTER_SECRET` generado, guardado en el gestor de secretos y respaldado
      aparte del estado.
- [ ] `OTC_ADMIN_TOKEN` puesto; comprobado que sin él una escritura devuelve 401/403.
- [ ] `OTC_STATE_DIR` en disco persistente, con copia de seguridad.
- [ ] Motor en loopback o detrás de proxy; administración inaccesible desde Internet.
- [ ] `proxy_buffering off` verificado: los ticks llegan uno a uno.
- [ ] Cliente consumiendo el stream con `from=<sequence>` y reintentos; un 400 por
      secuencia desalojada se maneja recargando el histórico.
- [ ] Precios convertidos con `displayPrice`, comparaciones sobre `price` entero.
- [ ] `npm run conformance -- --base <tu motor>` en verde antes de salir a producción,
      y en cada actualización del motor (el contrato tiene versión: `/health.apiVersion`).
- [ ] Liquidación sobre `GET /markets/:id/price` (entrada y expiración) y, si
      liquidas tú, con `settle()` y `NotSettleableError` manejado.
- [ ] `stake` entero en tu unidad menor; `payoutRatio` con cuatro decimales como máximo.
- [ ] Guardado, por contrato: el propio contrato, las dos respuestas de `/price` y
      las dos pruebas de `/proof` con la clave del publicador.
- [ ] `OTC_PUBLICATION_DIR` y `OTC_PUBLISHING_KEY` definidos si quieres pruebas
      (`/proof`); la clave pública del publicador guardada aparte para verificar.
- [ ] Panel detrás de tu autenticación.
- [ ] Lab, si lo despliegas, en una red privada y con su propio `OTC_STATE_DIR`.
- [ ] `/health` en el monitor; alerta si `status` pasa a `degraded`.
- [ ] Registro construido en orden de secuencia antes de liquidar.
- [ ] Decidido qué hacer con `OTC_BACKFILL_DAYS` **antes** del primer arranque:
      el pasado sintético no se deshace.
