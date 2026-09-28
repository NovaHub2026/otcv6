# API Contract

Type: SUPPORTING DOCUMENTATION (generated; do not edit by hand)
Version: 3.7.0
Digest: b0d3c7c839be46dd
Source: `apps/api/src/contract.ts` — rendered by `npm run contract:render`; held to the controller by `contract.test.ts`

---

Every public route of the venue, what it takes, what it answers and how it
refuses. Types: `integer`, `number`, `string`, `boolean`, `array`, `object`,
and `T|null` for a nullable. `GET /contract` serves the same data; `/health`
carries the version. A change to any route is a new version in
`CONTRACT_HISTORY`, or the unit suite fails.

## GET `/health`

Whether every hosted market is publishing, and the contract version this venue speaks.

Response: a JSON object:

| Key | Type |
| --- | --- |
| `status` | `string` |
| `assets` | `integer` |
| `stalled` | `array` |
| `bootNonce` | `string|null` |
| `apiVersion` | `string` |
| `ready` | `boolean` |
| `composition` | `string` |

## GET `/health/live`

Liveness: the process serves HTTP. Nothing about the markets.

Response: a JSON object:

| Key | Type |
| --- | --- |
| `live` | `boolean` |

## GET `/health/ready`

Readiness: every market resumed and primed, nothing stalled; 503 with the reason until then.

Response: a JSON object:

| Key | Type |
| --- | --- |
| `ready` | `boolean` |

| Status | When |
| --- | --- |
| 503 | the markets have not finished resuming, the venue is shutting down, or a market is stalled (named) |

## GET `/metrics`

The operator counters in the Prometheus text format: markets, stalls, readiness, ticks published, subscribers, replay budget, uptime, memory, record heads.

Response: `text/plain`, the prometheus text format.

## GET `/contract`

This contract, as data, with its version and digest.

Response: a JSON object:

| Key | Type |
| --- | --- |
| `version` | `string` |
| `digest` | `string` |
| `routes` | `array` |

## GET `/markets`

Every hosted market and where it stands.

Response: a JSON array; each item:

| Key | Type |
| --- | --- |
| `id` | `string` |
| `displayName` | `string` |
| `family` | `string` |
| `price` | `integer|null` |
| `displayPrice` | `string|null` |
| `sequence` | `integer|null` |
| `instant` | `integer|null` |
| `recovery` | `object|null` |

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id`

One hosted market and where it stands.

| Path parameter | Must be |
| --- | --- |
| `id` | a hosted asset id |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `id` | `string` |
| `displayName` | `string` |
| `family` | `string` |
| `price` | `integer|null` |
| `displayPrice` | `string|null` |
| `sequence` | `integer|null` |
| `instant` | `integer|null` |
| `recovery` | `object|null` |

| Status | When |
| --- | --- |
| 404 | the asset is not hosted |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/catalogue`

Every asset this deployment knows, hosted or not, with its instrument and calibration.

Response: a JSON array; each item:

| Key | Type |
| --- | --- |
| `seat` | `object|null` |
| `id` | `string` |
| `displayName` | `string` |
| `family` | `string` |
| `live` | `boolean` |
| `retired` | `boolean` |
| `referencePrice` | `number` |
| `displayPrecision` | `integer` |
| `logQuantum` | `number` |
| `meanIntervalMs` | `number` |
| `tieRate` | `number` |
| `realisedRefundRate` | `number` |
| `excessKurtosis` | `number` |
| `dispersion` | `object` |

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/archetypes`

The archetypes an operator may register an asset under.

Response: a JSON array; each item:

| Key | Type |
| --- | --- |
| `id` | `string` |
| `label` | `string` |
| `family` | `string` |
| `character` | `string` |
| `dispersion` | `object` |
| `excessKurtosis` | `object` |

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id/history`

Stored candles of one market over a window, at an offered timeframe.

| Path parameter | Must be |
| --- | --- |
| `id` | a known asset id |

