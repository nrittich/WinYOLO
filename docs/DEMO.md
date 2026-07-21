# Three-minute WinYOLO 0.3 demo

1. Run `bun run demo:reset`, then `bun run demo:verify`. Show the deterministic failing `Calculator.Add` test.
2. Run `winyolo isolated "Fix the failing Calculator test. Run dotnet test and make the smallest correct change." --cwd .\demo\BrokenBuild`.
3. Open the printed companion URL. Show the Isolated indicator, streamed native output, checkpoint identifier, and diff hash.
4. For the failed-attempt beat, run an isolated task asking for an intentionally wrong multiplication fix, then select Rollback. Show the exported patch and unchanged source.
5. Run the correct repair, select Accept patch, then run `bun run demo:verify`. Show `BROKEN_BUILD_TESTS_PASS`.
6. Open Audit receipts and show schema 2, restricted process identity, bounded output, exit status, and final Git diff hash.
7. Close with: “The terminal remains official Codex. WinYOLO adds Windows-native boundaries, browser continuity, and recoverable isolation.”

Do not run the optional comparison benchmark during the core demo.
