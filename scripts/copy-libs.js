// Copies the PDF libraries into the renderer so the app works fully offline.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dest = path.join(root, 'src', 'renderer', 'lib');
fs.mkdirSync(dest, { recursive: true });
const files = [
  ['node_modules/pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'],
  ['node_modules/pdfjs-dist/web/pdf_viewer.css', 'pdf_viewer.css'],
  ['node_modules/pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
];
for (const [from, to] of files) {
  fs.copyFileSync(path.join(root, from), path.join(dest, to));
  console.log('copied', to);
}
for (const dir of ['cmaps', 'standard_fonts']) {
  fs.cpSync(path.join(root, 'node_modules/pdfjs-dist', dir), path.join(dest, dir), { recursive: true });
  console.log('copied folder', dir);
}
