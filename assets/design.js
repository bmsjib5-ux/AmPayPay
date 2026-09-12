/* Native-style presentation over AmPayPay's existing storage and receipt flows. */
(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const money = value => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
    camera: '<path d="m8 5-2 3H3v12h18V8h-3l-2-3z"/><circle cx="12" cy="13" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    food: '<path d="M5 3v7m3-7v7m3-7v7M5 7h6m-3 3v11M19 3c-4 3-4 9 0 9v9m0-18v9"/>',
    car: '<path d="m4 10 2-6h12l2 6M3 10h18v9H3zM6 19v2m12-2v2M6 14h2m8 0h2"/>',
    bag: '<path d="M4 7h16l1 14H3zM8 7V5a4 4 0 0 1 8 0v2"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3zM10 21h4"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>'
  };
  const icon = name => '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (icons[name] || icons.more) + '</svg>';
  const categoryIcon = category => /food/.test(category) ? 'food' : /transport/.test(category) ? 'car' : /shop|grocer/.test(category) ? 'bag' : 'more';
  function tab(name) { return $('.tab[data-tab="' + name + '"]'); }
  function navigate(name) { tab(name).click(); }
  function htmlElement(tag, className, markup) {
    const element = document.createElement(tag); element.className = className; element.innerHTML = markup; return element;
  }

  document.body.classList.add('native-design');
  const navigation = $('.tabs');
  ['summary', 'list', 'add', 'debt', 'me', 'friends'].forEach(name => navigation.append(tab(name)));
  tab('friends').hidden = true;
  tab('friends').setAttribute('tabindex', '-1');
  for (const [name, label] of Object.entries({summary:'ภาพรวม',list:'รายการ',add:'เพิ่ม',debt:'หารบิล'})) {
    tab(name).querySelectorAll('.tab-full,.tab-short,.tab-label').forEach(el => { el.textContent = label; });
    tab(name).setAttribute('aria-label', label);
  }
  $('.tab-ic', tab('summary')).innerHTML = icon('home');
  $('.tab-ic', tab('debt')).innerHTML = icon('people');
  // Keep notification badge and its existing event handler.
  const bell = $('#bellBtn');
  [...bell.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
  bell.insertAdjacentHTML('afterbegin', icon('bell'));
  const settings = htmlElement('section', 'chart-card appearance-settings', '<h2 class="section-title">การตั้งค่าแอป</h2><div class="settings-actions"></div>');
  $('#panel-me').append(settings);
  ['themeBtn','bgBtn','syncBtn'].forEach(id => {
    const button = $('#' + id); button.className = 'btn';
    button.textContent = {themeBtn:'สลับธีม',bgBtn:'เปลี่ยนพื้นหลัง',syncBtn:'บัญชีและการหารบิล'}[id];
    $('.settings-actions', settings).append(button);
  });
  const billSwitch = htmlElement('div', 'bill-switch', '<h2>หารบิลกับเพื่อน</h2><div class="segmented" aria-label="มุมมองหารบิล"><button type="button" data-bill="debt" aria-pressed="true">ลูกหนี้</button><button type="button" data-bill="friends" aria-pressed="false">เพื่อน <span id="designFriendCount"></span></button></div>');
  billSwitch.hidden = true;
  $('main').prepend(billSwitch);
  billSwitch.addEventListener('click', event => { const button = event.target.closest('[data-bill]'); if (button) navigate(button.dataset.bill); });
  $('#debtList').addEventListener('click', event => {
    const button = event.target.closest('[data-request-qr]');
    if (!button) return;
    $('#myQrBtn').click();
    const amount = $('#myQrAmountInput');
    if (amount) { amount.value = button.dataset.requestQr; amount.dispatchEvent(new Event('change', {bubbles:true})); }
  });
  $('.tile-label', $('#panel-debt')).textContent = 'รอเพื่อนคืน';
  const debtHero = $('#panel-debt .tile');
  const debtStats = htmlElement('div', 'debt-hero-stats', '<span>เพื่อนที่ค้าง </span><span>ได้คืนแล้ว </span>');
  debtStats.children[0].append($('#debtPeople'));
  debtStats.children[1].append($('#debtPaid'));
  debtHero.append(debtStats);
  $('#panel-debt').querySelectorAll('.tiles > .tile:not(:first-child)').forEach(el=>el.remove());
  const debtsObserver = new MutationObserver(() => {
    $('#debtList').querySelectorAll('.debt-card').forEach(card => {
      const name = $('.debt-name',card);
      if (!name || $('.debt-avatar',name)) return;
      name.textContent = card.dataset.name;
      const avatar = document.createElement('span'); avatar.className='debt-avatar'; avatar.setAttribute('aria-hidden','true');
      avatar.textContent = [...card.dataset.name][0] || '·'; name.prepend(avatar);
    });
  });
  debtsObserver.observe($('#debtList'),{childList:true,subtree:true});

  const summary = $('#panel-summary');
  const heading = $('.page-heading h2', summary); heading.textContent = 'ภาพรวม';
  const overviewHead = htmlElement('div', 'overview-head', '');
  overviewHead.append($('.page-heading', summary), $('.filters', summary)); summary.prepend(overviewHead);
  const hero = $('.tile', summary);
  $('.tile-label', hero).textContent = 'รายจ่ายเดือนนี้';
  hero.insertAdjacentHTML('beforeend', '<div class="hero-budget"><span id="remainingLabel">งบคงเหลือ</span><strong id="designRemaining"></strong></div><div id="designProgress" class="hero-progress"><progress id="designBudgetProgress" max="100" value="0" aria-label="สัดส่วนการใช้งบ"></progress><div><span id="designBudgetLimit"></span><span id="designBudgetPercent"></span></div></div>');
  const quick = htmlElement('div', 'overview-actions', '<button type="button" data-overview="camera">' + icon('camera') + '<span><b>ถ่ายใบเสร็จ</b><small>อ่านและบันทึกรายจ่าย</small></span></button><button type="button" data-overview="manual">' + icon('plus') + '<span><b>กรอกเอง</b><small>เพิ่มรายการด้วยตัวเอง</small></span></button>');
  $('.tiles', summary).after(quick);
  const categories = htmlElement('section', 'overview-categories', '<div class="section-row"><h2>หมวดรายจ่าย</h2><button type="button" data-overview="categories">ดูทั้งหมด ›</button></div><div class="category-overview"><div class="donut" id="designDonut" aria-hidden="true"><div><strong id="designDonutTotal"></strong><small>ทั้งหมด</small></div></div><table class="category-legend"><caption class="sr-only">รายจ่ายแต่ละหมวดและสัดส่วน</caption><thead class="sr-only"><tr><th>หมวด</th><th>จำนวนเงิน</th><th>สัดส่วน</th></tr></thead><tbody id="designCategories"></tbody></table></div><p id="designCategoryEmpty" class="empty" hidden>ยังไม่มีรายจ่ายในเดือนนี้</p></section>');
  quick.after(categories);
  const recent = htmlElement('section', 'overview-recent', '<div class="section-row"><h2>รายการล่าสุด</h2><button type="button" data-overview="list">ดูทั้งหมด ›</button></div><div id="designRecent" class="recent-list"></div>');
  categories.after(recent);
  const details = document.createElement('details'); details.className = 'summary-details';
  details.innerHTML = '<summary>สถิติและงบประมาณเพิ่มเติม</summary>';
  [...summary.children].filter(el => el.matches('.chart-card')).forEach(el => details.append(el));
  summary.append(details);
  summary.addEventListener('click', event => {
    const action = event.target.closest('[data-overview]')?.dataset.overview;
    if (action === 'list') navigate('list');
    if (action === 'categories') { details.open = true; $('#catChart').scrollIntoView({block:'center'}); }
    if (action === 'camera') { navigate('add'); setEntryMode('receipt'); $('#camBtn').click(); }
    if (action === 'manual') { navigate('add'); setEntryMode('manual'); }
  });

  const addPanel = $('#panel-add');
  $('.page-heading h2', addPanel).textContent = 'เพิ่มรายจ่าย';
  const modes = htmlElement('div', 'segmented entry-modes', '<button type="button" data-entry="receipt" aria-pressed="true">ใบเสร็จ</button><button type="button" data-entry="manual" aria-pressed="false">กรอกเอง</button>');
  $('.page-heading', addPanel).after(modes);
  function setEntryMode(mode) {
    addPanel.classList.toggle('manual-mode', mode === 'manual');
    modes.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.entry === mode)));
    if (mode === 'manual' && !$('#queue .rcard')) $('#manualBtn').click();
  }
  modes.addEventListener('click', event => { const button = event.target.closest('[data-entry]'); if (button) setEntryMode(button.dataset.entry); });
  $('#manualBtn').addEventListener('click', () => setEntryMode('manual'));
  const queueObserver = new MutationObserver(() => {
    for (const card of document.querySelectorAll('#queue .rcard')) {
      const select = $('[data-f="category"]', card);
      if (!select || $('.category-picks', card)) continue;
      const picks = htmlElement('div', 'category-picks', '');
      picks.setAttribute('aria-label', 'หมวดที่ใช้บ่อย');
      ReceiptParser.categories.filter(cat => /food|transport|shop/.test(cat.key)).slice(0,3).forEach(cat => {
        const button = document.createElement('button'); button.type = 'button';
        button.innerHTML = icon(categoryIcon(cat.key));
        button.setAttribute('aria-label', cat.label);
        button.title = cat.label;
        button.setAttribute('aria-pressed', String(select.value === cat.key));
        button.addEventListener('click', () => { select.value = cat.key; select.dispatchEvent(new Event('change', {bubbles:true})); });
        button.dataset.category = cat.key; picks.append(button);
      });
      select.parentElement.after(picks);
      $('[data-f="amount"]', card).setAttribute('inputmode','decimal');
      select.addEventListener('change', () => picks.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === select.value))));
    }
  });
  queueObserver.observe($('#queue'), {childList:true,subtree:true});

  const palette = ['#17543f','#76b99a','#b6ddc5','#91aaa0','#d5dccc'];
  function refreshOverview() {
    const selectedMonth = $('#sumMonth').value;
    const rows = ExpenseStore.all().filter(row => row.date?.slice(0,7) === selectedMonth);
    const total = rows.reduce((sum,row) => sum + (Number(row.amount) || 0),0);
    const limit = ExpenseStore.budget.get().total;
    $('#designRemaining').textContent = limit ? money(Math.abs(limit-total)) : 'ยังไม่ตั้งงบ';
    $('#remainingLabel').textContent = limit && total > limit ? 'เกินงบ' : 'งบคงเหลือ';
    $('#designProgress').hidden = !limit;
    $('#designBudgetProgress').value = limit ? Math.min(100,total/limit*100) : 0;
    $('#designBudgetLimit').textContent = 'จากงบ ' + money(limit);
    $('#designBudgetPercent').textContent = (limit ? Math.round(total/limit*100) : 0) + '% ใช้ไป';
    const grouped = {};
    rows.forEach(row => { grouped[row.category] = (grouped[row.category] || 0) + (Number(row.amount) || 0); });
    const sorted = Object.entries(grouped).filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]);
    const shown = sorted.length > 4 ? [...sorted.slice(0,3),['__others', sorted.slice(3).reduce((sum,row)=>sum+row[1],0)]] : sorted;
    let start = 0;
    const stops = shown.map(([,amount],i) => { const end = start + amount/total*100; const stop = palette[i]+' '+start+'% '+end+'%'; start=end; return stop; });
    $('#designDonut').style.background = stops.length ? 'conic-gradient('+stops.join(',')+')' : 'var(--border-soft)';
    $('#designDonutTotal').textContent = money(total);
    $('#designCategories').innerHTML = shown.map(([key,amount],i) => '<tr><th scope="row"><span class="category-symbol" style="color:'+palette[i]+'">'+icon(categoryIcon(key))+'</span><span>'+escape(key==='__others'?'หมวดอื่น ๆ':ReceiptParser.categoryLabel(key))+'</span></th><td>'+escape(money(amount))+'</td><td>'+Math.round(amount/total*100)+'%</td></tr>').join('');
    $('#designCategoryEmpty').hidden = rows.length > 0;
    $('.category-overview', categories).hidden = !rows.length;
    $('#designRecent').innerHTML = rows.slice().sort((a,b)=> b.date.localeCompare(a.date) || (b.createdAt||0)-(a.createdAt||0)).slice(0,3).map(row => '<button type="button" class="recent-row" data-overview="list"><span class="category-symbol">'+icon(categoryIcon(row.category))+'</span><span class="recent-copy"><b>'+escape(row.merchant || 'รายจ่าย')+'</b><small>'+escape(new Date(row.date+'T12:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short'}))+' · '+escape(ReceiptParser.categoryLabel(row.category))+'</small></span><strong>'+escape(money(Number(row.amount)||0))+'</strong><span aria-hidden="true">›</span></button>').join('') || '<p class="empty">เริ่มบันทึกรายจ่ายแรกของคุณ<br>ถ่ายใบเสร็จหรือกรอกเองได้เลย</p>';
    $('#designFriendCount').textContent = ExpenseStore.friends.all().length || '';
  }
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    const name = button.dataset.tab;
    const isBill = name === 'friends' || name === 'debt';
    billSwitch.hidden = !isBill;
    if (name === 'friends') { tab('debt').classList.add('is-active'); tab('debt').setAttribute('aria-selected','true'); }
    billSwitch.querySelectorAll('[data-bill]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.bill===name)));
    if (name === 'summary') refreshOverview();
    window.scrollTo(0,0);
  }));
  $('#sumMonth').addEventListener('change', refreshOverview);
  ExpenseStore.onChange(() => queueMicrotask(refreshOverview));
  // Initial dashboard; explicit app/deep-link routes keep their existing behavior.
  if (!location.hash) navigate('summary');
  else { const active = $('.tab.is-active'); if (active) navigate(active.dataset.tab); refreshOverview(); }
})();
