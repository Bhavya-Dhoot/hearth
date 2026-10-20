# Hearth latency report

Run at 2026-10-20T21:09:09.539Z against http://localhost:4420. 50 timed calls per tool after 3 warm-up calls, full client round trip, times in milliseconds.

Budget: p95 under 500 ms (hard), p50 under 120 ms (target). Worst p95 in this run: 53.2 ms.

| Tool | Runs | p50 | p95 | max | Server p50 | Errors | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `get_home_profile` | 50 | 7.3 | 8.8 | 9.4 | 0.9 | 0 | PASS |
| `add_asset` | 50 | 15.5 | 19.6 | 20.5 | 9.6 | 0 | PASS |
| `triage_issue` | 50 | 7.6 | 9.1 | 10.1 | 1.5 | 0 | PASS |
| `get_repair_steps` | 50 | 6.5 | 7.8 | 11.6 | 0.8 | 0 | PASS |
| `find_exact_part` | 50 | 6.9 | 8.3 | 8.8 | 1 | 0 | PASS |
| `create_checkout_session` | 50 | 16.9 | 20.8 | 22.9 | 11.9 | 0 | PASS |
| `complete_checkout` | 50 | 41.1 | 52.7 | 62.4 | 35.2 | 0 | PASS |
| `prepare_pro_brief` | 50 | 42.7 | 53.2 | 73.6 | 38.1 | 0 | PASS |
| `get_weekend_plan` | 50 | 5.4 | 6.8 | 7.3 | 1 | 0 | PASS |
| `log_completion` | 50 | 25.2 | 30.3 | 73.3 | 20.2 | 0 | PASS |
| `get_history` | 50 | 7.6 | 9.9 | 12.6 | 2.1 | 0 | PASS |
| `check_recalls` | 50 | 5.2 | 7.8 | 8.8 | 0.5 | 0 | PASS |

`complete_checkout` is measured in create and complete pairs, so it has the same run count as `create_checkout_session`.
