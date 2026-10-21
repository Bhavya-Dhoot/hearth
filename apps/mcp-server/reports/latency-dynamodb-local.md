<!-- Run against DynamoDB Local (amazon/dynamodb-local:2.6.1, in-memory) with the CDK table shape (PK/SK + GSI1), HEARTH_DDB_TABLE=hearth-home-graph, 2026-10-21. -->
# Hearth latency report

Run at 2026-10-21T05:55:48.760Z against http://localhost:4420. 50 timed calls per tool after 3 warm-up calls, full client round trip, times in milliseconds.

Budget: p95 under 500 ms (hard), p50 under 120 ms (target). Worst p95 in this run: 198.6 ms.

| Tool | Runs | p50 | p95 | max | Server p50 | Errors | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `get_home_profile` | 50 | 19 | 23.8 | 168.3 | 15 | 0 | PASS |
| `add_asset` | 50 | 43.3 | 59.5 | 66.9 | 39.6 | 0 | PASS |
| `triage_issue` | 50 | 15.3 | 19.4 | 20.4 | 11.6 | 0 | PASS |
| `get_repair_steps` | 50 | 26.4 | 110.9 | 143.7 | 19.1 | 0 | PASS |
| `find_exact_part` | 50 | 50.6 | 113.7 | 181.2 | 32 | 0 | PASS |
| `create_checkout_session` | 50 | 52.6 | 119.6 | 141.4 | 43.5 | 0 | PASS |
| `complete_checkout` | 50 | 120.2 | 198.6 | 237.1 | 112.7 | 0 | PASS |
| `prepare_pro_brief` | 50 | 88.6 | 133.4 | 152.1 | 83.3 | 0 | PASS |
| `get_weekend_plan` | 50 | 27.3 | 36 | 44.6 | 22.4 | 0 | PASS |
| `log_completion` | 50 | 50.1 | 64.6 | 93.6 | 45.1 | 0 | PASS |
| `get_history` | 50 | 35.8 | 47.3 | 53.3 | 29.8 | 0 | PASS |
| `check_recalls` | 50 | 20.4 | 25.5 | 33.5 | 15.1 | 0 | PASS |

`complete_checkout` is measured in create and complete pairs, so it has the same run count as `create_checkout_session`.
