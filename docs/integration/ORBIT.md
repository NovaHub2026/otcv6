# Integrar el motor en Orbit

Type: SUPPORTING DOCUMENTATION (guía de integración para un bróker concreto)
Canonical for: cómo Orbit-Backend y optaqode-frontend2.0 sustituyen su simulador por este motor
Not canonical for: la API (eso es [`API_CONTRACT.md`](../architecture/API_CONTRACT.md)) ni la integración genérica ([`INTEGRATION.md`](INTEGRATION.md))
Contrato del motor: **3.3.0**

---

Esta guía está escrita leyendo el código de Orbit tal como está hoy
(`Orbit-Backend` en `661fc619`, `optaqode-frontend2.0`), **sin modificarlo**: la
integración la hace vuestro equipo. Cada sección dice qué hace vuestro código
ahora, qué responde el motor y qué hay que cambiar. Tres cosas son **riesgo de
dinero** y van primero (§1–§3); el resto es mapeo.

## 0. Qué sustituye el motor, y qué no existe en él

El motor sustituye a `src/simulators/market/engine.ts` (`MarketEngine`). Todo
lo que ese simulador hace para _generar_ precio lo hace el motor, en su propio
proceso, continuamente; vuestro backend deja de llamar a `start`, `stop`,
`tick` y `tickAll`.

**El «radar OTC» no existe en el motor y no puede existir** (`setControl`,
`control`, los empujes, pulsos, tendencias y objetivos del panel de admin). Un
precio que el operador puede dirigir es exactamente lo que el motor garantiza
que no ocurre: la generación no sabe nada de posiciones, exposición ni de quién
gana (INV-001). Ese panel debe desaparecer para los símbolos del motor.

## 1. Abrir: el precio de entrada es el que rige cuando el servidor acepta

**Qué hace Orbit hoy.** `POST /operations` acepta el `client_open_price` que
el cliente vio, si viene con un `quote_ticket` firmado de los últimos 5 s
(`QUOTE_TICKET_TTL_SECONDS`, `quote-ticket.ts`). No comprueba que ese precio siga
siendo el vigente.

**Por qué es un agujero.** Un cliente que guarda un ticket, mira el mercado
unos segundos y abre en la dirección en la que ya se movió, al precio viejo,
empieza con ventaja. Medido sobre este motor (3.000 intentos por celda, diez
activos; reproducible con `npm run evidence:broker-fit`,
[BROKER-FIT-2026-09-27](../evidence/BROKER-FIT-2026-09-27.md)):

| edad de la cotización | contrato de 30 s  | de 60 s | de 5 min |
| --------------------- | ----------------- | ------- | -------- |
| 1 s                   | 56–61% de acierto | 53–58%  | 50–54%   |
| 2 s                   | 59–61%            | 56–59%  | 52–54%   |
| 5 s                   | **62–65%**        | 58–61%  | 52–55%   |

Con un payout del 85% el punto de equilibrio es 54%. **Un segundo de latencia de
red ya basta.** Esto no es una propiedad del motor —el motor es una martingala
exacta hacia delante—: es mirar el pasado y apostar a él.

**Qué cambiar.**

- El ticket firma también la **`sequence`** del tick que el cliente vio.
- Al aceptar, el backend compara esa `sequence` con la del último tick que tiene
  del motor (su caché del stream, §4). Si ya hay uno más nuevo: **recotizar**
  (rechazar con el precio nuevo) o **aceptar al precio vigente**, nunca al viejo.
- Se guarda por operación la `sequence` de entrada: eso hace la liquidación
  reproducible desde el registro del motor (INV-009).

## 2. Liquidar: en el milisegundo final, sin redondear a segundos

**Qué hace Orbit hoy.** `settleOne` liquida con
`formatPrice(engine.priceAt(symbol, floor(expiresAt / 1000)), pricescale)`, y el
`priceAt` del simulador devuelve el precio _actual_ para cualquier segundo igual
o posterior a su último tick.

**Qué responde el motor.** `GET /markets/:id/price?at=<expiresAt en ms>`: el
último tick con instante ≤ `at`, la regla que usa `settle()` (ADR-0017). Responde
**400 «not yet»** mientras el motor no haya publicado hasta ese milisegundo; ahí
se reintenta, no se liquida. En cuanto lo ha publicado —el `asOf` del latido lo
dice— responde, sin esperar al siguiente tick (contrato 3.2.0). **Un contrato de
1 minuto nunca se liquida antes de su minuto** (ADR-0021).

**Qué cambiar.**

- `at` en **milisegundos**, el `expiresAt` exacto. `floor(… / 1000)` adelanta
  hasta 999 ms la liquidación: se liquida con un precio anterior al final del
  contrato.
- Un 400 es «todavía no»: reintentar. Un 404 es «el registro no llega»: alerta.
- **Empate si y sólo si los enteros `price` de entrada y salida son iguales**
  (ADR-0007, reembolso). Comparar cadenas formateadas sólo es equivalente si se
  formatean a la precisión que publica el motor (§3).

**Las costuras no cambian nada.** Si el motor se reinicia o el host lo congela,
el registro guarda una costura; dentro de ella el precio vigente es el último
tick antes del hueco y `/price` lo responde, con la costura nombrada en `seam`.
Un contrato que la cruza se liquida igual, en su milisegundo final (ADR-0021).
**No mapeéis una costura a `market_status: "paused"`**: una costura nunca cierra
un mercado.

## 3. La precisión: la que publica el motor, no cinco decimales

**Qué hace Orbit hoy.** El datafeed de TradingView limita
`pricescale` a 100.000 (`trading-events-datafeed.ts:856`,
`Math.min(100_000, backendPriceScale)`) y las pantallas formatean a cinco
decimales (dos por encima de 10.000); la liquidación compara esas cadenas.