| Query parameter | Must be |
| --- | --- |
| `timeframe` | an offered timeframe id, 1m or coarser |
| `from` | an instant in milliseconds, inclusive |
| `to` | an instant in milliseconds, exclusive, after from |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `timeframe` | `string` |
| `from` | `integer` |
| `to` | `integer` |
| `candles` | array of `{ openInstant: integer, timeframe: string, open: integer, high: integer, low: integer, close: integer, tickCount: integer, firstSequence: integer, lastSequence: integer, logQuantum: number|null, referencePrice: number|null, displayPrecision: integer|null }` |

| Status | When |
| --- | --- |
| 400 | a missing or malformed parameter, a timeframe finer than 1m, or a window past 20 000 bars |
| 404 | the asset is unknown, or this deployment keeps no candle history |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id/ticks/:sequence`

The published tick at a sequence, from the record.

| Path parameter | Must be |
| --- | --- |
| `id` | a known asset id; a retired market's record still answers |
| `sequence` | a positive integer written as digits |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |
| `logQuantum` | `number|null` |
| `referencePrice` | `number|null` |
| `displayPrecision` | `integer|null` |
| `displayPrice` | `string|null` |

| Status | When |
| --- | --- |
| 400 | the sequence is not a positive integer |
| 404 | the asset is unknown, or this deployment keeps no record, or the sequence is not in it — outside its bounds, which are named, or inside them and inside a gap, which says so and points at `/markets/:id/seams`. The record's sequences are not contiguous: a market that resumes past its catch-up bound leases fresh ones and never republishes what it skipped |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id/price`

The price in force at an instant: the last published tick at or before it, the rule settlement uses. A retired market answers it from its record, which is what retirement leaves readable.

| Path parameter | Must be |
| --- | --- |
| `id` | a known asset id; a retired market's record still answers |

| Query parameter | Must be |
| --- | --- |
| `at` | an instant in milliseconds |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `at` | `integer` |
| `rule` | `string` |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |
| `logQuantum` | `number|null` |
| `referencePrice` | `number|null` |
| `displayPrecision` | `integer|null` |
| `displayPrice` | `string|null` |
| `seam` | `object|null` |

| Status | When |
| --- | --- |
| 400 | a missing or malformed instant, or an instant after the one the price is final through — the last clean pass for a hosted market, the newest instant its record holds for one this process no longer hosts. This is what makes a contract impossible to settle before its final millisecond |
| 404 | the asset is unknown, the record starts after the instant, or this deployment keeps no record |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id/seams`

Every discontinuity the record holds for this market: where it stops and where it starts again, in sequence and in instant. What settle() takes as seams.

| Path parameter | Must be |
| --- | --- |
| `id` | a known asset id; a retired market's record still answers |

Response: a JSON array; each item:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `lastSequence` | `integer` |
| `lastInstant` | `integer` |
| `resumesAtSequence` | `integer` |
| `resumesAtInstant` | `integer` |
| `reframes` | `boolean` |

| Status | When |
| --- | --- |
| 404 | the asset is unknown, or this deployment keeps no record |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id/lattices`

Every frame this market's integers have counted in, oldest first. Half-open by sequence: an epoch covers up to the next one's fromSequence, and the last is in force. The join table for a broker that archived raw integers.

| Path parameter | Must be |
| --- | --- |
| `id` | a known asset id; a retired market's record still answers |

Response: a JSON array; each item:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `fromSequence` | `integer` |
| `fromInstant` | `integer` |
| `logQuantum` | `number` |
| `referencePrice` | `number` |
| `displayPrecision` | `integer` |

