const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', 'web-ifc');
const dstDir = path.join(__dirname, '..', 'public');

['web-ifc.wasm', 'web-ifc-mt.wasm'].forEach(file => {
  const src = path.join(srcDir, file);
  const dst = path.join(dstDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`[web-ifc] Copied ${file} → public/`);
  } else {
    console.warn(`[web-ifc] ${file} not found – skipping`);
  }
});
