/**
 * Cliente de ticks con reanudación, en Node puro (sin dependencias).
 *
 *   node examples/ticks-client.mjs eurusd-otc
 *
 * Muestra las tres cosas que un integrador tiene que hacer bien:
 *
 *   1. reanudar por SECUENCIA, no por tiempo;
 *   2. tratar un 400 por secuencia desalojada como "recarga el histórico",
 *      no como un error transitorio que se reintenta igual;
 *   3. convertir el entero del retículo a precio solo para mostrarlo.
 */

const BASE = process.env.OTC_API_BASE ?? 'http://127.0.0.1:3000';
const ASSET = process.argv[2] ?? 'eurusd-otc';

/** Igual que `displayPrice` de @otc/chart, sin importar el paquete. */
const shown = (price, { referencePrice, logQuantum, displayPrecision }) =>
  (referencePrice * Math.exp(logQuantum * price)).toFixed(displayPrecision);

const catalogue = await (await fetch(`${BASE}/catalogue`)).json();
const asset = catalogue.find((a) => a.id === ASSET);
if (asset === undefined) throw new Error(`Unknown asset ${ASSET}`);

let from = null; // null = borde vivo; después, la última secuencia vista + 1

for (;;) {
  const url =
    from === null
      ? `${BASE}/markets/${ASSET}/stream?onGap=live`
      : `${BASE}/markets/${ASSET}/stream?from=${from}&onGap=live`;

  const response = await fetch(url, { headers: { accept: 'text/event-stream' } });

  if (response.status === 400) {
    // La secuencia pedida ya no está retenida. Nada de reintentar con la misma:
    // recarga el histórico y vuelve al borde vivo.
    console.warn(`[gap] ${await response.text()}`);
    from = null;
    continue;
  }
  if (!response.ok) {
    console.warn(`[retry] HTTP ${response.status}`);
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);

        const event = /^event: (.+)$/m.exec(frame)?.[1] ?? 'message';
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (data === undefined) continue;

        if (event === 'gap') {
          // Hay ticks que no vamos a ver: [requested, resumesAt - 1]. Lo que
          // sigue es la ventana que el servidor aún retiene, desde resumesAt
          // (o el borde vivo, con resumesAt null, si el rechazo fue por
          // presupuesto). Ese tramo se recarga del histórico de velas.
          const gap = JSON.parse(data);
          console.warn(
            `[gap] pedí ${gap.requested}; el servidor sigue desde ${gap.resumesAt ?? 'el borde vivo'}: ${gap.reason}`,
          );
          continue;
        }

        const tick = JSON.parse(data);
        from = tick.sequence + 1;
        console.log(
          `${new Date(tick.instant).toISOString()}  #${tick.sequence}  ` +
            `${shown(tick.price, asset)}  (lattice ${tick.price})`,
        );
      }
    }
  } catch (error) {
    console.warn(`[reconnect] ${error.message}`);
  }
  // La conexión se cerró: reanuda exactamente donde se quedó.
  await new Promise((r) => setTimeout(r, 250));
}
