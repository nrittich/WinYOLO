# WinYOLO 0.3 submission

Category: Developer Tools.

WinYOLO preserves the official Codex terminal and conversation store while adding Windows-native Safe/YOLO policies, a loopback browser companion, structured Windows developer tools, schema-2 receipts, and restricted-account Git-backed isolation with Accept/Rollback.

Claims are bounded:

- Safe is workspace-write/on-request with command networking denied.
- YOLO is approval-free but retains the workspace, network, and secret boundaries.
- Isolated uses `WinYOLORunner`, `CreateProcessWithLogonW`, a kill-on-close Job Object, sanitized environment, dedicated file-backed runner authentication, and a self-contained disposable Git clone.
- Production and smoke paths contain no Linux compatibility transport; the optional comparison command is explicitly confirmed and quarantined.
- Codex remains transcript authority; WinYOLO does not parse private transcript JSONL.

Verified release evidence on Windows: `bun run check` completed with 66 tests and zero failures; plugin validation, `SOURCE_SCAN_OK`, `WINYOLO_WINDOWS_SMOKE_OK`, and doctor capability readiness passed.

Accepted isolation proof: run `8d6c8af1-d36d-419f-93c1-204d4423a3e7` completed with exit code 0. Checkpoint `cp-8d6c8af1-d36d-419f-93c1-204d4423a3e7` created only `isolated-proof.txt` containing `OK`, was accepted, and recorded diff hash `29481c089cdba26c5fc66bc4eb5f67fc183dbc334ec085a7574a392b7f2b8aad`.

Accepted BrokenBuild demo: the initial test failed with Expected 5 / Actual -1; isolated run `b5642ba1-db72-49d9-b617-966a33cc9951` made the deliberately wrong multiplication repair and was rolled back. Correct run `cb89623d-ccd0-411f-a6f2-8c835f62f4b8` produced a reviewed one-file repair, checkpoint `cp-cb89623d-ccd0-411f-a6f2-8c835f62f4b8` was accepted with diff hash `4914321258ec634c95f98719386d93721eb99f02098173690b4c74f481e6aafa`, and final verification printed `BROKEN_BUILD_TESTS_PASS`.

Do not claim Interceptor Chrome acceptance; the required Interceptor CLI was unavailable on the verification machine.
