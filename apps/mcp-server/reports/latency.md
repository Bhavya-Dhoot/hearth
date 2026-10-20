# Hearth latency report

Run at 2026-10-20T21:01:20.042Z against http://localhost:4255. 50 timed calls per tool after 3 warm-up calls, full client round trip, times in milliseconds.

Budget: p95 under 500 ms (hard), p50 under 120 ms (target). Worst p95 in this run: 143.7 ms.

| Tool | Runs | p50 | p95 | max | Server p50 | Errors | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `get_home_profile` | 50 | 5.2 | 7.2 | 9.1 | 0.6 | 0 | PASS |
| `add_asset` | 50 | 11.6 | 16.7 | 19.9 | 7.5 | 0 | PASS |
| `triage_issue` | 50 | 4.2 | 6.2 | 6.5 | 0.8 | 0 | PASS |
| `get_repair_steps` | 50 | 3.8 | 5.2 | 7.9 | 0.4 | 0 | PASS |
| `find_exact_part` | 50 | 4.1 | 5.2 | 5.3 | 0.6 | 0 | PASS |
| `create_checkout_session` | 50 | 17.2 | 44.1 | 136.9 | 12.6 | 0 | PASS |
| `complete_checkout` | 50 | 49.9 | 143.7 | 214.5 | 45 | 0 | PASS |
| `prepare_pro_brief` | 50 | 45.8 | 113.6 | 170.5 | 40.3 | 0 | PASS |
| `get_weekend_plan` | 50 | 4.2 | 6 | 6.6 | 0.8 | 0 | PASS |
| `log_completion` | 50 | 21.9 | 35.6 | 43.4 | 17.9 | 0 | PASS |
| `get_history` | 50 | 4.4 | 6.3 | 7.6 | 1.2 | 0 | PASS |
| `check_recalls` | 50 | 3 | 4.3 | 5.2 | 0.3 | 0 | PASS |

`complete_checkout` is measured in create and complete pairs, so it has the same run count as `create_checkout_session`.
