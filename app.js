/* 论坛体写作助手 —— 核心逻辑 */
(() => {
  'use strict';

  const LS_KEY = 'forum-writer-project-v1';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const PALETTE = ['#5b8def', '#e0654c', '#3bab8a', '#b06ad6', '#e8a53c', '#5d6b8a', '#d45d92', '#4aa3c7'];

  /* ---------- 数据模型 ---------- */
  // project = {
  //   title: string,
  //   sortMode: 'manual' | 'time',
  //   chars: [ {id, name, uid, avatar, color, title, note} ],
  //   floors: [ {id, charId, content, time, replies:[{id,charId,toCharId,content}]} ]
  // }
  let P = load();

  function uid(p = 'id') {
    return p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function blank() {
    return {
      app: 'forum-writer', version: 1,
      title: '', sortMode: 'manual',
      chars: [], floors: [],
      opFloorId: '',
      // 置顶区：楼主帖 + 版规/公告，不参与楼层编号
      pinned: { op: true, opText: '', notices: [] },
      // 词库：可在「设置」里编辑，存进项目随存档一起走
      lex: defaultLex(),
      // 时间戳步进（分钟）：自动给新楼层分配时间
      timeStep: 2,
      // 折叠类阈值
      replyCollapseAt: 3,
      imgMaxW: 640,
      // 新建楼层的默认马甲
      newFloorChar: 'first',
      // 批量回复：随机角色
      batchChar: 'random',
    };
  }
  function defaultLex() {
    return {
      pre: ['江湖', '深夜', '隔壁', '神秘', '孤独', '爱吃', '一只', '路过', '摸鱼', '家里', '远方', '沉默', '快乐', '佛系', '匿名', '热心', '不困', '爱睡', '元气', '摆烂'],
      mid: ['夜雨', '吃瓜', '柠檬', '薯条', '咸鱼', '奶茶', '面包', '土豆', '橘子', '海苔', '咖啡', '西瓜', '锅贴', '汤圆', '布丁', '麻薯'],
      suf: ['十年灯', '第一线', '本尊', '酱', '大人', '不睡觉', '在人间', '本鱼', '喵', '汪', '打工人', '摸鱼人', '观察员', '研究员', '路人甲', '小朋友', '大魔王', '小分队'],
      nb: ['观察员', '分析帝', '搬运工', '预言家', '当事人', '知情者', '看热闹', '吃瓜群众', '论坛悍匪', '键盘侠', '灌水冠军', '潜水艇', '老司机', '小白菜'],
      title: ['LV.1 新手上路', 'LV.2 潜水员', 'LV.3 常驻居民', 'LV.5 活跃用户', 'LV.7 资深水友', 'LV.9 版主', 'LV.10 传说中的存在', '荣誉会员', '被封号过的人'],
      uidPre: ['yu', 'melon', 'user', 'moyu', 'passerby', 'fish', 'anon', 'typer', 'diving', 'night'],
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        d.lex = normalizeLex(d.lex);
        d.pinned = normalizePinned(d.pinned);
        return Object.assign(blank(), d);
      }
    } catch (e) { /* 忽略损坏数据 */ }
    return blank();
  }
  function normalizePinned(p) {
    p = p || {};
    return {
      op: p.op !== false,
      opText: typeof p.opText === 'string' ? p.opText : '',
      notices: Array.isArray(p.notices) ? p.notices.map(n => Object.assign(
        { id: uid('n'), kind: '公告', title: '', content: '' }, n)) : [],
    };
  }
  // 兼容旧存档 / 空词库
  function normalizeLex(lex) {
    const def = defaultLex();
    if (!lex || typeof lex !== 'object') return def;
    const out = {};
    Object.keys(def).forEach(k => {
      out[k] = Array.isArray(lex[k]) && lex[k].length ? lex[k].map(String) : def[k];
    });
    return out;
  }
  // 把 JSON / 文本还原成工程对象，用于导入
  function adoptProject(raw) {
    let data;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); }
      catch (e) {
        // 不是 JSON：当作纯文本，一个楼层兜底导入
        data = { title: '', chars: [], floors: [{ id: uid('f'), charId: '', content: raw, time: nowTime(), replies: [] }] };
      }
    } else data = raw;
    if (!data || !Array.isArray(data.floors)) throw new Error('文件里没有楼层数据');
    // 补全字段，防止手工编辑过的存档缺字段
    data.chars = (data.chars || []).map(c => Object.assign(
      { id: uid('c'), name: '未命名', uid: '', avatar: '', color: '#5b8def', title: '', note: '', anon: false }, c));
    data.floors = data.floors.map(f => Object.assign(
      { id: uid('f'), charId: '', content: '', time: nowTime(), replies: [], images: [], collapsed: false }, f,
      { images: f.images || [], collapsed: !!f.collapsed,
        replies: (f.replies || []).map(r => Object.assign({ id: uid('r'), charId: '', toCharId: '', content: '', images: [] }, r, { images: r.images || [] })) }));
    data.lex = normalizeLex(data.lex);
    data.pinned = normalizePinned(data.pinned);
    if (!data.sortMode) data.sortMode = 'manual';
    if (typeof data.timeStep !== 'number') data.timeStep = 2;
    if (typeof data.replyCollapseAt !== 'number') data.replyCollapseAt = 3;
    if (typeof data.imgMaxW !== 'number') data.imgMaxW = 640;
    if (typeof data.opFloorId !== 'string') data.opFloorId = '';
    if (!['none', 'first', 'last', 'random'].includes(data.newFloorChar)) data.newFloorChar = 'first';
    if (!['random', 'distinct', 'same'].includes(data.batchChar)) data.batchChar = 'random';
    return Object.assign(blank(), data);
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(P)); }
      catch (e) { toast('保存失败：' + e.message); }
    }, 250);
  }

  function charOf(id) { return P.chars.find(c => c.id === id) || null; }
  function floorById(id) { return P.floors.find(f => f.id === id); }
  function charLabel(c) { return c ? (c.anon ? '匿名' : c.name) : '（未指定）'; }

  // 匿名显示信息（不暴露真实昵称）
  const ANON = { name: '匿名用户', uid: 'anonymous', avatar: '匿', color: '#9aa3b2' };
  function idLabel(id) {
    const c = charOf(id);
    if (!c) return { name: '未指定', uid: 'anonymous', color: '#9aa3b2', avatar: '?', title: '' };
    if (c.anon) return { name: ANON.name, uid: ANON.uid, color: ANON.color, avatar: ANON.avatar, title: '' };
    return { name: c.name, uid: c.uid, color: c.color, avatar: c.avatar || c.name.slice(0, 1), title: c.title };
  }

  function nowTime(offset = 0) {
    const d = new Date(Date.now() + offset * 60000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function displayFloors() {
    if (P.sortMode === 'time') {
      return [...P.floors].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    return P.floors;
  }

  /* ---------- 渲染：角色 ---------- */
  function renderChars() {
    const box = $('#charList');
    box.innerHTML = '';
    if (!P.chars.length) {
      box.innerHTML = '<p class="hint" style="border:none">还没有角色，点「＋ 新增」。</p>';
      return;
    }
    P.chars.forEach(c => {
      const el = document.createElement('div');
      el.className = 'char-card';
      el.draggable = true;
      el.dataset.id = c.id;
      el.title = (c.anon ? '匿名角色：' : '') + (c.note || '');
      el.innerHTML =
        `<div class="avatar" style="background:${esc(c.color)}">${esc(c.avatar || c.name.slice(0, 1))}</div>
         <div class="char-meta">
           <div class="n">${esc(c.name)}${c.op ? ' <span class="op-tag">楼主</span>' : ''}${c.anon ? ' <span class="anon-tag">匿名</span>' : ''}</div>
           <div class="u">@${esc(c.uid || 'anonymous')}</div>
         </div>
         <div class="char-ops">
           <button class="icon-btn" data-op="edit" title="编辑">✎</button>
           <button class="icon-btn" data-op="del" title="删除">🗑</button>
         </div>`;
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/char-id', c.id);
        e.dataTransfer.effectAllowed = 'copy';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('click', e => {
        const op = e.target.dataset.op;
        if (op === 'edit') openCharModal(c.id);
        else if (op === 'del') delChar(c.id);
      });
      box.appendChild(el);
    });
  }

  function delChar(id) {
    const c = charOf(id);
    if (!c) return;
    const used = P.floors.some(f => f.charId === id || f.replies.some(r => r.charId === id || r.toCharId === id));
    if (used && !confirm(`角色「${c.name}」已被引用，删除后相关楼层将显示为「未指定」。确定删除？`)) return;
    P.chars = P.chars.filter(x => x.id !== id);
    save(); renderChars(); renderFloors(); renderPreview();
  }

  /* ---------- 随机角色（词库存于 P.lex，可在设置里编辑） ---------- */
  // 抽词兜底：空数组 / 非数组也不会抽出 undefined（undefined 会污染角色名与后续渲染）
  function pick(arr) {
    if (!Array.isArray(arr) || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function lexOf(k) {
    const v = P.lex && P.lex[k];
    return Array.isArray(v) && v.length ? v : defaultLex()[k];
  }
  function randomName() {
    const r = Math.random();
    if (r < 0.34) return pick(lexOf('pre')) + pick(lexOf('mid'));
    if (r < 0.62) return pick(lexOf('mid')) + pick(lexOf('suf'));
    if (r < 0.82) return pick(lexOf('pre')) + pick(lexOf('nb'));
    return pick(lexOf('pre')) + pick(lexOf('mid')) + pick(lexOf('suf'));
  }
  function makeRandomChar() {
    const name = randomName() || '匿名用户';
    return {
      id: uid('c'), name, uid: randomUid(), avatar: name.slice(-1) || name.slice(0, 1),
      color: randomColor(), title: pick(lexOf('title')), note: '', anon: false,
    };
  }
  function randomUid() {
    const style = Math.floor(Math.random() * 3);
    if (style === 0) return pick(lexOf('uidPre')) + '_' + Math.floor(Math.random() * 9000 + 1000);
    if (style === 1) return Math.floor(Math.random() * 900000 + 100000) + '';
    return pick(lexOf('uidPre')) + Math.floor(Math.random() * 900 + 100);
  }
  function randomColor() { return pick(PALETTE) || PALETTE[0]; }
  function fillRandomChar() {
    const name = randomName();
    $('#cName').value = name;
    $('#cUid').value = randomUid();
    $('#cAvatar').value = name.slice(-1) || name.slice(0, 1);
    $('#cColor').value = randomColor();
    $('#cTitle').value = pick(P.lex.title);
    $('#cAnon').checked = false;
  }

  /* ---------- 角色弹窗 ---------- */
  let editingCharId = null;
  function openCharModal(id) {
    editingCharId = id || null;
    const c = id ? charOf(id) : null;
    $('#charModalTitle').textContent = id ? '编辑角色' : '新增角色';
    $('#cName').value = c ? c.name : '';
    $('#cUid').value = c ? c.uid : '';
    $('#cAvatar').value = c ? c.avatar : '';
    $('#cColor').value = c ? c.color : PALETTE[Math.floor(Math.random() * PALETTE.length)];
    $('#cTitle').value = c ? c.title : '';
    $('#cAnon').checked = c ? !!c.anon : false;
    $('#cOp').checked = c ? !!c.op : false;
    $('#cNote').value = c ? c.note : '';
    $('#charModal').classList.remove('hidden');
    if (!id) fillRandomChar();
    setTimeout(() => $('#cName').focus(), 50);
  }
  function saveChar() {
    const name = $('#cName').value.trim();
    if (!name) { toast('请填写昵称'); return; }
    const data = {
      name,
      uid: $('#cUid').value.trim() || ('user_' + Math.floor(Math.random() * 9000 + 1000)),
      avatar: $('#cAvatar').value.trim(),
      color: $('#cColor').value,
      title: $('#cTitle').value.trim(),
      anon: $('#cAnon').checked,
      op: $('#cOp').checked,
      note: $('#cNote').value.trim(),
    };
    if (editingCharId) Object.assign(charOf(editingCharId), data);
    else P.chars.push(Object.assign({ id: uid('c') }, data));
    save(); renderChars(); renderFloors(); renderPreview();
    $('#charModal').classList.add('hidden');
  }

  /* ---------- 渲染：置顶区 ---------- */
  let pinOpen = true;
  function renderPin() {
    const zone = $('#pinZone');
    if (!pinOpen) { zone.innerHTML = ''; return; }
    const p = P.pinned;
    const opChar = P.chars[0] || null;
    let html = '';

    if (p.op) {
      html += `<div class="pin-card">
        <div class="pin-head"><span class="pin-badge">楼主帖</span><span class="pin-author">${esc(opAuthorName())}</span><span class="floor-spacer"></span>
          <button class="icon-btn" data-op="pin-op-clear" title="移除楼主帖（内容保留，可一键恢复）">✕</button></div>
        <div class="pin-body">
          <input class="pin-title" data-role="op-title" placeholder="楼主帖标题，留空则用作品标题" value="${esc(p.opTitle || '')}">
          <textarea data-role="op-text" placeholder="楼主帖正文（一楼内容）…">${esc(p.opText || '')}</textarea>
          <div class="floor-tools">
            <button class="btn mini ghost" data-op="op-from-floor" title="用第一楼的内容填充楼主帖">↓ 从第一楼导入</button>
          </div>
        </div></div>`;
    } else {
      html += `<div class="pin-card pin-off">
        <div class="pin-head"><span class="pin-badge">楼主帖</span><span class="pin-author">已收起</span><span class="floor-spacer"></span>
          <button class="btn mini ghost" data-op="pin-op-restore">恢复显示</button></div></div>`;
    }
    html += `<button class="btn mini ghost pin-add" data-op="pin-add-notice">＋ 添加公告</button>`;

    p.notices.forEach((n, i) => {
      html += `<div class="pin-card pin-notice">
        <div class="pin-head"><span class="pin-badge">${esc(n.kind || '公告')}</span>
          <button class="icon-btn" data-op="pin-up" data-i="${i}" title="上移">↑</button>
          <button class="icon-btn" data-op="pin-down" data-i="${i}" title="下移">↓</button>
          <button class="icon-btn" data-op="pin-del" data-i="${i}" title="删除">🗑</button></div>
        <div class="pin-body">
          <input class="pin-title" data-role="notice-title" data-i="${i}" placeholder="标题，如：版规 / 置顶说明" value="${esc(n.title || '')}">
          <textarea data-role="notice-content" data-i="${i}" placeholder="内容…">${esc(n.content || '')}</textarea>
        </div></div>`;
    });
    html += `<button class="btn mini ghost pin-add" data-op="pin-add-notice">＋ 添加公告</button>`;

    zone.innerHTML = html;

    // 事件绑定
    const opTitle = zone.querySelector('[data-role="op-title"]');
    if (opTitle) {
      opTitle.addEventListener('input', () => { p.opTitle = opTitle.value; save(); renderPreview(); });
      const opText = zone.querySelector('[data-role="op-text"]');
      opText.addEventListener('input', () => { p.opText = opText.value; save(); renderPreview(); });
      autoGrow(opText);
    }
    zone.querySelectorAll('[data-role="notice-title"]').forEach(el => {
      el.addEventListener('input', () => { p.notices[+el.dataset.i].title = el.value; save(); renderPreview(); });
    });
    zone.querySelectorAll('[data-role="notice-content"]').forEach(el => {
      el.addEventListener('input', () => { p.notices[+el.dataset.i].content = el.value; save(); renderPreview(); });
      autoGrow(el);
    });
    // 楼主帖：从第一楼导入 / 添加公告 需单独绑定（不参与下面的表单重渲染逻辑）
    const opFrom = zone.querySelector('[data-op="op-from-floor"]');
    if (opFrom) opFrom.addEventListener('click', () => {
      const f = P.floors[0];
      if (!f) { toast('还没有楼层'); return; }
      const c = charOf(f.charId);
      if (!p.opTitle) p.opTitle = (c && !c.anon ? `${c.name}：` : '') + (f.content || '').slice(0, 18);
      p.opText = p.opText ? p.opText + '\n' + (f.content || '') : (f.content || '');
      save(); renderPin(); renderPreview(); toast('已从第一楼导入');
    });
    const addNoticeBtn = zone.querySelector('[data-op="pin-add-notice"]');
    if (addNoticeBtn) addNoticeBtn.addEventListener('click', addNotice);

    zone.querySelectorAll('[data-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        const op = btn.dataset.op;
        const i = +btn.dataset.i;
        if (op === 'pin-op-clear') { if (confirm('收起楼主帖？内容会保留，可随时恢复。')) p.op = false; }
        else if (op === 'pin-op-restore') p.op = true;
        else if (op === 'pin-del') { if (!confirm('删除这条置顶？')) return; p.notices.splice(i, 1); }
        else if (op === 'pin-up' && i > 0) { [p.notices[i - 1], p.notices[i]] = [p.notices[i], p.notices[i - 1]]; }
        else if (op === 'pin-down' && i < p.notices.length - 1) { [p.notices[i + 1], p.notices[i]] = [p.notices[i], p.notices[i + 1]]; }
        save(); renderPin(); renderPreview();
      });
    });
    void opChar;
  }
  function opAuthorName() {
    const c = charOf(resolveOpFloorCharId());
    return c ? (c.anon ? '匿名用户' : c.name) : '楼主';
  }
  // 勾选了「帖主/楼主」的角色优先；其次是手动指定的楼层；最后按时间取最早的一楼兜底
  function markedOpChar() {
    return P.chars.find(c => c.op) || null;
  }
  function resolveOpFloorCharId() {
    const marked = markedOpChar();
    if (marked) return marked.id;
    const manual = P.opFloorId ? P.floors.find(f => f.id === P.opFloorId) : null;
    if (manual) return manual.charId;
    let best = null, bt = null;
    P.floors.forEach(f => {
      if (!f.charId) return;
      const t = f.time ? new Date(String(f.time).replace(' ', 'T')).getTime() : null;
      if (bt === null) { if (best === null) { best = f; if (t !== null && !isNaN(t)) bt = t; } }
      else if (t !== null && !isNaN(t) && t < bt) { best = f; bt = t; }
    });
    if (best) return best.charId;
    const any = P.floors.find(f => f.charId);
    return any ? any.charId : (P.chars[0] ? P.chars[0].id : '');
  }
  function isOpFloor(f) {
    if (markedOpChar()) return !!f.charId && f.charId === markedOpChar().id;
    if (P.opFloorId) return f.id === P.opFloorId;
    return !!f.charId && f.charId === resolveOpFloorCharId();
  }
  function addNotice() {
    P.pinned.notices.push({ id: uid('n'), kind: '公告', title: '', content: '' });
    save(); renderPin(); renderPreview();
  }
  function hasPinned() {
    const p = P.pinned;
    return (p.op && (p.opText || p.opTitle)) || p.notices.some(n => n.title || n.content);
  }

  /* ---------- 渲染：楼层 ---------- */
  function charSelect(selected, cls, dataAttr) {
    const opts = ['<option value="">（未指定）</option>']
      .concat(P.chars.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.anon ? c.name + '（匿名）' : c.name)}</option>`));
    return `<select class="${cls}" ${dataAttr}>${opts.join('')}</select>`;
  }

  // 渲染时分组：排序模式下不折叠；手动折叠模式下按 collapsed 相邻归并
  function groupForRender(list) {
    if (P.sortMode === 'time') return list.map(f => ({ floors: [f], collapsed: false, abs: absIndex(f) }));
    const groups = [];
    list.forEach(f => {
      const last = groups[groups.length - 1];
      if (last && last.collapsed && f.collapsed && sameDisplayOwner(last.floors[0], f)) {
        last.floors.push(f);
      } else {
        groups.push({ floors: [f], collapsed: !!f.collapsed, abs: absIndex(f) });
      }
    });
    return groups;
  }
  function absIndex(f) { return P.floors.indexOf(f) + 1; }
  function sameDisplayOwner(a, b) {
    if (a.charId !== b.charId) return false;
    const c = charOf(a.charId);
    return !(c && c.anon); // 匿名不自动合并，避免误并
  }

  function renderFloors() {
    const box = $('#floorList');
    const list = displayFloors();
    box.innerHTML = '';
    $('#emptyTip').classList.toggle('hidden', P.floors.length > 0);

    groupForRender(list).forEach(g => {
      if (g.collapsed && g.floors.length > 1) box.appendChild(buildCollapsedGroup(g));
      else g.floors.forEach(f => box.appendChild(buildFloorCard(f)));
    });

    if (P.sortMode === 'manual') bindFloorDnD(box);
  }

  // 折叠组：显示头像 + 连发 N 楼，点开展开
  function buildCollapsedGroup(g) {
    const info = idLabel(g.floors[0].charId);
    const el = document.createElement('div');
    el.className = 'collapsed-group';
    const preview = g.floors.map(f => (f.content || '（空）').replace(/\n/g, ' ').slice(0, 18)).join(' / ');
    el.innerHTML = `
      <div class="avatar" style="background:${esc(info.color)}">${esc(info.avatar)}</div>
      <div class="cg-main">
        <div class="cg-title"><b>${esc(info.name)}</b> 连发了 ${g.floors.length} 楼
          <span class="cg-range">（第 ${g.abs}~${g.abs + g.floors.length - 1} 楼）</span></div>
        <div class="cg-preview">${esc(preview)}</div>
      </div>
      <div class="cg-ops">
        <button class="btn mini" data-op="expand">展开全部</button>
        <button class="btn mini ghost" data-op="uncollapse" title="取消折叠，恢复独立楼层">取消折叠</button>
      </div>`;
    el.querySelector('[data-op="expand"]').addEventListener('click', () => {
      g.floors.forEach(f => { f.collapsed = false; });  // 临时展开：仅本次渲染
      expandedPreview = true;
      renderFloors();
    });
    el.querySelector('[data-op="uncollapse"]').addEventListener('click', () => {
      g.floors.forEach(f => { f.collapsed = false; });
      save(); renderFloors(); renderPreview();
    });
    return el;
  }

  function buildFloorCard(f) {
    const i = absIndex(f) - 1;
    const collapsed = !!f.collapsed && P.sortMode === 'manual';
    const card = document.createElement('div');
    card.className = 'floor-card' + (collapsed ? ' collapsed' : '');
    card.dataset.id = f.id;
    card.draggable = false;
    card.innerHTML = `
      <div class="floor-head">
        <span class="grip" title="拖拽排序">⠿</span>
        <span class="floor-no">${i + 1}F</span>
        ${charSelect(f.charId, 'char-pick', 'data-role="floor-char"')}
        <span class="floor-spacer"></span>
        <input class="floor-time" value="${esc(f.time || '')}" placeholder="时间" data-role="floor-time">
        <button class="icon-btn fold-btn" data-op="fold" title="${collapsed ? '展开此楼' : '折叠此楼（同人相邻楼层会合并）'}">${collapsed ? '▸' : '▾'}</button>
        <button class="icon-btn" data-op="op" title="${isOpFloor(f) ? '取消手动指定楼主' : '手动指定此楼为楼主'}">${isOpFloor(f) ? '⭐' : '☆'}</button>
        <button class="icon-btn" data-op="insert" title="在下方插入楼层">＋</button>
        <button class="icon-btn" data-op="dup" title="复制楼层">⧉</button>
        <button class="icon-btn" data-op="del" title="删除楼层">🗑</button>
      </div>
      <div class="floor-body">
        <textarea data-role="floor-content" placeholder="输入 ${i + 1} 楼内容…">${esc(f.content || '')}</textarea>
        <div class="img-strip">${(f.images || []).map((src, idx) =>
          `<div class="thumb"><img src="${src}" alt=""><button class="thumb-del" data-op="del-img" data-idx="${idx}" title="删除图片">✕</button></div>`).join('')}</div>
        <div class="floor-tools">
          <button class="btn mini ghost" data-op="add-img">🖼 插入图片</button>
          <button class="btn mini ghost" data-op="paste-img" title="也可以直接 Ctrl+V 粘贴截图">粘贴板</button>
          <button class="btn mini ghost" data-op="batch-reply" title="批量添加重复内容的回复（水军）">💬 批量回复</button>
        </div>
      </div>
      <div class="reply-zone">
        ${renderReplies(f)}
        <div class="add-reply" data-op="add-reply">＋ 添加楼中楼回复</div>
      </div>`;

    bindFloor(card, f, collapsed);
    return card;
  }

  // 楼中楼：超过阈值默认收起，显示「N条回复」
  function renderReplies(f) {
    const all = f.replies;
    const at = P.replyCollapseAt || 3;
    const expanded = f.repOpen === true;
    if (all.length > at && !expanded) {
      const head = all.slice(0, 2).map(r => replyHTML(r, f)).join('');
      return `${head}
        <div class="reply-toggle" data-op="rep-toggle">展开全部 ${all.length} 条回复 ▾</div>`;
    }
    const body = all.map(r => replyHTML(r, f)).join('');
    const toggle = all.length > at
      ? '<div class="reply-toggle" data-op="rep-toggle">收起回复 ▴</div>' : '';
    return body + toggle;
  }

  function replyHTML(r, floor) {
    const to = charOf(r.toCharId);
    const toInfo = r.toCharId ? idLabel(r.toCharId) : null;
    return `
      <div class="reply" data-id="${r.id}">
        <div class="reply-body">
          <div class="reply-line">
            <span class="grip g-grip" title="按住拖动排序">⠿</span>
            ${charSelect(r.charId, 'owner-select', 'data-role="reply-char"')}
            ${toInfo ? `<span class="reply-to">回复 @${esc(toInfo.name)}</span>` : ''}
            <button class="icon-btn" data-op="reply-to" title="设置/清除被回复人">@</button>
            <span class="reply-spacer"></span>
            <button class="icon-btn" data-op="add-img" title="插入图片">🖼</button>
            <button class="icon-btn" data-op="del-reply" title="删除回复">✕</button>
          </div>
          <textarea class="reply-content" data-role="reply-content" placeholder="回复内容…">${esc(r.content || '')}</textarea>
          <div class="img-strip small">${(r.images || []).map((src, idx) =>
            `<div class="thumb"><img src="${src}" alt=""><button class="thumb-del" data-op="del-img" data-idx="${idx}" title="删除图片">✕</button></div>`).join('')}</div>
        </div>
      </div>`;
  }

  /* ---------- 楼层事件绑定 ---------- */
  function bindFloor(card, f, collapsed) {
    const charPick = card.querySelector('[data-role="floor-char"]');
    charPick.addEventListener('change', () => { f.charId = charPick.value; save(); renderFloors(); renderPreview(); });

    const timeIn = card.querySelector('[data-role="floor-time"]');
    timeIn.addEventListener('input', () => { f.time = timeIn.value; save(); renderPreview(); });

    const content = card.querySelector('[data-role="floor-content"]');
    content.addEventListener('input', () => { f.content = content.value; save(); renderPreview(); });
    autoGrow(content);

    // 粘贴板贴图（楼层正文）
    content.addEventListener('paste', e => {
      const imgs = imageFilesFromDataTransfer(e.clipboardData);
      if (imgs.length) { e.preventDefault(); addImages(f, imgs, false); }
    });

    card.addEventListener('click', e => {
      const op = e.target.dataset.op;
      if (!op) return;
      if (op === 'del') delFloor(f.id);
      else if (op === 'dup') dupFloor(f.id);
      else if (op === 'insert') insertFloorAfter(f.id);
      else if (op === 'fold') toggleFold(f);
      else if (op === 'op') setOpFloor(f);
      else if (op === 'pin') pinFromFloor(f);
      else if (op === 'add-img') pickImage(files => addImages(f, files, false));
      else if (op === 'del-img') { f.images.splice(+e.target.dataset.idx, 1); save(); renderFloors(); renderPreview(); }
      else if (op === 'add-reply') addReply(f.id);
      else if (op === 'batch-reply') batchReplies(f);
      else if (op === 'rep-toggle') { f.repOpen = !f.repOpen; renderFloors(); }
    });

    // 楼中楼事件
    card.querySelectorAll('.reply').forEach(rEl => {
      const rid = rEl.dataset.id;
      const r = f.replies.find(x => x.id === rid);
      if (!r) return;
      const rc = rEl.querySelector('[data-role="reply-char"]');
      rc.addEventListener('change', () => { r.charId = rc.value; save(); renderFloors(); renderPreview(); });
      const rt = rEl.querySelector('[data-role="reply-content"]');
      if (rt) {
        rt.addEventListener('input', () => { r.content = rt.value; save(); renderPreview(); });
        autoGrow(rt);
        rt.addEventListener('paste', e => {
          const imgs = imageFilesFromDataTransfer(e.clipboardData);
          if (imgs.length) { e.preventDefault(); addImages(r, imgs, true); }
        });
      }
      rEl.addEventListener('click', e => {
        const op = e.target.dataset.op;
        if (op === 'del-reply') { f.replies = f.replies.filter(x => x.id !== rid); save(); renderFloors(); renderPreview(); }
        else if (op === 'reply-to') setReplyTo(f, r);
        else if (op === 'add-img') pickImage(files => addImages(r, files, true));
        else if (op === 'del-img') { r.images.splice(+e.target.dataset.idx, 1); save(); renderFloors(); renderPreview(); }
      });
      bindReplyDnD(rEl, f);
    });

    bindFloorDrop(card, f);
    void collapsed;
  }

  function toggleFold(f) {
    f.collapsed = !f.collapsed;
    save(); renderFloors(); renderPreview();
  }

  function setOpFloor(f) {
    P.opFloorId = (P.opFloorId === f.id) ? '' : f.id;
    save(); renderFloors(); renderPreview();
  }

  // 把某楼内容提到置顶区作为楼主帖
  function pinFromFloor(f) {
    if (!confirm(`把第 ${absIndex(f)} 楼设为置顶楼主帖？\n（原楼层会保留，可在楼层区继续编辑）`)) return;
    P.pinned.op = true;
    if (!P.pinned.opTitle && f.title) P.pinned.opTitle = f.title;
    P.pinned.opText = P.pinned.opText
      ? P.pinned.opText + '\n' + (f.content || '')
      : (f.content || '');
    save(); renderPin(); renderPreview();
    const info = idLabel(f.charId);
    toast('已置顶楼主帖' + (info.name !== '未指定' ? '（作者：' + info.name + '）' : ''));
  }

  /* ---------- 图片 ---------- */
  let imgInput = null;
  function pickImage(cb) {
    if (!imgInput) {
      imgInput = document.createElement('input');
      imgInput.type = 'file';
      imgInput.accept = 'image/*';
      imgInput.multiple = true;
      imgInput.style.display = 'none';
      document.body.appendChild(imgInput);
    }
    imgInput.value = '';
    imgInput.onchange = () => { cb(Array.from(imgInput.files || [])); };
    imgInput.click();
  }
  function imageFilesFromDataTransfer(dt) {
    if (!dt) return [];
    return Array.from(dt.items || [])
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile())
      .filter(Boolean);
  }
  function addImages(node, files, isReply) {
    if (!files || !files.length) return;
    node.images = node.images || [];
    const maxW = isReply ? Math.round((P.imgMaxW || 640) / 2) : (P.imgMaxW || 640);   // 缩略图存储尺寸，压缩体积
    let pending = files.length;
    files.forEach(file => {
      if (!file.type.startsWith('image/')) { if (!--pending) done(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          node.images.push(compressImage(img, maxW));
          if (!--pending) done();
        };
        img.onerror = () => { if (!--pending) done(); };
        img.src = reader.result;
      };
      reader.onerror = () => { if (!--pending) done(); };
      reader.readAsDataURL(file);
    });
    function done() { save(); renderFloors(); renderPreview(); toast('已插入 ' + files.length + ' 张图片'); }
  }
  // 压缩为 jpeg dataURL，控制体积（存档是 json，图片内嵌）
  function compressImage(img, maxW) {
    const scale = img.width > maxW ? maxW / img.width : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', 0.82);
  }

  function autoGrow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    fit();
    ta.addEventListener('input', fit);
  }

  function setReplyTo(floor, r) {
    const names = floor.replies
      .map(x => ({ id: x.charId, name: charOf(x.charId) ? charOf(x.charId).name : '' }))
      .filter(x => x.id && x.id !== r.charId);
    const uniq = [];
    const seen = new Set();
    names.forEach(n => { if (!seen.has(n.id)) { seen.add(n.id); uniq.push(n); } });
    const menu = ['<option value="">（不指定）</option>']
      .concat(uniq.map(n => `<option value="${n.id}" ${r.toCharId === n.id ? 'selected' : ''}>${esc(n.name)}</option>`));
    const pick = prompt('输入要 @ 的角色昵称（留空清除）：', r.toCharId && charOf(r.toCharId) ? charOf(r.toCharId).name : '');
    if (pick === null) return;
    if (!pick.trim()) { r.toCharId = ''; }
    else {
      const found = P.chars.find(c => c.name === pick.trim());
      if (!found) { toast('未找到该昵称的角色'); return; }
      r.toCharId = found.id;
    }
    save(); renderFloors(); renderPreview();
    void menu;
  }

  /* ---------- 楼层增删改 ---------- */
  // 新建楼层的默认马甲：none=不指定 / first=第一个角色 / last=上一个楼层 / random=随机新角色
  function resolveNewFloorChar() {
    const mode = P.newFloorChar || 'first';
    if (mode === 'none' || !P.chars.length) return '';
    if (mode === 'last') {
      for (let i = P.floors.length - 1; i >= 0; i--) if (P.floors[i].charId) return P.floors[i].charId;
      return P.chars[0].id;
    }
    if (mode === 'random') {
      if (P.chars.length < 12 && Math.random() < 0.5) {
        const c = makeRandomChar();
        P.chars.push(c);
        renderChars();
        return c.id;
      }
      return P.chars[Math.floor(Math.random() * P.chars.length)].id;
    }
    return P.chars[0].id;
  }
  function newFloor(charId = '', insertAt = null) {
    // 时间：接在最后一楼之后按 timeStep 递进，避免全部同一时刻
    const last = P.floors[P.floors.length - 1];
    const base = last && last.time ? last.time : nowTime();
    const step = typeof P.timeStep === 'number' ? P.timeStep : 2;
    const t = step > 0 ? bumpTime(base, step) : nowTime();
    const f = { id: uid('f'), charId, content: '', time: t, replies: [], images: [], collapsed: false };
    if (insertAt === null || insertAt >= P.floors.length) P.floors.push(f);
    else P.floors.splice(insertAt, 0, f);
    return f;
  }
  function bumpTime(str, minutes) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(str || '');
    if (!m) return nowTime();
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return nowTime((d.getTime() - Date.now()) / 60000 + minutes);
  }
  function addFloor() {
    if (!P.chars.length) toast('提示：先在左侧添加角色，楼层才能选马甲');
    newFloor(resolveNewFloorChar());
    save(); renderFloors(); renderPreview();
    const cards = $$('.floor-card');
    const last = cards[cards.length - 1];
    if (last) { last.scrollIntoView({ block: 'nearest' }); last.querySelector('textarea[data-role="floor-content"]').focus(); }
  }
  function insertFloorAfter(id) {
    const i = P.floors.findIndex(f => f.id === id);
    newFloor(resolveNewFloorChar(), i + 1);
    save(); renderFloors(); renderPreview();
  }
  function dupFloor(id) {
    const i = P.floors.findIndex(f => f.id === id);
    if (i < 0) return;
    const src = P.floors[i];
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid('f');
    copy.replies = copy.replies.map(r => Object.assign({}, r, { id: uid('r') }));
    P.floors.splice(i + 1, 0, copy);
    save(); renderFloors(); renderPreview();
  }
  function delFloor(id) {
    if (!confirm('删除该楼层？')) return;
    P.floors = P.floors.filter(f => f.id !== id);
    save(); renderFloors(); renderPreview();
  }

  function addReply(floorId) {
    const f = floorById(floorId);
    if (!f) return;
    f.replies.push({ id: uid('r'), charId: P.chars[1] ? P.chars[1].id : (P.chars[0] ? P.chars[0].id : ''), toCharId: '', content: '', images: [] });
    save(); renderFloors(); renderPreview();
    const card = document.querySelector(`.floor-card[data-id="${floorId}"]`);
    if (card) {
      const list = card.querySelectorAll('.reply-content');
      const last = list[list.length - 1];
      if (last) last.focus();
    }
  }

  // 批量添加重复内容的回复（水军刷屏）：随机角色，可选自动新建
  function batchReplies(floor) {
    if (!floor) { toast('批量回复失败：未定位到楼层'); return; }
    const content = prompt('批量回复的内容：', '');
    if (content === null || !content.trim()) return;
    const nStr = prompt('添加几条？', '10');
    if (nStr === null) return;
    const n = Math.max(1, Math.min(300, parseInt(nStr, 10) || 1));
    const text = content.trim();
    const mode = P.batchChar || 'random';
    try {
      for (let k = 0; k < n; k++) {
        let cid;
        if (mode === 'same') {
          cid = floor.charId || (P.chars[0] && P.chars[0].id);
        } else if (mode === 'distinct') {
          // 尽量各不相同：角色不足时自动新建，否则随机复用现有角色
          if (P.chars.length < 30 && (P.chars.length < n || Math.random() < 0.7)) {
            const c = makeRandomChar(); P.chars.push(c); cid = c.id;
          } else {
            cid = pick(P.chars.map(c => c.id));
          }
        } else {
          cid = P.chars.length ? pick(P.chars.map(c => c.id)) : '';
        }
        // 池里没有可用角色（0 个角色，或「全部同一个人」但楼层未指定马甲）→ 现造一个并入池
        if (!cid) { const c = makeRandomChar(); P.chars.push(c); cid = c.id; }
        floor.replies.push({ id: uid('r'), charId: cid, toCharId: '', content: text, images: [] });
      }
    } catch (err) {
      toast('批量回复出错：' + err.message);
      return;
    }
    floor.repOpen = true;  // 直接展开，方便核对
    save(); renderChars(); renderFloors(); renderPreview();
    toast(`已添加 ${n} 条批量回复`);
  }

  /* ---------- 拖拽排序：楼层 ---------- */
  function bindFloorDnD(box) {
    $$('.floor-card').forEach(card => {
      let armed = false;
      const grip = card.querySelector(':scope > .floor-head .grip');
      if (grip) {
        grip.addEventListener('pointerdown', () => { armed = true; card.draggable = true; });
        grip.addEventListener('pointerup', () => { armed = false; card.draggable = false; });
      }
      card.addEventListener('dragstart', e => {
        if (!armed || e.target.closest('input, select, textarea, button, .reply')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/floor-id', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        armed = false; card.draggable = false; card.classList.remove('dragging');
      });
    });
  }
  function bindFloorDrop(card, f) {
    card.addEventListener('dragover', e => {
      const charId = e.dataTransfer.types.includes('text/char-id');
      const floorId = e.dataTransfer.types.includes('text/floor-id');
      if (!charId && !floorId) return;
      e.preventDefault();
      card.classList.add('drop-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', e => {
      card.classList.remove('drop-target');
      const charId = e.dataTransfer.getData('text/char-id');
      const floorId = e.dataTransfer.getData('text/floor-id');
      if (charId) {
        // 拖角色到楼层：套马甲
        f.charId = charId;
        save(); renderFloors(); renderPreview();
        toast('已套用角色：' + charLabel(charOf(charId)));
        return;
      }
      if (floorId && floorId !== f.id && P.sortMode === 'manual') {
        e.preventDefault();
        const from = P.floors.findIndex(x => x.id === floorId);
        const to = P.floors.findIndex(x => x.id === f.id);
        if (from < 0 || to < 0) return;
        const [moved] = P.floors.splice(from, 1);
        P.floors.splice(to, 0, moved);
        save(); renderFloors(); renderPreview();
      }
    });
  }

  /* ---------- 拖拽排序：楼中楼 ---------- */
  function bindReplyDnD(el, floor) {
    let armed = false;
    const grip = el.querySelector('.g-grip');
    if (grip) {
      grip.addEventListener('pointerdown', () => { armed = true; el.draggable = true; });
      grip.addEventListener('pointerup', () => { armed = false; el.draggable = false; });
    }
    el.addEventListener('dragstart', e => {
      if (!armed) { e.preventDefault(); return; }
      e.stopPropagation();
      e.dataTransfer.setData('text/reply-id', el.dataset.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => { armed = false; el.draggable = false; el.classList.remove('dragging'); });
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/reply-id')) return;
      e.preventDefault();
    });
    el.addEventListener('drop', e => {
      const rid = e.dataTransfer.getData('text/reply-id');
      if (!rid || rid === el.dataset.id) return;
      e.preventDefault(); e.stopPropagation();
      const from = floor.replies.findIndex(r => r.id === rid);
      const to = floor.replies.findIndex(r => r.id === el.dataset.id);
      if (from < 0 || to < 0) return;
      const [m] = floor.replies.splice(from, 1);
      floor.replies.splice(to, 0, m);
      save(); renderFloors(); renderPreview();
    });
  }

  /* ---------- 预览 ---------- */
  function pinnedPreviewHTML() {
    const p = P.pinned;
    let html = '';
    if (p.op && (p.opTitle || p.opText)) {
      html += `<div class="pv-pin">
        <span class="pv-pin-badge">楼主帖</span>
        <div class="pv-pin-title">${esc(p.opTitle || P.title || '楼主帖')}</div>
        ${p.opText ? `<div class="pv-pin-text">${esc(p.opText)}</div>` : ''}
        <div class="pv-pin-author"><span class="pv-op-tag">楼主</span> ${esc(opAuthorName())}</div></div>`;
    }
    p.notices.forEach(n => {
      if (!n.title && !n.content) return;
      html += `<div class="pv-pin notice">
        <span class="pv-pin-badge">${esc(n.kind || '公告')}</span>
        ${n.title ? `<div class="pv-pin-title">${esc(n.title)}</div>` : ''}
        ${n.content ? `<div class="pv-pin-text">${esc(n.content)}</div>` : ''}</div>`;
    });
    return html;
  }
  function renderPreview() {
    const pv = $('#preview');
    const list = displayFloors();
    if (!list.length && !hasPinned()) { pv.innerHTML = '<p class="empty-tip">预览区</p>'; return; }
    let html = '';
    if (P.title) html += `<div class="p-title">${esc(P.title)}</div>`;
    html += `<div class="p-sub">共 ${list.length} 楼 · 排序：${P.sortMode === 'time' ? '按时间' : '手动'}</div>`;
    html += pinnedPreviewHTML();
    list.forEach((f) => {
      const info = idLabel(f.charId);
      const n = absIndex(f);
      html += `<div class="pv-floor">
        <div class="avatar" style="background:${esc(info.color)}">${esc(info.avatar)}</div>
        <div class="pv-main">
          <div class="pv-top">
            <span class="pv-name">${esc(info.name)}</span>
            ${isOpFloor(f) ? `<span class="pv-op-tag">楼主</span>` : ''}
            <span class="pv-uid">@${esc(info.uid)}</span>
            ${info.title ? `<span class="pv-title-tag">${esc(info.title)}</span>` : ''}
            <span class="pv-time">${esc(f.time || '')} · ${n}F</span>
          </div>
          ${f.content ? `<div class="pv-text">${esc(f.content)}</div>` : ''}
          ${(f.images || []).length ? '<div class="pv-imgs">' + f.images.map(src => `<img src="${src}" alt="">`).join('') + '</div>' : ''}`;
      if (f.replies.length) {
        html += '<div class="pv-replies">';
        f.replies.forEach(r => {
          const ri = idLabel(r.charId);
          const rt = r.toCharId ? idLabel(r.toCharId) : null;
          html += `<div class="pv-reply"><span class="rv-n">${esc(ri.name)}</span>：${rt ? `<span class="rv-to">回复 @${esc(rt.name)}</span> ` : ''}${esc(r.content || '')}`;
          if ((r.images || []).length) html += '<div class="pv-imgs small">' + r.images.map(src => `<img src="${src}" alt="">`).join('') + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div></div>';
    });
    pv.innerHTML = html;
  }

  /* ---------- 导出（一律展开，折叠只是显示层） ---------- */
  function pinnedMarkdown() {
    const p = P.pinned;
    let out = '';
    if (p.op && (p.opTitle || p.opText)) {
      out += `> **【楼主帖】${p.opTitle || P.title || ''}**\n`;
      if (p.opText) out += p.opText.split('\n').map(l => '> ' + l).join('\n') + '\n';
      out += '\n';
    }
    p.notices.forEach(n => {
      if (!n.title && !n.content) return;
      out += `> **【${n.kind || '公告'}】${n.title || ''}**\n`;
      if (n.content) out += n.content.split('\n').map(l => '> ' + l).join('\n') + '\n';
      out += '\n';
    });
    return out;
  }
  function toMarkdown() {
    const list = displayFloors();
    let out = P.title ? `# ${P.title}\n\n` : '';
    out += pinnedMarkdown();
    list.forEach((f) => {
      const info = idLabel(f.charId);
      const meta = [info.uid && info.uid !== 'anonymous' ? '@' + info.uid : '', info.title, f.time || ''].filter(Boolean).join(' · ');
      out += `**${info.name}**${isOpFloor(f) ? '（楼主）' : ''}（${absIndex(f)}F）${meta ? ' — ' + meta : ''}\n\n${f.content || ''}\n`;
      (f.images || []).forEach(src => { out += `\n![图片](${src})\n`; });
      if (f.replies.length) {
        out += '\n> ' + f.replies.map(r => {
          const ri = idLabel(r.charId); const rt = r.toCharId ? idLabel(r.toCharId) : null;
          return `**${ri.name}**${rt ? ` 回复 @${rt.name}` : ''}：${r.content || ''}`;
        }).join('\n> ') + '\n';
      }
      out += '\n---\n\n';
    });
    return out;
  }
  function toBBCode() {
    const list = displayFloors();
    let out = P.title ? `[b]${P.title}[/b]\n\n` : '';
    const p = P.pinned;
    if (p.op && (p.opTitle || p.opText)) {
      out += `[quote][b]【楼主帖】${p.opTitle || P.title || ''}[/b]\n${p.opText || ''}[/quote]\n\n`;
    }
    p.notices.forEach(n => {
      if (!n.title && !n.content) return;
      out += `[quote][b]【${n.kind || '公告'}】${n.title || ''}[/b]\n${n.content || ''}[/quote]\n\n`;
    });
    list.forEach((f) => {
      const info = idLabel(f.charId);
      const meta = [info.uid && info.uid !== 'anonymous' ? '@' + info.uid : '', f.time || ''].filter(Boolean).join(' · ');
      out += `[b]${info.name}[/b]${isOpFloor(f) ? '（楼主）' : ''}（${absIndex(f)}F）${meta}\n${f.content || ''}\n`;
      (f.images || []).forEach(src => { out += `[img]${src}[/img]\n`; });
      if (f.replies.length) {
        out += f.replies.map(r => {
          const ri = idLabel(r.charId); const rt = r.toCharId ? idLabel(r.toCharId) : null;
          return `  [quote][b]${ri.name}[/b]${rt ? ` 回复 @${rt.name}` : ''}：${r.content || ''}[/quote]`;
        }).join('\n') + '\n';
      }
      out += '\n';
    });
    return out;
  }
  function toPlain() {
    const list = displayFloors();
    let out = P.title ? `${P.title}\n${'='.repeat(P.title.length * 2)}\n\n` : '';
    const p = P.pinned;
    if (p.op && (p.opTitle || p.opText)) out += `【楼主帖】${p.opTitle || P.title || ''}\n${p.opText || ''}\n\n`;
    p.notices.forEach(n => {
      if (!n.title && !n.content) return;
      out += `【${n.kind || '公告'}】${n.title || ''}\n${n.content || ''}\n\n`;
    });
    list.forEach((f) => {
      const info = idLabel(f.charId);
      out += `[${absIndex(f)}F] ${info.name}${isOpFloor(f) ? '（楼主）' : ''}${info.uid && info.uid !== 'anonymous' ? ' (@' + info.uid + ')' : ''}  ${f.time || ''}\n${f.content || ''}\n`;
      (f.images || []).forEach(() => { out += '    [图片]\n'; });
      f.replies.forEach(r => {
        const ri = idLabel(r.charId); const rt = r.toCharId ? idLabel(r.toCharId) : null;
        out += `    └ ${ri.name}${rt ? ` 回复 @${rt.name}` : ''}：${r.content || ''}\n`;
      });
      out += '\n';
    });
    return out;
  }
  function toHTMLFile() {
    const list = displayFloors();
    let body = P.title ? `<h1>${esc(P.title)}</h1>` : '';
    const p = P.pinned;
    if (p.op && (p.opTitle || p.opText)) {
      body += `<div class="pin"><span class="pb">楼主帖</span><div class="pt">${esc(p.opTitle || P.title || '')}</div>${
        p.opText ? `<div class="px">${esc(p.opText)}</div>` : ''}</div>`;
    }
    p.notices.forEach(n => {
      if (!n.title && !n.content) return;
      body += `<div class="pin notice"><span class="pb">${esc(n.kind || '公告')}</span>${
        n.title ? `<div class="pt">${esc(n.title)}</div>` : ''}${
        n.content ? `<div class="px">${esc(n.content)}</div>` : ''}</div>`;
    });
    list.forEach((f) => {
      const info = idLabel(f.charId);
      body += `<div class="floor"><div class="av" style="background:${esc(info.color)}">${esc(info.avatar)}</div>
        <div class="m"><div class="hd"><b>${esc(info.name)}</b>${isOpFloor(f) ? '<span class="opt">楼主</span>' : ''}
        <span class="u">@${esc(info.uid)}</span>
        <span class="t">${esc(f.time || '')} · ${absIndex(f)}F</span></div>
        ${f.content ? `<div class="tx">${esc(f.content)}</div>` : ''}
        ${(f.images || []).map(src => `<img class="ph" src="${src}" alt="">`).join('')}`;
      if (f.replies.length) {
        body += '<div class="rp">' + f.replies.map(r => {
          const ri = idLabel(r.charId); const rt = r.toCharId ? idLabel(r.toCharId) : null;
          return `<div><b>${esc(ri.name)}</b>${rt ? ` 回复 @${esc(rt.name)}` : ''}：${esc(r.content || '')}${
            (r.images || []).map(src => `<img class="ph sm" src="${src}" alt="">`).join('')}</div>`;
        }).join('') + '</div>';
      }
      body += '</div></div>';
    });
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(P.title || '论坛体')}</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2329;line-height:1.7}
h1{font-size:20px}.floor{display:flex;gap:10px;padding:12px 0;border-bottom:1px dashed #e3e6ec}
.av{width:36px;height:36px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;flex-shrink:0}
.m{flex:1}.hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.u,.t{color:#8a919f;font-size:12px}
.opt{background:#e5ecff;color:#4a7dff;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px}
.tx{margin-top:4px;white-space:pre-wrap}.ph{max-width:100%;border-radius:8px;margin-top:8px;display:block}
.ph.sm{max-width:280px}.rp{margin-top:8px;background:#f6f8fb;border-radius:7px;padding:8px 10px;font-size:13px}
.pin{border:1px solid #e0e6f2;background:#f8faff;border-radius:8px;padding:10px 12px;margin-bottom:12px}
.pin.notice{background:#fff9f0;border-color:#f2e0c4}
.pin .pb{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:4px;background:#e5ecff;color:#4a7dff;margin-bottom:6px}
.pin.notice .pb{background:#fdeccd;color:#c98a1e}
.pin .pt{font-weight:700;font-size:15px;margin-bottom:4px}
.pin .px{white-space:pre-wrap;font-size:13.5px}</style>
</head><body>${body}</body></html>`;
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function safeName() { return (P.title || '论坛体').replace(/[\\/:*?"<>|]/g, '_'); }
  function exportAs(fmt) {
    if (!P.floors.length) { toast('还没有内容可导出'); return; }
    if (fmt === 'md') download(safeName() + '.md', toMarkdown(), 'text/markdown');
    else if (fmt === 'bbcode') download(safeName() + '.txt', toBBCode(), 'text/plain');
    else if (fmt === 'txt') download(safeName() + '.txt', toPlain(), 'text/plain');
    else if (fmt === 'html') download(safeName() + '.html', toHTMLFile(), 'text/html');
    else if (fmt === 'json') {
      P.app = 'forum-writer'; P.version = 1;
      download(safeName() + '.json', JSON.stringify(P, null, 2), 'application/json');
      toast('已导出存档，可再次导入');
      return;
    }
    else if (fmt === 'copy-md') { copyText(toMarkdown()).then(() => toast('已复制 Markdown'), () => toast('复制失败')); return; }
    else if (fmt === 'copy-txt') { copyText(toPlain()).then(() => toast('已复制纯文本'), () => toast('复制失败')); return; }
    toast('已导出');
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((res, rej) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? res() : rej(new Error('execCommand 失败')); }
      catch (e) { rej(e); }
      finally { document.body.removeChild(ta); }
    });
  }

  /* ---------- 顶栏事件 ---------- */
  function bindTop() {
    $('#workTitle').addEventListener('input', e => { P.title = e.target.value; save(); renderPreview(); });

    $('#btnAddChar').addEventListener('click', () => openCharModal(null));
    $('#btnAddFloor').addEventListener('click', addFloor);

    $('#btnPinToggle').addEventListener('click', () => {
      const p = P.pinned;
      const menuHTML = `<div class="dropdown pin-dd">
        ${pinOpen ? '<a data-act="add">＋ 添加公告</a>' : ''}
        ${p.op ? '' : '<a data-act="add-op">＋ 启用楼主帖</a>'}
        <a data-act="toggle">${pinOpen ? '隐藏置顶区' : '显示置顶区'}</a></div>`;
      const wrap = document.createElement('div');
      wrap.innerHTML = menuHTML;
      const dd = wrap.firstElementChild;
      document.body.appendChild(dd);
      dd.addEventListener('click', e => e.stopPropagation());
      dd.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        const act = a.dataset.act;
        if (act === 'add') { pinOpen = true; addNotice(); }
        else if (act === 'add-op') { p.op = true; pinOpen = true; save(); renderPin(); renderPreview(); }
        else if (act === 'toggle') { pinOpen = !pinOpen; renderPin(); toast(pinOpen ? '已显示置顶区' : '已隐藏置顶区'); }
        dd.remove();
      }));
      const r = $('#btnPinToggle').getBoundingClientRect();
      dd.style.position = 'fixed';
      dd.style.top = (r.bottom + 4) + 'px';
      dd.style.left = Math.max(8, Math.min(r.left, window.innerWidth - dd.offsetWidth - 8)) + 'px';
      dd.style.right = 'auto';
      setTimeout(() => document.addEventListener('click', function h() { dd.remove(); document.removeEventListener('click', h); }), 0);
    });

    $('#btnToggleTime').addEventListener('click', () => {
      P.sortMode = P.sortMode === 'manual' ? 'time' : 'manual';
      $('#btnToggleTime').textContent = '排序：' + (P.sortMode === 'time' ? '按时间' : '手动');
      save(); renderFloors(); renderPreview();
    });

    // 导出下拉
    const menu = $('#exportMenu');
    $('#btnExport').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('hidden'); });
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      exportAs(a.dataset.fmt); menu.classList.add('hidden');
    }));
    document.addEventListener('click', () => menu.classList.add('hidden'));

    $('#btnCopy').addEventListener('click', () => {
      copyText(toMarkdown()).then(() => toast('已复制全文（Markdown）'), () => toast('复制失败'));
    });

    // 新建
    $('#btnNew').addEventListener('click', () => {
      if (!confirm('新建将清空当前作品（建议先导出存档）。继续？')) return;
      P = blank(); save(); renderAll();
    });

    // 角色弹窗
    $('#btnRand').addEventListener('click', fillRandomChar);
    $('#cCancel').addEventListener('click', () => $('#charModal').classList.add('hidden'));
    $('#cSave').addEventListener('click', saveChar);
    $('#charModal').addEventListener('click', e => { if (e.target.id === 'charModal') $('#charModal').classList.add('hidden'); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('#charModal').classList.add('hidden'); $('#setModal').classList.add('hidden'); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !$('#charModal').classList.contains('hidden')) saveChar();
    });

    // 导入按钮
    $('#btnImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) readArchive(file);
      e.target.value = '';
    });

    // 设置：词库
    $('#btnSettings').addEventListener('click', openSettings);
    $('#setCancel').addEventListener('click', () => $('#setModal').classList.add('hidden'));
    $('#setSave').addEventListener('click', saveSettings);
    $('#setReset').addEventListener('click', () => {
      if (!confirm('恢复默认词库？当前编辑的词库将被覆盖。')) return;
      fillLexForm(defaultLex());
    });
    $('#setModal').addEventListener('click', e => { if (e.target.id === 'setModal') $('#setModal').classList.add('hidden'); });

    // 支持导入存档：拖 json 到窗口
    document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith('.json')) return;
      e.preventDefault();
      readArchive(file);
    });
  }

  const LEX_FIELDS = ['pre', 'mid', 'suf', 'nb', 'title', 'uidPre'];
  function openSettings() {
    fillLexForm(P.lex);
    $('#setTimeStep').value = P.timeStep;
    $('#setReplyFold').value = P.replyCollapseAt;
    $('#setImgMaxW').value = P.imgMaxW;
    $('#setNewFloorChar').value = P.newFloorChar || 'first';
    $('#setBatchChar').value = P.batchChar || 'random';
    $('#setModal').classList.remove('hidden');
  }
  function fillLexForm(lex) {
    LEX_FIELDS.forEach(k => { $('#lex_' + k).value = (lex[k] || []).join('\n'); });
  }
  function saveSettings() {
    const lex = {};
    LEX_FIELDS.forEach(k => {
      const arr = $('#lex_' + k).value.split('\n').map(s => s.trim()).filter(Boolean);
      lex[k] = arr.length ? arr : defaultLex()[k];
    });
    P.lex = lex;
    const step = parseInt($('#setTimeStep').value, 10);
    P.timeStep = (isFinite(step) && step >= 0) ? step : 2;
    const rf = parseInt($('#setReplyFold').value, 10);
    P.replyCollapseAt = (isFinite(rf) && rf >= 1) ? rf : 3;
    const iw = parseInt($('#setImgMaxW').value, 10);
    P.imgMaxW = (isFinite(iw) && iw >= 120) ? iw : 640;
    const nfc = $('#setNewFloorChar').value;
    P.newFloorChar = ['none', 'first', 'last', 'random'].includes(nfc) ? nfc : 'first';
    const bc = $('#setBatchChar').value;
    P.batchChar = ['random', 'distinct', 'same'].includes(bc) ? bc : 'random';
    save(); $('#setModal').classList.add('hidden'); renderFloors(); renderPreview(); toast('设置已保存');
  }

  function readArchive(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        P = adoptProject(reader.result);
        save(); renderAll(); toast('已导入「' + (P.title || '未命名') + '」');
      } catch (err) { toast('导入失败：' + err.message); }
    };
    reader.readAsText(file);
  }

  /* ---------- 示例数据（首次打开） ---------- */
  function seedIfEmpty() {
    if (P.floors.length || P.chars.length) return;
    const c1 = { id: uid('c'), name: '江湖夜雨十年灯', uid: 'yu_8899', avatar: '夜', color: '#5b8def', title: 'LV.7 常驻居民', note: '老楼主，语气稳重' };
    const c2 = { id: uid('c'), name: '吃瓜第一线', uid: 'melon_233', avatar: '瓜', color: '#e0654c', title: 'LV.3 潜水员', note: '爱吐槽，短句' };
    const c3 = { id: uid('c'), name: '我是分析帝', uid: 'analyst_01', avatar: '析', color: '#3bab8a', title: 'LV.9 版主', note: '长篇分析，爱用序号' };
    P.chars = [c1, c2, c3];
    P.title = '【求助】有没有人遇到过这种情况？';
    P.opFloorId = '';
    P.pinned = {
      op: true,
      opTitle: '【求助】有没有人遇到过这种情况？',
      opText: '楼主：事情是这样的……在线等，挺急的。\n补充：已在楼下贴图，麻烦大家帮忙看看。',
      notices: [
        { id: uid('n'), kind: '版规', title: '本版发帖须知', content: '禁止水帖、人身攻击；求助帖请补充时间地点与截图。' },
      ],
    };
    P.floors = [
      { id: uid('f'), charId: c1.id, time: nowTime(0), content: '事情是这样的……在线等，挺急的。', replies: [
        { id: uid('r'), charId: c2.id, toCharId: '', content: '沙发！先占楼' },
        { id: uid('r'), charId: c3.id, toCharId: c1.id, content: '1. 先说清时间地点\n2. 有没有截图？' },
      ] },
      { id: uid('f'), charId: c2.id, time: nowTime(3), content: '蹲一个后续，感觉有大瓜', replies: [] },
    ];
    save();
  }

  /* ---------- 启动 ---------- */
  function renderAll() {
    $('#workTitle').value = P.title || '';
    $('#btnToggleTime').textContent = '排序：' + (P.sortMode === 'time' ? '按时间' : '手动');
    renderChars(); renderPin(); renderFloors(); renderPreview();
  }
  seedIfEmpty();
  bindTop();
  renderAll();
})();