**Qué publica el motor.** Cada activo tiene su `displayPrecision` en
`/catalogue`, en cada precio publicado y en cada vela (contrato 3.3.0), elegida
para que **un paso del precio sea al menos un dígito visible** hasta la mitad de
su precio de referencia. Para TradingView: `pricescale = 10 ** displayPrecision`,
`minmov = 1`.

**Seis activos necesitan seis decimales**: USD/CHF, EUR/GBP, AUD/USD, GBP/USD,
EUR/USD y DOGE/USDT. A cinco decimales un movimiento real se imprime como
«sin cambio», y vuestra comparación de cadenas lo declara empate donde
`settle()` no. Medido (reembolsos a 30 s):

| activo    | el motor | a 5 decimales |
| --------- | -------- | ------------- |
| USD/CHF   | 3,9%     | **16,0%**     |
| EUR/GBP   | 3,8%     | **14,9%**     |
| AUD/USD   | 4,2%     | **10,4%**     |
| GBP/USD   | 4,4%     | **8,4%**      |
| DOGE/USDT | 4,0%     | **8,0%**      |
| EUR/USD   | 3,5%     | **7,4%**      |

(Reproducible: [BROKER-FIT-2026-09-27](../evidence/BROKER-FIT-2026-09-27.md).)

**Qué cambiar.** Quitar el tope de 100.000 (o subirlo a 1.000.000) y la regla
2/5 de las pantallas: usar la `displayPrecision` de cada activo. En los otros 24
activos cinco decimales ya muestran cada paso, pero mostrar más decimales de
los que publica el motor enseña dígitos que el precio no tiene: usad también
ahí la del motor.

## 4. El stream y el mercado abierto

`GET /markets/stream?assets=a,b,c&heartbeat=1000` (un solo `EventSource` para
todos los símbolos, §3.4 de la guía genérica). Cada tick lleva `sequence`,
`instant` y `price` (el entero); el `heartbeat` lleva además `asOf`, el instante
hasta el que ese precio es definitivo.

- **Vuestro `quote.tick`** se emite desde los ticks del motor; el ticket de §1
  firma su `sequence`.
- **Vuestro `heartbeat` de 15 s y la regla de 15 s del frontend**: usad `asOf`
  como la hora de la cotización. Un mercado tranquilo, o una costura, sigue
  abierto; si `asOf` deja de avanzar, el motor no está publicando ese mercado y
  eso sí se mira en `/health`.
- **Horario y bloqueo manual** (`tradingSchedule`, `manualStatus`) son reglas
  vuestras y se quedan en vuestro backend: el motor publica continuamente.

## 5. Velas, volumen y resoluciones

| Orbit (`INTERVAL_SECONDS`)    | motor (`timeframe`)                            |
| ----------------------------- | ---------------------------------------------- |
| `1min` `5min` `15min` `30min` | `1m` `5m` `15m` `30m`                          |
| `1h` `4h` `1day`              | `1h` `4h` `1d`                                 |
| `2h`                          | agregad dos `1h`, como ya hacéis desde minutos |

`GET /markets/:id/history?timeframe=…&from=…&to=…` devuelve velas tipadas
(contrato 3.3.0): `open`/`high`/`low`/`close` como enteros, `tickCount`, y el
marco en que cuentan (`logQuantum`, `referencePrice`, `displayPrecision`).
**`volume` = `tickCount`.** Una vela con marco `null` cruza un cambio de
unidad y no es precio en ningún marco: no la dibujéis. La vela en formación se
pliega en vuestro backend con los ticks del stream, como hoy `currentBar`.

## 6. Mapa del simulador, método a método

| `MarketEngine` de Orbit            | el motor                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `has`, `listSymbols`, `asset`      | `GET /catalogue`                                              |
| `registerAsset`                    | los 30 activos ya existen; uno nuevo: `POST /assets` (admin)  |
| `start`, `stop`, `tick`, `tickAll` | no existen: el motor corre solo                               |
| `subscribe`                        | `GET /markets/stream?assets=…&heartbeat=1000`                 |
| `formatted`                        | `displayPrice` del motor, o el entero a su `displayPrecision` |
| `candles`                          | `GET /markets/:id/history`                                    |
| `currentBar`                       | vuestro pliegue de los ticks del stream                       |
| `quote`                            | último tick + `asOf` del latido; 24 h desde velas `1h`        |
| `priceAt(symbol, tsSec)`           | `GET /markets/:id/price?at=<ms>` (§2)                         |
| `setControl`, `control`            | **no existen, por diseño** (§0)                               |

## 7. Lista de verificación

- [ ] El panel del radar OTC desaparece para los símbolos del motor.
- [ ] El ticket firma la `sequence`; una apertura sobre un tick que ya no rige se recotiza o se acepta al precio vigente (§1).
- [ ] Se guarda la `sequence` de entrada y la respuesta de `/price` de salida por operación.
- [ ] La liquidación pide `/price?at=<expiresAt en ms>`, reintenta ante 400 y decide el empate por los enteros (§2).
- [ ] Ninguna costura se muestra como mercado pausado (§2, §4).
- [ ] `pricescale = 10 ** displayPrecision` por activo, sin el tope de 100.000 (§3).
- [ ] `volume = tickCount`; `2h` agregado desde `1h`; velas con marco `null` no se dibujan (§5).
- [ ] La frescura de la cotización se mide con `asOf` (§4).
- [ ] `npm run conformance -- --base <motor> --key <publicKey de publisher.json, 88 hex>` en verde antes de producción y en cada actualización del motor.
