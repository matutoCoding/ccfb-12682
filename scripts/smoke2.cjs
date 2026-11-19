// 冒烟测试 2: 音频导入 / 时间线编排 / 播放同步 / 分享文件端到端
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const BASE = 'http://localhost:5200';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 生成 4 秒测试 WAV (220Hz 正弦, 每秒一个强拍)
function makeWav() {
  const sr = 44100, dur = 4, n = sr * dur;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = (t % 1) < 0.08 ? 1 : 0.25;
    data[i] = Math.round(Math.sin(2 * Math.PI * 220 * t) * 0.8 * beat * 32767);
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  Buffer.from(data.buffer).copy(buf, 44);
  fs.writeFileSync('test-audio.wav', buf);
}

(async () => {
  makeWav();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('dialog', d => d.accept(d.defaultValue()));

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  // 新建工程
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('新建工程')).click());
  await new Promise(r => setTimeout(r, 500));

  // 放 3 个直喷
  for (const [x, y] of [[500, 350], [580, 350], [660, 350]]) {
    await page.evaluate(() => [...document.querySelectorAll('.nozzle-palette button')].find(b => b.textContent === '直喷').click());
    await page.mouse.click(x, y);
  }

  // 时间线: 导入音频
  await page.evaluate(() => { location.hash = '#/timeline'; });
  await new Promise(r => setTimeout(r, 500));
  const input = await page.$('input[type=file]');
  await input.uploadFile('test-audio.wav');
  await new Promise(r => setTimeout(r, 1500));
  const audioInfo = await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('fountain.projects.index'));
    const p = JSON.parse(localStorage.getItem('fountain.project.' + idx[0].id));
    return { audioName: p.audioName, duration: p.duration };
  });
  console.log('audio imported:', JSON.stringify(audioInfo));

  // 加水型轨 + 灯光轨 (prompt 自动默认)
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('水型轨')).click());
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('灯光轨')).click());
  await new Promise(r => setTimeout(r, 300));

  // 在水型轨上拖一个片段 (轨道区 y ≈ 24+20+74+23=141)
  const box = await (await page.$('.timeline-wrap canvas')).boundingBox();
  const y1 = box.y + 141, y2 = box.y + 141 + 46;
  await page.mouse.move(box.x + 260, y1);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, y1, { steps: 8 });
  await page.mouse.up();
  // 灯光轨片段
  await page.mouse.move(box.x + 300, y2);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, y2, { steps: 8 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 700));
  const choreo = await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('fountain.projects.index'));
    const p = JSON.parse(localStorage.getItem('fountain.project.' + idx[0].id));
    return { tracks: p.tracks.length, clips: p.clips.length, beats: p.beats.length };
  });
  console.log('choreo:', JSON.stringify(choreo));
  await page.screenshot({ path: 'shot-7-timeline-clips.png' });

  // 预演: 播放, 验证时间推进 + 帧率
  await page.evaluate(() => { location.hash = '#/preview'; });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('播放')).click());
  await new Promise(r => setTimeout(r, 500));
  const t1 = await page.evaluate(() => document.querySelector('.toolbar .toolbar, .toolbar') && document.querySelectorAll('.toolbar span')[0]?.textContent);
  await new Promise(r => setTimeout(r, 1200));
  const timeTxt = await page.evaluate(() => [...document.querySelectorAll('.toolbar span')].map(s => s.textContent).find(t => /\d\d:\d\d/.test(t)));
  console.log('playhead after 1.2s:', timeTxt);
  await page.screenshot({ path: 'shot-8-preview-playing.png' });

  // 导出分享文件: 直接抓 download 的 blob 内容
  const shareHtml = await page.evaluate(async () => {
    const idx = JSON.parse(localStorage.getItem('fountain.projects.index'));
    const p = JSON.parse(localStorage.getItem('fountain.project.' + idx[0].id));
    // 模拟 exportShareFile 的产物
    const audioBuf = await new Promise(res => {
      const req = indexedDB.open('fountain-audio', 1);
      req.onsuccess = () => {
        const g = req.result.transaction('audio').objectStore('audio').get(p.id);
        g.onsuccess = () => res(g.result);
      };
    });
    let b64 = '';
    if (audioBuf) {
      const bytes = new Uint8Array(audioBuf);
      for (let i = 0; i < bytes.length; i += 32768) b64 += String.fromCharCode(...bytes.subarray(i, i + 32768));
      b64 = btoa(b64);
    }
    let html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    const json = JSON.stringify({ project: p, audioBase64: b64 }).replace(/<\//g, '<\\/');
    const tag = `<script id="fountain-share-data" type="application/json">${json}</` + `script>`;
    html = html.replace('<!--fountain-share-slot-->', '<!--fountain-share-slot-->' + tag);
    return html;
  });
  fs.writeFileSync(require('path').join(__dirname, 'share-test.html'), shareHtml);
  console.log('share file size:', (shareHtml.length / 1024).toFixed(0), 'KB');

  // 用 file:// 打开分享文件
  const page2 = await browser.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(e.message.slice(0, 300)));
  page2.on('console', m => { if (m.type() === 'error') errors2.push('console: ' + m.text().slice(0, 200)); });
  await page2.goto('file:///' + __dirname.replace(/\\/g, '/') + '/share-test.html');
  await new Promise(r => setTimeout(r, 2000));
  // 验证真的在运行(而不是静态快照): hash 被路由改写, fps 文本会变化
  const fps1 = await page2.evaluate(() => document.querySelector('.fps-badge')?.textContent);
  await new Promise(r => setTimeout(r, 1500));
  const shareState = await page2.evaluate(() => ({
    hash: location.hash,
    fps: document.querySelector('.fps-badge')?.textContent,
    time: [...document.querySelectorAll('.toolbar span')].map(s => s.textContent).find(t => /\d\d:\d\d/.test(t)),
  }));
  shareState.fpsChanged = fps1 !== shareState.fps;
  console.log('share file state:', JSON.stringify(shareState));
  await page2.screenshot({ path: 'shot-9-share.png' });

  console.log('PAGE1 ERRORS:', errors.length ? errors : 'none');
  console.log('SHARE ERRORS:', errors2.length ? errors2 : 'none');
  await browser.close();
})().catch(e => { console.error('SMOKE2 FAIL:', e); process.exit(1); });
