# Dusty PDF → DXF Extractor

Internal proof-of-concept tool. Extracts vector geometry from construction PDFs and outputs a DXF file for VDC cleanup.

## Files
- `index.html` — main tool UI + app logic
- `extractor.js` — PDF geometry extraction engine + DXF writer

## Password
`dusty2026`

## How to deploy on GitHub Pages
1. Create a **public** GitHub repo
2. Add both files via the web editor
3. Go to Settings → Pages → Source: main branch / root
4. Your URL: `https://yourusername.github.io/repo-name`

## Notes
- Works on vector PDFs (AutoCAD, Revit, Bluebeam exports)
- Scanned/photographed drawings will not extract
- Output is DXF — must be opened in AutoCAD and saved as DWG before uploading to Dusty Portal
- Scale must be entered manually — tool does not auto-detect scale

## Limitations (PoC)
- No layer separation (all geometry on DUSTY-GEOMETRY layer)
- Bezier curves approximated as line segments
- Fit-to-page PDFs will produce incorrect scale output