| Status | When |
| --- | --- |
| 404 | the asset is unknown, or this deployment keeps no record |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/:id/proof/:sequence`

The inclusion proof of a published sequence: the signed commitment of its window, the Merkle path and the publisher key.

| Path parameter | Must be |
| --- | --- |
| `id` | a hosted asset id |
| `sequence` | a positive integer written as digits |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `sequence` | `integer` |
| `publisherPublicKey` | `string|null` |
| `commitment` | `object` |
| `proof` | `object` |
| `linksRead` | `integer` |

| Status | When |
| --- | --- |
| 400 | the sequence is not a positive integer |
| 404 | the asset is unknown, or this deployment does not publish commitments |
| 409 | the sequence is published but its window is not yet committed (the newest committed sequence is named), or the archive disagrees with the record, or the archived window no longer hashes to the root its commitment signs |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |
| 503 | the commitment chain file is damaged past a line the message names; proofs of earlier sequences are unaffected |

## GET `/markets/:id/stream`

Server-sent events: every tick of one market in order, resumable by sequence; a gap is told, never skipped.

| Path parameter | Must be |
| --- | --- |
| `id` | a hosted asset id |

| Query parameter | Must be |
| --- | --- |
| `from?` | the next sequence wanted; omitted joins at the live edge |
| `onGap?` | 'live' to be told a gap and joined at the sequence the feed resumes at, instead of a 400 |
| `heartbeat?` | milliseconds between heartbeat frames, 500 to 30000; omitted, the stream carries none |

Response: `text/event-stream`. Frames by event name (`message` is the default event):

`message`:

| Key | Type |
| --- | --- |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |

`gap`:

| Key | Type |
| --- | --- |
| `requested` | `integer|null` |
| `reason` | `string` |
| `resumesAt` | `integer|null` |

`close`:

| Key | Type |
| --- | --- |
| `reason` | `string` |

`heartbeat`:

| Key | Type |
| --- | --- |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |
| `asOf` | `integer` |

| Status | When |
| --- | --- |
| 400 | a malformed from or onGap, or (without onGap=live) a sequence the venue cannot replay — including, between a restart that seamed this market and its first tick, every sequence below the one it will resume at |
| 404 | the asset is not hosted |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/markets/stream`

Server-sent events: several markets on one connection, each frame naming its asset.

| Query parameter | Must be |
| --- | --- |
| `assets` | comma-separated hosted asset ids |
| `from?` | per-asset next sequences, in the order of assets |
| `onGap?` | 'live', as for one market |
| `heartbeat?` | milliseconds between heartbeat frames, 500 to 30000; omitted, the stream carries none |

Response: `text/event-stream`. Frames by event name (`message` is the default event):

`message`:

| Key | Type |
| --- | --- |
| `asset` | `string` |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |

`gap`:

| Key | Type |
| --- | --- |
| `asset` | `string` |
| `requested` | `integer|null` |
| `reason` | `string` |
| `resumesAt` | `integer|null` |

`close`:

| Key | Type |
| --- | --- |
| `asset` | `string` |
| `reason` | `string` |

`heartbeat`:

| Key | Type |
| --- | --- |
| `asset` | `string` |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |
| `asOf` | `integer` |

| Status | When |
| --- | --- |
| 400 | a malformed parameter, or an asset that is not hosted |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/registrations`

Every asset-registration job this process has run.

Response: a JSON array; each item:

| Key | Type |
| --- | --- |
| `id` | `string` |
| `brief` | `object` |
| `state` | `string` |
| `stage` | `string|null` |
| `reason` | `string|null` |
| `assetId` | `string|null` |
| `submittedAt` | `integer` |
| `finishedAt` | `integer|null` |

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## GET `/registrations/:id`

One registration job.

| Path parameter | Must be |
| --- | --- |
| `id` | a job id |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `id` | `string` |
| `brief` | `object` |
| `state` | `string` |
| `stage` | `string|null` |
| `reason` | `string|null` |
| `assetId` | `string|null` |
| `submittedAt` | `integer` |
| `finishedAt` | `integer|null` |

| Status | When |
| --- | --- |
| 404 | no such job |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## POST `/assets`

Register an asset from a brief; answers the job that builds it.

Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## PATCH `/assets/:id`

Rename an asset.

Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |

## POST `/assets/:id/retire`

Stop hosting a market; its record stays readable.

Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.

| Status | When |
| --- | --- |
| 429 | too many requests from this address; `Retry-After` names the wait in seconds (`OTC_RATE_LIMIT_PER_MINUTE`, 600 a minute by default, `0` disables it). `/health/live`, `/health/ready` and `/metrics` are never refused |
