/**
 * Los textos del panel, en español (PH-24.6).
 *
 * Un solo sitio, para que una palabra se cambie una vez. Los identificadores,
 * los `data-testid`, los nombres de campos de la API y el rótulo `OTC LAB —
 * SIMULATION ENVIRONMENT` que exige §3 no se traducen.
 */
export const es = {
  shell: {
    labMode:
      'este panel muestra el motor en modo Lab: lo que hagas en Lab es lo que ve Vista y el gráfico; ningún mercado aquí es real',
    brand: 'OTC ENGINE',
    nav: { preview: 'Vista', create: 'Crear activo', manage: 'Activos', lab: 'Lab' },
    labMark: 'SIM',
    engine: {
      loading: 'motor…',
      ok: (n: number) => `motor OK · ${String(n)} activos`,
      degraded: (s: number, n: number) => `motor degradado · ${String(s)} de ${String(n)} parados`,
      unreachable: 'motor inaccesible',
      info: 'El panel pregunta al motor cada cinco segundos si publica. Un mercado parado mantiene su stream abierto y no publica nada: desde el gráfico es indistinguible de uno tranquilo, así que la respuesta del propio motor está en todas las pantallas.',
    },
  },
  preview: {
    registered: (n: number, live: number) =>
      `${String(n)} registrados · ${String(live)} hospedados`,
    shown: (n: number) => `${String(n)} en la lista`,
    filter: 'buscar por id, nombre o familia',
    noMatches: (q: string) => `nada coincide con «${q}»`,
    hosted: 'hospedado',
    idle: 'inactivo',
    character: (pct: string, secs: string) => `${pct}% al trimestre · ${secs}s por tick`,
    characterInfo:
      'Cuánto recorre el mercado en un trimestre (dispersión) y cada cuánto imprime un tick de media. Describen el carácter del activo, nunca su dirección.',
    ticks: 'ticks →',
    select: 'Elige un activo.',
    loading: 'Cargando el catálogo…',
    empty: 'El catálogo está vacío.',
    unreachable: (e: string) => `No se alcanza el motor: ${e}`,
    status: {
      loading: 'cargando',
      loadingHistory: 'cargando historial',
      reloadingHistory: 'recargando historial tras un hueco',
      live: 'en vivo',
      liveAfterGap: 'en vivo — reconectado tras un hueco',
      interrupted: 'stream interrumpido',
      notHosted: 'sin hospedar',
      reconnecting: 'reconectando',
    },
    bars: (n: string) => `${n} velas`,
    liveBar: 'vela en curso',
    noLiveBar: 'sin vela en curso',
  },
  create: {
    title: 'Crear activo',
    intro:
      'Registrar un activo es un trabajo de seis etapas, cuatro de ellas simulación: de segundos a decenas de segundos según la familia. Cada etapa puede rechazar, y lo dice por su nombre.',
    id: 'Id',
    idInfo:
      'En minúsculas. Es el nombre de fichero y la etiqueta de derivación de claves: decide el keystream del mercado y no se puede cambiar después.',
    displayName: 'Nombre',
    displayNameInfo: 'Lo que se muestra en el gráfico. Nunca se compara ni se deriva nada de él.',
    family: 'Familia',
    familyInfo:
      'La región de la que se sortea la personalidad. Veinte mercados escritos a mano casi iguales serían un mercado con veinte nombres; aquí cada activo tiene una personalidad estadística distinta (INV-007).',
    familyRange: (min: string, max: string) =>
      `un trimestre recorre ${min}–${max}% salvo que fijes uno`,
    referencePrice: 'Precio de referencia',
    referencePriceInfo:
      'El precio mostrado en el origen del retículo. Cada precio publicado es un entero del retículo convertido con esta referencia.',
    dispersion: 'Dispersión trimestral (opcional)',
    dispersionInfo:
      'σ del retorno logarítmico a 90 días: cuánto recorre, nunca hacia dónde. El proceso es una martingala; no hay nada a lo que una dirección pueda engancharse.',
    submit: 'Registrar',
    submitting: 'Registrando…',
    stages: {
      identity: 'identidad',
      safety: 'seguridad',
      authoring: 'autoría',
      dispersion: 'dispersión',
      calibration: 'calibración',
      differentiation: 'diferenciación',
    },
    state: {
      queued: 'en cola',
      running: 'en curso',
      registered: 'registrado',
      refused: 'rechazado',
      failed: 'fallido',
    },
    stagesInfo:
      'El motor no informa del progreso mientras el trabajo corre; el informe es del resultado. Un rechazo marca la etapa que rechazó, con sus propias palabras, y esas palabras son lo único que vale la pena leer.',
    watch: 'ver en la Vista →',
    forgot: (job: string) =>
      `El motor ya no conoce el trabajo ${job}: se reinició, y los trabajos viven en su memoria. Mira Activos — si el activo aparece, el registro terminó antes del reinicio; si no, regístralo otra vez.`,
    number: (label: string, raw: string) =>
      `${label} debe ser un número positivo con punto decimal; se recibió «${raw}».`,
  },
  manage: {
    title: 'Activos',
    intro:
      'Un nombre puede cambiar. El id, el retículo, el precio de referencia y la personalidad no: decidieron lo que ya pasó. Retirar detiene el mercado y conserva todo lo publicado; no se deshace.',
    filter: 'buscar por id, nombre o familia',
    loading: 'Cargando el catálogo…',
    state: { retired: 'retirado', hosted: 'hospedado', idle: 'inactivo' },
    rename: 'renombrar',
    retire: 'retirar',
    save: 'guardar',
    cancel: 'cancelar',
    confirm: (id: string) => `¿retirar ${id} para siempre?`,
  },
  lab: {
    banner: {
      title: 'OTC LAB',
      subtitle: 'SIMULATION ENVIRONMENT',
      line: 'entorno de simulación — estado interno del motor y cursores del keystream; nunca un mercado con posiciones',
    },
    notRunning: 'No hay ningún Lab configurado',
    tabs: {
      board: 'Tablero',
      market: 'Mercado',
      replay: 'Reproducir',
      close: 'Cierre',
      positions: 'Posiciones',
      scenarios: 'Escenarios',
      quality: 'Calidad',
      session: 'Sesión',
    },
    replay: {
      title: 'Reproducir — el registro, otra vez, desde un estado guardado',
      info: 'El Lab guarda estados del motor de cada mercado: uno en cada armado y liberación, y uno por minuto. Reproducir toma uno, lo restaura en una copia (el mercado nunca retrocede) y vuelve a generar hasta ahora — con el vector que estaba armado en ese momento — comparando tick a tick con lo publicado. Idéntico es lo que promete INV-009; una divergencia sería un hallazgo sobre el motor, y se mostraría.',
      snapshots: 'estados guardados',
      why: { arm: 'armado', release: 'liberación', time: 'minuto' } as Record<string, string>,
      replayFrom: 'Reproducir desde aquí',
      verdict: 'veredicto',
      identical: (n: number) =>
        `IDÉNTICO — ${String(n)} ticks reproducidos coinciden con el registro`,
      divergent: (n: number, at: number) =>
        `DIVERGE en la secuencia ${String(at)} tras ${String(n)} ticks — un hallazgo sobre el motor`,
      nothing: 'nada que reproducir aún: el estado guardado es el más reciente',
      scriptPlayed: (n: number) => `${String(n)} signos armados reproducidos`,
      mirror: {
        title: 'El espejo — dos futuros desde este estado, con los signos invertidos',
        info: 'La prueba del producto, en este mercado, ahora: dos copias del motor desde el mismo estado, una con los signos del keystream y otra con cada signo invertido. Las magnitudes y los intervalos tienen que ser idénticos y los desplazamientos exactamente opuestos, porque el motor de magnitudes no puede ver un signo (ADR-0003). Es lo que el gate comprueba en cada ejecución, aquí visible.',
        ticks: 'ticks',
        run: 'Ver el espejo',
        plain: 'con los signos del keystream',
        flipped: 'con los signos invertidos',
        summary: (net: number, high: number, low: number) =>
          `neto ${String(net)} · máx ${String(high)} · mín ${String(low)}`,
        same: 'SOLO CAMBIAN LOS SIGNOS — magnitudes e intervalos idénticos, desplazamientos opuestos',
        differ: 'LAS MAGNITUDES O LOS INTERVALOS DIFIEREN — un hallazgo sobre el motor',
      },
    },
    board: {
      title: 'Tablero — todos los mercados del Lab',
      info: 'Cada fila es un mercado hospedado por este Lab: precio, régimen, si tiene algo armado y cuántos signos quedan, el último objetivo aplicado y cómo acabó, y las posiciones abiertas. Un acto es por mercado — cada motor tiene su propia moneda y su propio futuro — salvo liberar, que solo devuelve cada mercado a su keystream y por eso puede hacerse de una vez.',
      market: 'mercado',
      price: 'precio',
      regime: 'régimen',
      state: 'estado',
      last: 'último aplicado',
      positions: 'posiciones abiertas',
      releaseAll: 'Liberar todos',
      released: (n: number) => `${String(n)} mercado(s) liberado(s)`,
      nothing: 'ningún mercado armado',
    },
    chart: {
      title: 'Gráfico',
      info: 'Las velas del mercado que estás controlando, leídas del propio motor del Lab (nunca del motor de producción). Con un solo motor (ADR-0018) son las mismas velas que Vista.',
    },
    push: {
      title: 'Empujar',
      info: 'Cada botón hace que los próximos N ticks del mercado tomen ese signo — subir o bajar — con las magnitudes y los intervalos que el motor iba a generar de todos modos. No se suma nada al precio: el movimiento es del motor, solo la dirección es tuya. Al terminar, el mercado sigue su camino. Pulsar de nuevo en la misma dirección alarga el empuje; en la contraria, lo sustituye.',
      up: 'subir',
      down: 'bajar',
      unit: 'ticks',
      running: (dir: 'up' | 'down', n: number) =>
        `empujando ${dir === 'up' ? '↑' : '↓'} · ${String(n)} ticks por jugar`,
      idle: 'sin empuje — el mercado sigue su camino',
      landing: (price: string, n: number) => `llegará a ${price} tras ${String(n)} ticks`,
      extended: 'alargado',
      landed: (dir: 'up' | 'down', n: number, price: string, exact: boolean) =>
        `${dir === 'up' ? '↑' : '↓'} ${String(n)} ticks · llegó a ${price} ${exact ? '✓' : '✗ (no coincide con lo anunciado)'}`,
      released: (n: number) =>
        `se liberó lo que estaba armado en este mercado (quedaban ${String(n)} signos) para empujar`,
      refusedPush:
        'hay un empuje en curso — espera a que termine o libéralo antes de fijar un cierre',
      failed: (reason: string) => `el empuje no se envió: ${reason}`,
    },
    header: {
      price: 'precio',
      regime: 'régimen',
      armed: 'ARMADO',
      keystream: 'keystream',
      remaining: (n: number) => `${String(n)} signos`,
    },
    market: {
      sequence: 'secuencia',
      price: 'precio',
      lattice: 'nivel del retículo',
      latticeInfo:
        'El precio canónico es un entero de un retículo logarítmico (ADR-0004); el precio mostrado es su conversión. Aquí van los dos, cada uno con su nombre.',
      magnitude: 'última magnitud',
      interval: 'último intervalo',
      direction: 'próximo tick',
      directionValue: 'SUBE 50,000 % · BAJA 50,000 %',
      directionInfo:
        'Exactamente la mitad, siempre, por construcción y no por calibración. Un incremento es signo × magnitud; el signo es una moneda justa independiente y el motor de magnitudes no puede observar un signo, un precio ni nada derivado de ellos (ADR-0003). No hay desglose de influencias porque no hay nada que desglosar.',
      cursors: 'cursores del keystream',
      cursorsInfo:
        'INV-010 prohíbe publicarlos. Existen aquí y en ninguna respuesta de producción; por eso el Lab es un proceso aparte y no un interruptor.',
      regime: 'régimen de volatilidad',
      cascade: 'fase de la cascada',
      net: 'desplazamiento neto',
      netValue: (m1: number | null, m5: number | null) =>
        `${m1 === null ? '—' : (m1 > 0 ? '+' : '') + String(m1)} en 1 min · ${m5 === null ? '—' : (m5 > 0 ? '+' : '') + String(m5)} en 5 min`,
      netInfo:
        'La «fuerza de la tendencia», como lo que es: pasos del retículo recorridos netos en el último minuto y los últimos cinco. El motor no tiene un mecanismo de tendencia (ADR-0003); una tendencia realizada es una excursión de un paseo justo, y esto es su tamaño.',
    },
    close: {
      title: 'Cierre de vela',
      info: 'El cierre es el precio en vigor al final de la vela (ADR-0017). Se elige entre los futuros del propio motor, nunca se empuja: la tasa es la fracción de ellos que cierran ahí, y un objetivo que el mercado no alcanza se rechaza nombrando los precios alcanzables.',
      timeframe: 'marco',
      bucket: 'vela',
      current: 'vela actual',
      next: 'vela siguiente',
      atTime: 'a una hora',
      expiryTime: 'hora (UTC, hoy)',
      expiryInfo:
        'El cierre se define en ese instante exacto: el precio en vigor a esa hora, inclusive (ADR-0017). Si la hora ya pasó hoy, se toma la de mañana.',
      targetPrice: {
        title: 'Objetivo de precio — tocar un nivel, sin hora fija',
        info: 'Distinto del cierre exacto: aquí el mercado tiene que alcanzar el nivel en algún momento de la ventana, sin condición sobre dónde termina (§G). La fuerza no es un modo: es la tasa de aceptación, la fracción de futuros del propio motor que lo tocan.',
        price: 'precio a tocar',
        steps: 'o pasos desde aquí (± arriba/abajo)',
        window: 'ventana (s)',
        preview: 'Previsualizar',
        apply: 'Aplicar',
        level: 'nivel a tocar',
        noEnd: 'sin condición de cierre — el motor decide dónde termina',
      },
      price: 'precio de cierre',
      preview: 'Previsualizar',
      apply: 'Aplicar',
      release: 'Liberar mercado',
      relative: 'cerrar respecto al precio actual:',
      relativeUnit: 'pasos del retículo (ticks)',
      releaseInfo:
        'Vuelve al keystream. Un tick ya sorteado se publica tal cual — nada des-sortea una moneda — y el siguiente sorteo ya es del keystream: sin salto, un tick de latencia.',
      source: 'fuente de signos',
      armed: (n: number) => `ARMADO — quedan ${String(n)} signos`,
      keystream: 'keystream (nada armado)',
      lastApplied: 'último aplicado',
      onBoundary:
        'tick en la frontera: el gráfico lo muestra como apertura de la vela siguiente (ADR-0017)',
      pending: (target: string, when: string) => `objetivo ${target} a las ${when} — pendiente`,
      outcome: (target: string, closed: string, exact: boolean) =>
        `objetivo ${target} · cerró en ${closed} — ${exact ? 'EXACTO' : 'FALLÓ'}`,
      target: 'objetivo',
      closesAt: 'cierra a las',
      ticks: 'ticks en la ventana',
      steps: 'pasos hasta el objetivo',
      reach: 'alcanzabilidad',
      reachValue: {
        easy: 'fácil',
        normal: 'normal',
        difficult: 'difícil',
        critical: 'crítica',
        'outside-natural-range': 'FUERA DEL RANGO NATURAL',
      } as Record<string, string>,
      attempts: 'intentos',
      rate: 'tasa de aceptación',
      rateInfo:
        'Medida, no estimada: la fracción de los futuros del propio motor que cierran en el objetivo. Un objetivo imposible por paridad o por rango se rechaza sin muestrear.',
      armedYes: 'SÍ — los próximos ticks son el vector elegido',
      armedNo: 'no',
      between: (req: string) =>
        `${req} no es un nivel del retículo de este activo. Los dos más cercanos:`,
      parity:
        'Inalcanzable por paridad: la suma de los pasos restantes deja la mitad del retículo fuera. Alcanzables al lado:',
      range: (max: string, delta: string) =>
        `Los ticks restantes mueven como mucho ${max} pasos y el objetivo está a ${delta}.`,
      noneFound:
        'Ningún camino natural cerró ahí en los sorteos: alcanzable en teoría, prácticamente fuera del rango natural.',
      noTicks: 'Ningún tick cae dentro de la ventana.',
    },
    positions: {
      title: 'Posiciones simuladas',
      info: 'Una posición simulada es un contrato del motor de trading, liquidado por la liquidación de producción contra el registro de este Lab. Un preset es un cierre a la expiración de la posición: un nivel del retículo desde la entrada, que es el tick propio del activo. Las dos columnas deben coincidir; una fila que no coincide es un hallazgo, no un error de pantalla.',
      stake: 'importe',
      horizon: 'expira en (s)',
      call: 'abrir CALL',
      put: 'abrir PUT',
      none: 'ninguna posición simulada',
      entry: 'entrada',
      expires: 'expira',
      expected: 'esperado',
      actual: 'real',
      notExpired: 'sin expirar',
      agrees: 'COINCIDE',
      disagrees: 'NO COINCIDE CON LO ESPERADO',
      basis: {
        'armed-target': 'según el objetivo armado',
        'current-price': 'según el precio actual',
      } as Record<string, string>,
      outcome: { win: 'gana', loss: 'pierde', refund: 'empate' } as Record<string, string>,
      presets: {
        'win-minimum': 'GANA por mínima',
        'loss-minimum': 'PIERDE por mínima',
        tie: 'EMPATE',
        'entry-plus-tick': 'entrada +1 tick',
        'entry-minus-tick': 'entrada −1 tick',
        'exact-entry': 'entrada exacta',
      } as Record<string, string>,
      net: 'neto',
    },
    scenarios: {
      title: 'Escenarios',
      info: 'El Lab define la forma; el motor genera el camino. Un escenario es un criterio sobre los futuros del propio motor en la ventana: no se produce nada, se elige uno. La tasa dice lo raro que es, y una forma que este mercado no hace en esta ventana se reporta como cero, no se empuja.',
      window: 'ventana (s)',
      preview: 'Previsualizar',
      apply: 'Aplicar',
      notSelectable: 'no seleccionable',
      whyTitle: 'Por qué no',
      shock: {
        title: 'Shock — localizar el próximo paso grande y elegir su dirección',
        info: 'Un shock es un paso de magnitud excepcional en un solo tick, y la magnitud la decide el motor, no los signos (ADR-0003). El Lab no puede encargarlo: busca en la ventana si el motor está a punto de producir uno de al menos este tamaño y, si lo está, elige su dirección — una moneda que la moneda justa pudo haber sacado.',
        size: 'paso ≥ (pasos del retículo)',
        direction: 'dirección',
        up: 'sube',
        down: 'baja',
        preview: 'Buscar',
        apply: 'Aplicar dirección',
        none: 'No viene ningún paso de ese tamaño en la ventana.',
        at: (tick: number) => `viene en el tick ${String(tick)} de la ventana`,
      },
      why: {
        'extreme-volatility':
          'La volatilidad extrema son pasos grandes, y el tamaño de un paso no depende de los signos (ADR-0003). Ningún criterio sobre signos puede seleccionarla; el Lab muestra el régimen y la cascada en Mercado y puede decir si viene un paso grande (shock).',
        'low-activity':
          'La actividad es el proceso de llegadas — cuánto pasa entre ticks — y los intervalos no dependen de los signos. Ningún criterio sobre signos puede seleccionarla; el Lab muestra la excitación de llegadas en Mercado.',
      } as Record<string, string>,
      labels: {
        'target-price': 'Objetivo de precio',
        'bullish-trend': 'Tendencia alcista',
        'bearish-trend': 'Tendencia bajista',
        sideways: 'Lateral',
        'bull-pullback': 'Alcista → retroceso',
        'bear-pullback': 'Bajista → retroceso',
        'bullish-breakout': 'Ruptura alcista',
        'bearish-breakout': 'Ruptura bajista',
        'bullish-false-breakout': 'Falsa ruptura alcista',
        'bearish-false-breakout': 'Falsa ruptura bajista',
        'bull-bear-reversal': 'Giro alcista → bajista',
        'bear-bull-reversal': 'Giro bajista → alcista',
        'volatility-expansion': 'Expansión de volatilidad',
        'volatility-compression': 'Compresión de volatilidad',
        'high-noise': 'Ruido alto',
        'extreme-volatility': 'Volatilidad extrema',
        'low-activity': 'Actividad baja',
      } as Record<string, string>,
      params: {
        net: 'desplazamiento neto ≥ (pasos)',
        range: 'rango realizado (pasos)',
        rise: 'subida ≥ (pasos)',
        fall: 'caída ≥ (pasos)',
        depth: 'profundidad del retroceso (fracción)',
        level: 'nivel (pasos desde aquí)',
        hold: 'puede ceder como mucho (pasos)',
        changes: 'cambios de dirección ≥',
      } as Record<string, string>,
      shape: 'forma elegida',
      shapeValue: (net: number, high: number, low: number, range: number, changes: number) =>
        `neto ${String(net)} · máx ${String(high)} · mín ${String(low)} · rango ${String(range)} · ${String(changes)} cambios de dirección`,
      windowRow: 'ventana',
      windowValue: (ticks: number, when: string) => `${String(ticks)} ticks, hasta las ${when}`,
      armedYes: 'SÍ — los próximos ticks son la continuación elegida',
      noneFound:
        'Ninguna continuación natural cumplió el criterio en los sorteos: este mercado no hace eso en esta ventana. Esa es la respuesta, no un esfuerzo insuficiente.',
    },
    quality: {
      title: 'Calidad del mercado',
      run: 'Medir',
      running: 'midiendo…',
      realism: 'realismo',
      realismValue: (passed: number, of: number) =>
        `${String(passed)} de ${String(of)} métricas dentro de banda, en este fork`,
      realismInfo:
        'Tres forks consecutivos de un mismo mercado a este tamaño de muestra midieron 14/15, 15/15 y 15/15: la palabra cambia y el mercado no. Es una lectura, no un hallazgo. El veredicto estable es el del gate, sobre 24 millones de ticks.',
      predictability: 'predictibilidad',
      verdict: {
        inconclusive: 'NO CONCLUYENTE — sobrevivieron muy pocas hipótesis para haber mirado',
        'clean-above-resolution': 'limpio, por encima de la resolución',
        exploitable: 'VENTAJA DETECTADA',
      } as Record<string, string>,
      resolution: 'resolución',
      resolutionValue: (pp: string) => `sin ventaja por encima de ${pp} pp`,
      resolutionInfo:
        '«Limpio» y «limpio a una resolución declarada» son afirmaciones distintas y solo la segunda se puede usar. Una muestra de un millón de ticks resuelve alrededor de un punto porcentual, frente a un umbral de materialidad de 0,25 pp.',
      hypotheses: 'hipótesis contrastadas',
      hypothesesValue: (n: number, min: number) =>
        `${String(n)} (un veredicto necesita ${String(min)})`,
      hypothesesInfo:
        'La batería descarta cualquier bucket con menos de 500 resultados decididos. Con 40.000 ticks sobrevivían dos hipótesis de ochocientas; con un millón, unas 378. Dos se lee igual que 378 si la palabra en pantalla es la misma — por eso se muestra la cuenta.',
      sample: 'ticks muestreados',
      sampleInfo:
        'Una muestra acotada, no una ejecución del gate. La evidencia registrada usa 24 millones de ticks; esto mira un millón para que la pantalla tenga algo veraz.',
      notes: 'detalle técnico',
    },
    session: {
      title: 'Sesión',
      engine: 'MOTOR — lo que hizo el mercado sin que nadie lo pidiera',
      lab: 'LAB — lo que pidió el operador',
      engineEmpty: 'nada registrado todavía',
      labEmpty: 'ninguna acción del Lab en esta sesión',
      info: 'Dos cronologías separadas por construcción, nunca mezcladas (§72–§73): una sesión del Lab tiene que poder leerse como evidencia sobre el motor, y una cronología que las mezclara no podría.',
      closes: 'cierres de esta sesión',
      export: 'Exportar sesión (.jsonl)',
      exportInfo:
        'La sesión se escribe línea a línea en el directorio de estado del Lab y sobrevive a un reinicio (§78). El fichero lleva las dos cronologías con un campo que las distingue; la pantalla nunca las mezcla.',
      positions: 'posiciones de esta sesión',
      positionsInfo:
        'La otra lectura §70: cómo acabaron las posiciones liquidadas, por resultado y por el preset que las decidió. Nueve de cada diez a un lado, sobre diez o más, es una mano y no un mercado.',
      settled: 'posiciones liquidadas',
      settledValue: (n: number, min: number) =>
        `${String(n)} (un veredicto necesita ${String(min)})`,
      wins: 'ganadas',
      byPreset: 'por preset',
      closesInfo:
        'Los caminos que produce una selección no llevan firma — eso es la construcción. La mano que elige los cierres sí puede: una sesión que siempre cierra un paso más allá de la entrada tiene una distribución que ningún mercado natural tiene. Esto la mide y dice sobre cuántos cierres se apoya; con menos de diez no dice nada.',
      controlled: 'cierres controlados',
      controlledValue: (n: number, min: number) =>
        `${String(n)} (un veredicto necesita ${String(min)})`,
      oneStep: 'a un paso del retículo',
      distances: 'distancias (pasos: cuenta)',
      verdict: {
        'too-few-to-say': 'DEMASIADO POCOS PARA DECIR',
        'no-pattern': 'SIN PATRÓN',
        'one-sided': 'SESGADO',
      } as Record<string, string>,
    },
    acts: {
      'close.apply': 'cierre aplicado',
      'preset.apply': 'preset aplicado',
      'scenario.apply': 'escenario aplicado',
      release: 'liberado',
      'position.open': 'posición abierta',
    } as Record<string, string>,
  },
} as const;
