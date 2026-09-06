/**
 * Liquidación de una opción binaria contra el registro publicado.
 *
 * Compilar y ejecutar:
 *
 *   npm run build
 *   npx tsc examples/settle-example.ts --module nodenext --moduleResolution nodenext \
 *       --target es2023 --outDir examples/dist
 *   node examples/dist/settle-example.js
 *
 * Lo importante no es la llamada: es de dónde sale el registro, qué hay que
 * guardar para poder re-derivar el resultado años después, y qué hacer cuando
 * el motor se niega a liquidar.
 */

import { durationMillis, epochMillis } from '@otc/core';
import { NotSettleableError, expiryOf, settle } from '@otc/trading';
import type { Contract, TickRecord } from '@otc/trading';

/** Un tick tal y como llega por el stream. */
interface Tick {
  readonly instant: number;
  readonly sequence: number;
  readonly price: number;
}

/**
 * El registro que la liquidación necesita: arrays paralelos, ordenados por
 * instante.
 *
 * En producción sale de TU copia de los ticks — los recibes por el stream y los
 * guardas. La liquidación no llama al motor: se hace contra lo que ya se
 * publicó, y por eso es reproducible.
 */
function recordFrom(ticks: readonly Tick[]): TickRecord {
  return {
    instants: Float64Array.from(ticks.map((t) => t.instant)),
    prices: Int32Array.from(ticks.map((t) => t.price)),
  };
}

// ── Un registro de ejemplo: un tick por segundo durante tres minutos. ────────
const start = 1_788_492_000_000;
const ticks: Tick[] = Array.from({ length: 180 }, (_unused, i) => ({
  instant: start + i * 1_000,
  sequence: 650_000 + i,
  // Sube y baja alrededor del nivel inicial; enteros del retículo, no precios.
  price: -12_043 + Math.round(20 * Math.sin(i / 7)),
}));

// ── El contrato: CALL a 60 segundos, pago 85%. ──────────────────────────────
const entryInstant = epochMillis(start + 30_000);
const contract: Contract = {
  id: 'ticket-1001',
  assetId: 'eurusd-otc',
  direction: 'up', // 'up' | 'down'
  stake: 100, // unidades de cuenta; de quién son, es cosa tuya
  entryInstant,
  horizonMs: durationMillis(60_000), // expiración fija
  payoutRatio: 0.85, // beneficio por unidad apostada si gana
};

const record = recordFrom(ticks);

try {
  const settlement = settle(contract, record);
  //                 settle(contract, record, 'loss')  ← empate = pérdida
  //                 settle(contract, record, 'win')   ← empate = ganancia
  //                 sin tercer argumento: 'refund'

  console.log(settlement);
  // {
  //   contractId:    'ticket-1001',
  //   outcome:       'win' | 'loss' | 'refund',
  //   entryPrice:    -12043,        // enteros del retículo, nunca el mostrado
  //   expiryPrice:   -12001,
  //   entryIndex:    30,            // posiciones del registro que se usaron
  //   expiryIndex:   90,
  //   expiryInstant: 1788492090000,
  //   returned:      185,           // stake * (1 + payoutRatio) si gana
  //   net:           85,            // returned - stake
  // }

  // GUARDA, POR CONTRATO: el contrato entero y el rango de secuencias del
  // registro que usaste. Con eso, cualquiera que tenga los ticks publicados
  // vuelve a obtener exactamente el mismo resultado.
  const used = {
    contract,
    firstSequence: ticks[settlement.entryIndex]?.sequence,
    lastSequence: ticks[settlement.expiryIndex]?.sequence,
    outcome: settlement.outcome,
  };
  console.log(used);
} catch (error) {
  if (error instanceof NotSettleableError) {
    // No es un fallo: es el motor negándose a inventar.
    //  · registro que empieza después de la entrada  → fallo de tu almacén;
    //  · registro que termina antes de la expiración → todavía no ha expirado,
    //    reintenta más tarde.
    console.error(`no liquidable: ${error.message}; expira en ${String(expiryOf(contract))}`);
  } else {
    throw error;
  }
}

/*
 * REGLAS QUE IMPORTAN
 *
 *   · precio de entrada    = último tick con instante <= entryInstant
 *   · precio de expiración = último tick con instante <= entryInstant + horizonMs
 *   · empate               = AtMoneyPolicy: 'refund' (por defecto), 'loss' o 'win'
 *   · registro incompleto  = NotSettleableError, nunca un resultado inventado
 *   · todo se decide sobre el entero `price`, jamás sobre el precio mostrado
 */
