async function test() {
  global.DOMMatrix = require('dommatrix');
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  console.log("pdfjs:", typeof pdfjs.getDocument);
}
test().catch(console.error);
