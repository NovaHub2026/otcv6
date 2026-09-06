# API Contract

Type: SUPPORTING DOCUMENTATION (generated; do not edit by hand)
Version: 1.0.0
Digest: 5bc1dd766f15aa0c
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
| `excessKurtosis` | `number` |
| `dispersion` | `object` |

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
| `candles` | `array` |

| Status | When |
| --- | --- |
| 400 | a missing or malformed parameter, a timeframe finer than 1m, or a window past 20 000 bars |
| 404 | the asset is unknown, or this deployment keeps no candle history |

## GET `/markets/:id/ticks/:sequence`

The published tick at a sequence, from the record.

| Path parameter | Must be |
| --- | --- |
| `id` | a hosted asset id |
| `sequence` | a positive integer written as digits |

Response: a JSON object:

| Key | Type |
| --- | --- |
| `assetId` | `string` |
| `sequence` | `integer` |
| `instant` | `integer` |
| `price` | `integer` |
| `displayPrice` | `string` |

| Status | When |
| --- | --- |
| 400 | the sequence is not a positive integer |
| 404 | the asset is unknown, the sequence is outside the record (the bounds are named), or this deployment keeps no record |

## GET `/markets/:id/price`

The price in force at an instant: the last published tick at or before it, the rule settlement uses.

| Path parameter | Must be |
| --- | --- |
| `id` | a hosted asset id |

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
| `displayPrice` | `string` |

| Status | When |
| --- | --- |
| 400 | a missing or malformed instant, or an instant after the newest published one |
| 404 | the asset is unknown, the record starts after the instant, or this deployment keeps no record |

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
| 409 | the sequence is published but its window is not yet committed (the newest committed sequence is named), or the archive disagrees with the record |

## GET `/markets/:id/stream`

Server-sent events: every tick of one market in order, resumable by sequence; a gap is told, never skipped.

| Path parameter | Must be |
| --- | --- |
| `id` | a hosted asset id |

| Query parameter | Must be |
| --- | --- |
| `from?` | the next sequence wanted; omitted joins at the live edge |
| `onGap?` | 'live' to be told a gap and joined at the oldest retained sequence, instead of a 400 |

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

| Status | When |
| --- | --- |
| 400 | a malformed from or onGap, or (without onGap=live) a sequence the venue cannot replay |
| 404 | the asset is not hosted |

## GET `/markets/stream`

Server-sent events: several markets on one connection, each frame naming its asset.

| Query parameter | Must be |
| --- | --- |
| `assets` | comma-separated hosted asset ids |
| `from?` | per-asset next sequences, in the order of assets |
| `onGap?` | 'live', as for one market |

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

| Status | When |
| --- | --- |
| 400 | a malformed parameter, or an asset that is not hosted |

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

## POST `/assets`

Register an asset from a brief; answers the job that builds it.

Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.

## PATCH `/assets/:id`

Rename an asset.

Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.

## POST `/assets/:id/retire`

Stop hosting a market; its record stays readable.

Admin: needs the bearer token in `OTC_ADMIN_TOKEN` and a JSON body.
