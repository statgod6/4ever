const QRCode = require('qrcode')
const url = 'exp://192.168.31.212:8081'
QRCode.toFile('expo-qr.png', url, {
  width: 600,
  margin: 2,
  color: { dark: '#000000', light: '#FFFFFF' },
}, (err) => {
  if (err) { console.error(err); process.exit(1) }
  console.log('QR written to expo-qr.png for', url)
})
