SheetJS (XLSX) client export

What I added
- A client-side XLSX export using SheetJS (XLSX) loaded from CDN.
- `exportVehicleTable()` prefers SheetJS when available and will create a real `.xlsx` file.

How it works
- The page now includes the SheetJS bundle before `ui.js` in `index.html`:
  <script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>
- When user clicks Export xls, code will:
  - collect visible rows (applies filters/sorting)
  - build a 2D array (header + rows)
  - use `XLSX.utils.aoa_to_sheet` and `XLSX.write` to build a Blob and trigger download
- If SheetJS is not available or fails, a fallback HTML-based `.xls` export is used.

Bundling / distribution notes
- For production and to avoid relying on CDN, you can install SheetJS locally and bundle with your preferred bundler (webpack, rollup, parcel).
- Minimal steps using npm + webpack:
  1. npm init -y
  2. npm install xlsx
  3. import XLSX from 'xlsx'; in your entry script (e.g., ui.js) or use require
  4. configure webpack to output a bundle that includes your scripts and serve that bundle from index.html instead of individual script tags.

If you want, I can create a minimal `package.json` + `webpack.config.js` and adjust `ui.js` to import `xlsx` instead of relying on CDN.