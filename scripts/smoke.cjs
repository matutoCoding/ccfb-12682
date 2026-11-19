// 冒烟测试: 驱动真实 Chrome 跑一遍核心流程
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:5200';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 自动应答 prompt/confirm
  page.on('dialog', async d => {
    if (d.type() === 'prompt') await d.accept(d.defaultValue());
    else await d.accept();
  });

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'shot-1-projects.png' });

  // 新建工程(对话框自动接受默认名)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find(b => b.textContent.includes('新建工程')).click();
  });
  await new Promise(r => setTimeout(r, 600));
  console.log('hash after create:', await page.evaluate(() => location.hash));
  await page.screenshot({ path: 'shot-2-layout.png' });

  // 在布局页放置几个喷头: 点"直喷"再点画布
  const place = async (typeName, x, y) => {
    await page.evaluate(n => {
      [...document.querySelectorAll('.nozzle-palette button')]
        .find(b => b.textContent === n).click();
    }, typeName);
    await page.mouse.click(x, y);
  };
  await place('直喷', 500, 350);
  await place('直喷', 560, 350);
  await place('摇摆', 620, 350);
  await place('跑泉', 680, 350);
  await place('水幕', 740, 350);
  await place('水泵', 600, 500);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'shot-3-layout-placed.png' });
  const counts = await page.evaluate(() => {
    const raw = localStorage.getItem('fountain.projects.index');
    return raw;
  });
  console.log('project index:', counts);

  // 曲目编排页
  await page.evaluate(() => { location.hash = '#/timeline'; });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'shot-4-timeline.png' });

  // 预演页
  await page.evaluate(() => { location.hash = '#/preview'; });
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: 'shot-5-preview.png' });
  const fps = await page.evaluate(() => document.querySelector('.fps-badge')?.textContent);
  console.log('fps badge:', fps);
  const webglOk = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  });
  console.log('webgl2 available:', webglOk);

  // 设备表页
  await page.evaluate(() => { location.hash = '#/equipment'; });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'shot-6-equipment.png' });

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
