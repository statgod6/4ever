const fs = require('fs')
const path = require('path')
const QRCode = require('./mobile/node_modules/qrcode-terminal/vendor/QRCode')
const QRErrorCorrectLevel = require(
  './mobile/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel',
)

const url = process.argv[2]
const outputPath = process.argv[3] || path.join(__dirname, 'expo-qr.svg')

if (!url || !url.startsWith('exp://')) {
  console.error('Usage: node gen-qr.js exp://<host>:<port> [output.svg]')
  process.exit(1)
}

const qr = new QRCode(-1, QRErrorCorrectLevel.M)
qr.addData(url)
qr.make()

const quietZone = 4
const moduleSize = 16
const moduleCount = qr.getModuleCount()
const size = (moduleCount + quietZone * 2) * moduleSize
const rectangles = []

for (let row = 0; row < moduleCount; row += 1) {
  for (let column = 0; column < moduleCount; column += 1) {
    if (qr.isDark(row, column)) {
      rectangles.push(
        `<rect x="${(column + quietZone) * moduleSize}" y="${(row + quietZone) * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`,
      )
    }
  }
}

const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Expo Go QR code">`,
  '<rect width="100%" height="100%" fill="#fff"/>',
  '<g fill="#000">',
  ...rectangles,
  '</g>',
  '</svg>',
  '',
].join('\n')

fs.writeFileSync(outputPath, svg, 'utf8')
console.log(`QR written to ${outputPath} for ${url}`)
