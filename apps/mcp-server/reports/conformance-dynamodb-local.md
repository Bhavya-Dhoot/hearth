<!-- Run against DynamoDB Local (amazon/dynamodb-local:2.6.1, in-memory) with the CDK table shape (PK/SK + GSI1), HEARTH_DDB_TABLE=hearth-home-graph, 2026-10-21. -->
# Hearth conformance report

Run at 2026-10-21T05:55:11.305Z against http://localhost:4420 (auth http://localhost:4410), protocol 2025-11-25.

Result: 33 passed, 0 failed.

| Group | Check | Result | ms | Detail |
| --- | --- | --- | ---: | --- |
| discovery | protected resource metadata (RFC 9728) has the documented shape | PASS | 117 | resource http://localhost:4420/mcp |
| discovery | authorization server metadata (RFC 8414) validates | PASS | 8 | issuer http://localhost:4410 |
| auth | unauthenticated POST /mcp returns 401 JSON with no WWW-Authenticate | PASS | 7 | body matches Appendix B |
| auth | a garbage bearer token gets the same 401 | PASS | 7 |  |
| auth | account linking (PKCE) issues a token for the MCP resource | PASS | 119 | sub usr_okafor, expires in 3600s |
| protocol | initialize returns protocolVersion 2025-11-25, serverInfo, capabilities and Mcp-Session-Id | PASS | 5 | hearth 0.1.0, session b8624eb8 |
| protocol | DELETE /mcp ends the session | PASS | 7 | session gone after DELETE |
| protocol | the SDK client connects over Streamable HTTP | PASS | 22 | server hearth |
| protocol | tools/list returns the 12 tools with title, description, schemas and annotations | PASS | 114 | get_home_profile, add_asset, triage_issue, get_repair_steps, find_exact_part, create_checkout_session, complete_checkout, prepare_pro_brief, get_weekend_plan, log_completion, get_history, check_recalls |
| resources | resources/list exposes at least 8 ui://hearth/ widgets with the MCP Apps mime type | PASS | 9 | 8 widgets |
| resources | resources/read returns HTML for every widget | PASS | 102 | 8 read |
| tools | get_home_profile | PASS | 43 | I remember 12 things in your home. Your main water shut-off is in the garage, left of the panel. |
| tools | add_asset creates then updates a probe asset idempotently | PASS | 131 | asset_conformance_probe_garage (first call created: true) |
| tools | triage_issue asks at most two questions, then resolves a playbook | PASS | 51 | leak-under-sink-ptrap at confidence 0.86 |
| tools | triage_issue hard-stops on a gas smell and gives a verbatim message | PASS | 21 | gas |
| tools | get_repair_steps walks every step of the resolved playbook | PASS | 116 | 6 steps, part role ptrap_washer |
| tools | get_repair_steps past the end is a voice-safe isError | PASS | 25 |  |
| tools | find_exact_part returns 3 to 5 ranked, fit-reasoned items | PASS | 24 | 5 items, first EXACT FIT |
| tools | find_exact_part with an unknown role is a voice-safe isError (not_found) | PASS | 21 |  |
| checkout | create_checkout_session never charges and returns the commitment text | PASS | 43 | You're ordering 1× 1-1/2 inch Slip-Joint Washer, Tapered, 2-Pack for $4.64, arriving Thursday. Paid with Visa •••• 4242. |
| checkout | complete_checkout without a confirmation is isError not_confirmed | PASS | 6 |  |
| checkout | complete_checkout returns a rich confirmation, and a replay returns the same order | PASS | 88 | HRT-903138, simulated, email written_to_outbox |
| checkout | the receipt page renders | PASS | 22 | http://localhost:4420/receipts/ord_15bcbce9b5f8 |
| checkout | the confirmation email is delivered or written to the outbox | PASS | 10 | written to /outbox |
| tools | prepare_pro_brief builds a brief with a public share page | PASS | 97 | I've put together a job brief for your kitchen sink P-trap. Want me to find a plumber? |
| tools | get_weekend_plan returns at most 6 ranked tasks | PASS | 29 | Oct 24-25, 6 tasks |
| tools | log_completion records the job and is idempotent | PASS | 85 | Logged. Conformance run: replaced the P-trap washer. I've set a reminder for October 28: check under the kitch |
| tools | get_history filters by keyword | PASS | 27 | 3 events match "disposal" |
| tools | check_recalls discloses that the dataset is a sample | PASS | 20 | 1 flagged |
| auth | a token without orders:write cannot start a checkout (forbidden_scope) | PASS | 129 |  |
| rest | POST /checkout-sessions creates a UCP-shaped session | PASS | 55 | You're ordering 1× 1-1/2 inch Slip-Joint Washer, Tapered, 2-Pack for $4.64, arriving Thursday. Paid with Visa •••• 4242. |
| rest | GET /checkout-sessions/:id returns the session | PASS | 16 |  |
| rest | POST /checkout-sessions/:id/complete requires confirmation, then completes | PASS | 88 | HRT-804087 |
