## Summary

-
-

## Manual QA

> Complete for PRs targeting `main`. Mark N/A with reason for PRs targeting `develop`.

- [ ] Add-on menu appears after opening a Sheet
- [ ] Sidebar opens without errors
- [ ] Import Drive Links — imports files from a folder
- [ ] Extract Text — extracts text from a Doc/PDF/image
- [ ] Sample Rows — samples rows reproducibly with a seed
- [ ] Run AI — batch inference completes and writes output column
- [ ] Tested on a Sheet the tester does not own (shared access)

## Security

> Check any that apply to this PR. If any box is checked, review `docs/threat_models/ssi-toolkit-threat-model.md` and update it if the change introduces, removes, or materially changes a threat or data flow.

- [ ] Adds or changes a data flow (new API call, new Drive/Sheets/Docs operation, new RPC endpoint)
- [ ] Modifies how AI output is written to the spreadsheet (affects T6 — formula injection)
- [ ] Changes `appsscript.json` OAuth scopes (affects T4 variant — scope expansion, T5)
- [ ] Adds or upgrades an npm dependency (affects T10 — build dependency compromise)
- [ ] Changes Gemini API integration (affects T2, T3, T11, T14)
- [ ] None of the above — no threat model update needed

## Notes

<!-- Anything reviewers or QA testers should know -->
