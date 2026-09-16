/* Native-style presentation over AmPayPay's existing storage and receipt flows. */
(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const money = value => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /* ทุกมุมของไอคอนปัดให้มนหมด ไม่เหลือปลายแหลมหรือมุมฉาก
     (หลังคาบ้าน มุมล่างของถุง ตัวกล้อง ตัวรถ) จะได้เข้าชุดกับปุ่มและการ์ดที่มนขึ้น */
  const icons = {
    home: '<path d="M3.8 10.4 10.7 4.7a2 2 0 0 1 2.6 0l6.9 5.7v7.9a2.4 2.4 0 0 1-2.4 2.4H6.2a2.4 2.4 0 0 1-2.4-2.4z"/><path d="M9.6 20.7v-5.1a1.8 1.8 0 0 1 1.8-1.8h1.2a1.8 1.8 0 0 1 1.8 1.8v5.1"/>',
    camera: '<path d="M4.4 8.2h2.2l1.5-2.3a1.8 1.8 0 0 1 1.5-.8h4.8a1.8 1.8 0 0 1 1.5.8l1.5 2.3h2.2a2.4 2.4 0 0 1 2.4 2.4v7a2.4 2.4 0 0 1-2.4 2.4H4.4A2.4 2.4 0 0 1 2 17.6v-7a2.4 2.4 0 0 1 2.4-2.4z"/><circle cx="12" cy="13.8" r="3.2"/>',
    plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
    food: '<path d="M6.4 3.4v4.8a2.6 2.6 0 0 0 5.2 0V3.4M9 8.8v11.8"/><ellipse cx="17.4" cy="7.8" rx="2.7" ry="4.4"/><path d="M17.4 12.2v8.4"/>',
    car: '<path d="M4.6 11.2 6.2 6.4a2.4 2.4 0 0 1 2.3-1.6h7a2.4 2.4 0 0 1 2.3 1.6l1.6 4.8"/><path d="M5 11.2h14a2.4 2.4 0 0 1 2.4 2.4v3.2a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2v-3.2A2.4 2.4 0 0 1 5 11.2z"/><path d="M6.4 18.8v1.6m11.2-1.6v1.6M6.2 15h1.6m8.4 0h1.6"/>',
    bag: '<path d="M5.6 7.6h12.8a1.8 1.8 0 0 1 1.8 1.9l-.7 9.2a2.4 2.4 0 0 1-2.4 2.2H6.9a2.4 2.4 0 0 1-2.4-2.2l-.7-9.2a1.8 1.8 0 0 1 1.8-1.9z"/><path d="M8.8 7.6V6.2a3.2 3.2 0 0 1 6.4 0v1.4"/>',
    more: '<circle cx="5.2" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.8" cy="12" r="1.1"/>',
    bell: '<path d="M6.2 9.6a5.8 5.8 0 0 1 11.6 0v4.6l1.5 2.2a1.2 1.2 0 0 1-1 1.9H5.7a1.2 1.2 0 0 1-1-1.9l1.5-2.2z"/><path d="M10.2 21.2h3.6"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3.4 20.8v-2.4a5.6 5.6 0 0 1 11.2 0v2.4M16.2 5.2a3.2 3.2 0 0 1 0 6.2m1.9 3.9a5 5 0 0 1 2.8 4.1v1.4"/>'
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
  /* แถบงบเป็นปุ่มจริงทั้งสองชิ้น เพราะการ์ดใบนี้คือที่เดียวที่ผู้ใช้เห็นเรื่องงบตั้งแต่เปิดแอป
     ส่วนการ์ดตั้งงบจริงถูกยุบอยู่ใน "สถิติและงบประมาณเพิ่มเติม" ถ้าแถบนี้กดไม่ได้
     ผู้ใช้จะเห็นคำว่า "ยังไม่ตั้งงบ" แล้วกดยังไงก็ไม่มีอะไรเกิดขึ้น
     ที่ไม่ครอบทั้งสองชิ้นด้วยปุ่มเดียว เพราะชิ้นบนวางแบบ absolute ส่วนชิ้นล่างอยู่ในสายการวางปกติ
     ปุ่มที่ครอบจะสูงศูนย์ตอนยังไม่ตั้งงบ (ชิ้นล่างถูกซ่อน) แล้วกลายเป็นกดไม่โดนอีก */
  hero.insertAdjacentHTML('beforeend', '<button type="button" class="hero-budget" data-overview="budget"><span id="remainingLabel">งบคงเหลือ</span><strong id="designRemaining"></strong></button><button type="button" id="designProgress" class="hero-progress" data-overview="budget"><progress id="designBudgetProgress" max="100" value="0" aria-label="สัดส่วนการใช้งบ"></progress><span><span id="designBudgetLimit"></span><span id="designBudgetPercent"></span></span></button>');
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
    if (action === 'budget') openBudget();
  });
  /* กางกล่องสถิติ เลื่อนไปที่การ์ดงบ แล้วเข้าโหมดแก้ไขให้เลย — กดครั้งเดียวจบ */
  function openBudget() {
    details.open = true;
    const card = $('#budgetCard');
    if (!card) return;
    const edit = $('[data-bact="edit"]', card);
    if (edit) edit.click();
    card.scrollIntoView({ block: 'center' });
    const total = $('[data-bf="total"]', card);
    if (total) setTimeout(() => { total.focus(); total.select?.(); }, 120);
  }

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
    /* ยังไม่ตั้งงบ ให้ข้อความอ่านเป็น "ปุ่ม" ไม่ใช่คำบอกสถานะเฉยๆ ผู้ใช้จะได้รู้ว่ากดได้ */
    $('#designRemaining').textContent = limit ? money(Math.abs(limit-total)) : 'ตั้งงบ ›';
    $('#remainingLabel').textContent = !limit ? 'งบประมาณ' : total > limit ? 'เกินงบ' : 'งบคงเหลือ';
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
  // แอปจะล้าง hash ทิ้งทันทีที่จัดการลิงก์เสร็จ จึงต้องดู __deepRouted ด้วย
  // ไม่อย่างนั้นสลิปที่ส่งมาจากคำสั่งลัดจะถูกดึงกลับมาหน้าภาพรวม จนผู้ใช้ไม่เห็นการ์ดที่เพิ่งเข้ามา
  if (!location.hash && !window.__deepRouted) navigate('summary');
  else { const active = $('.tab.is-active'); if (active) navigate(active.dataset.tab); refreshOverview(); }
})();
