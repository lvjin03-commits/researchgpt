# Grant platform technical spikes

These scripts test the four preconditions in
`docs/grants/IMPLEMENTATION-PLAN.md`. They are isolated from production code:
they do not import `lib/grants`, call a model, access Supabase, create routes,
or mutate user data.

Run with Python 3.11+ plus `python-docx` and Pillow:

```powershell
python scripts/grant-spikes/run_spikes.py
```

Use `--output-dir` to keep the generated DOCX and JSON reports somewhere other
than the operating-system temp directory. Generated artifacts are intentionally
not committed; fixed fixture construction and assertions live in the script.

The DOCX spike still requires an external Word-compatible renderer for visual
QA. Structural success alone does not prove layout fidelity.
