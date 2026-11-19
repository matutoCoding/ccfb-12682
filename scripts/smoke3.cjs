// 验证: 编排片段驱动的水柱 + 灯光染色在预演中正确出现
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/share-test.html');
  await new Promise(r => setTimeout(r, 1500));
  // 拖到 0.6s (水型+灯光片段都在作用区间)
  await page.evaluate(() => {
    // 直接操作音频引擎不可行(模块作用域), 用停止+播放代替: 先停再播放到指定位置
    // 简单做法: 等自动播放自然走到 0.6s 附近
  });
  // 重新从头播, 在 0.6s 截图
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('停止')).click());
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('播放')).click());
  await new Promise(r => setTimeout(r, 650));
  await page.screenshot({ path: 'shot-10-choreo.png' });
  const t = await page.evaluate(() => [...document.querySelectorAll('.toolbar span')].map(s => s.textContent).find(x => /\d\d:\d\d/.test(x)));
  console.log('time at screenshot:', t);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
