// Genera los iconos PNG a partir de www/icons/icon.svg usando Playwright (Chromium).
// Uso: node tools/gen-icons.js
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
}

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'www/icons/icon.svg'), 'utf8');
const out = (f) => path.join(root, 'www/icons', f);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (size, file, pad = 0) => {
    await page.setViewportSize({ width: size, height: size });
    const inner = size - pad * 2;
    await page.setContent(`<html><body style="margin:0;background:#1a0f45">
      <div style="padding:${pad}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
    await page.screenshot({ path: out(file), omitBackground: false });
  };
  await render(192, 'icon-192.png');
  await render(512, 'icon-512.png');
  await render(512, 'icon-maskable-512.png', 60);
  await render(1024, 'icon-1024.png');
  // Recursos para @capacitor/assets (icono adaptativo y splash de Android)
  const assets = path.join(root, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(out('icon-1024.png'), path.join(assets, 'icon-only.png'));
  await render(1024, '../../assets/icon-foreground.png', 200);
  await render(1024, '../../assets/icon-background.png', 1024);
  await page.setViewportSize({ width: 2732, height: 2732 });
  await page.setContent(`<html><body style="margin:0;background:#0b0820;display:flex;align-items:center;justify-content:center;height:2732px">
    <div style="width:700px;height:700px;border-radius:160px;overflow:hidden">${svg.replace('<svg ', '<svg width="700" height="700" ')}</div></body></html>`);
  await page.screenshot({ path: path.join(assets, 'splash.png') });
  fs.copyFileSync(path.join(assets, 'splash.png'), path.join(assets, 'splash-dark.png'));
  await browser.close();
  console.log('Iconos generados en www/icons/');
})();
