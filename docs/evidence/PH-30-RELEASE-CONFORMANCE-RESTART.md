# Conformance — PASS

Venue: `http://127.0.0.1:7420` (contract 1.1.0; this client 1.1.0)
Assets hosted: 30

| Check                                                               | Result | Detail                                                                                                                             |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| health answers                                                      | pass   | status ok                                                                                                                          |
| contract version                                                    | pass   | venue 1.1.0, this client 1.1.0                                                                                                     |
| contract digest                                                     | pass   | venue 1f9fc7c84b19c58c, this client 1f9fc7c84b19c58c                                                                               |
| ready                                                               | pass   | GET /health/ready answered 200: {"ready":true}                                                                                     |
| metrics                                                             | pass   | GET /metrics answered 200 with 40 samples                                                                                          |
| a market is hosted                                                  | pass   | 30 hosted                                                                                                                          |
| GET /health                                                         | pass   | keys and types as contracted                                                                                                       |
| GET /health/live                                                    | pass   | keys and types as contracted                                                                                                       |
| GET /health/ready                                                   | pass   | keys and types as contracted                                                                                                       |
| GET /contract                                                       | pass   | keys and types as contracted                                                                                                       |
| GET /markets                                                        | pass   | keys and types as contracted                                                                                                       |
| GET /markets/:id                                                    | pass   | keys and types as contracted                                                                                                       |
| GET /catalogue                                                      | pass   | keys and types as contracted                                                                                                       |
| GET /archetypes                                                     | pass   | keys and types as contracted                                                                                                       |
| GET /markets/:id/history                                            | pass   | keys and types as contracted                                                                                                       |
| GET /markets/:id/ticks/:sequence                                    | pass   | keys and types as contracted                                                                                                       |
| GET /markets/:id/price                                              | pass   | keys and types as contracted                                                                                                       |
| GET /markets/:id/proof/:sequence                                    | pass   | keys and types as contracted                                                                                                       |
| GET /registrations                                                  | pass   | keys and types as contracted                                                                                                       |
| GET /registrations/:id                                              | pass   | refused 404, a refusal the contract lists: {"message":"Unknown registration job eurusd-otc.","error":"Not Found","statusCode":404} |
| stream delivers contiguous, non-decreasing ticks                    | pass   | 200 ticks read (status 200)                                                                                                        |
| stream resumes exactly from M+1                                     | pass   | asked 103752, got 103752, 0 gaps                                                                                                   |
| stream refuses a sequence never published                           | pass   | status 400                                                                                                                         |
| a gap, when told, names where the record resumes                    | pass   | gap resumesAt 103552, first tick 103552                                                                                            |
| price at an instant is the last tick at or before it                | pass   | 101 instants agree                                                                                                                 |
| price refuses an instant after the newest published                 | pass   | status 400                                                                                                                         |
| proof verifies against the publisher key and agrees with the stream | pass   | signature true, inclusion true, agrees with the stream true                                                                        |
