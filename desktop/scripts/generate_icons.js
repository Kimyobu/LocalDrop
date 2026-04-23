const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '../../localdrop_app_icon.svg');
const desktopResources = path.join(__dirname, '../resources');
const mobileAssets = path.join(__dirname, '../../../mobile/assets');

async function generate() {
  console.log('Generating icons...');

  // Ensure directories exist
  if (!fs.existsSync(desktopResources)) fs.mkdirSync(desktopResources, { recursive: true });
  if (!fs.existsSync(mobileAssets)) fs.mkdirSync(mobileAssets, { recursive: true });

  // Desktop Icons
  await sharp(svgPath)
    .resize(512, 512)
    .png()
    .toFile(path.join(desktopResources, 'icon.png'));
  console.log('Generated desktop/resources/icon.png');

  // Mobile Icons
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(mobileAssets, 'icon.png'));
  console.log('Generated mobile/assets/icon.png');

  // Adaptive Icon needs padding (logo should be in safe zone ~66%)
  await sharp(svgPath)
    .resize(600, 600) // Resize logo to fit safe zone
    .extend({
      top: 212,
      bottom: 212,
      left: 212,
      right: 212,
      background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background for foreground image
    })
    .png()
    .toFile(path.join(mobileAssets, 'adaptive-icon.png'));
  console.log('Generated mobile/assets/adaptive-icon.png (with padding)');

  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(mobileAssets, 'splash-icon.png'));
  console.log('Generated mobile/assets/splash-icon.png');

  await sharp(svgPath)
    .resize(48, 48)
    .png()
    .toFile(path.join(mobileAssets, 'favicon.png'));
  console.log('Generated mobile/assets/favicon.png');

  console.log('Icon generation complete!');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
