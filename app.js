/* 论坛体写作助手 —— 核心逻辑 */
(() => {
  'use strict';

  const LS_KEY = 'forum-writer-project-v1';
  const LS_BACKUP = 'forum-writer-backup-v1';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const PALETTE = ['#5b8def', '#e0654c', '#3bab8a', '#b06ad6', '#e8a53c', '#5d6b8a', '#d45d92', '#4aa3c7'];

  /* ---------- 数据模型 ---------- */
  // 容器（存进 localStorage 的整体）
  // forum = { app:'forum-writer', container:2, rootId, posts:[Post], ui:{startView, mode, activePostId} }
  // Post  = { id, title, code, boardId, tags, createdAt, updatedAt, views, locked, mod, relatedIds,
  //           sortMode, chars, floors, opFloorId, pinned, lex, timeStep, replyCollapseAt, imgMaxW }
  // Char  = { id, name, uid, avatar, color, title, note, anon, op,
  //           mod:{tag, note, warn, banned} }   // mod 仅管理视图可见，匿名角色也能看到真名
  let F = load();               // 容器
  let P = null;                 // 当前编辑的帖子（F.posts 里的引用，不是副本）
  let view = 'editor';          // 'editor' | 'admin'


  function uid(p = 'id') {
    return p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  // 空帖子（写作层的最小单元）
  function blankPost(title = '') {
    return {
      id: uid('p'),
      title,
      code: '',                                  // 版块内编号，展示为 #01
      boardId: '',
      tags: [],
      createdAt: nowTime(),
      updatedAt: nowTime(),
      views: 0,
      locked: false,
      mod: { status: '', highlight: false, lockNote: '' },   // status: '' | '置顶' | '精华' | '归档'
      relatedIds: [],
      app: 'forum-writer', version: 2,
      sortMode: 'manual',
      chars: [], floors: [],
      opFloorId: '',
      pinned: { op: true, opText: '', notices: [] },
      lex: defaultLex(),
      timeStep: 2,
      replyCollapseAt: 3,
      imgMaxW: 640,
      newFloorChar: 'first',
      batchChar: 'random',
    };
  }
  // 空容器
  function blankForum() {
    const p = blankPost('');
    return {
      app: 'forum-writer', version: 1, container: 2,
      rootId: p.id,
      posts: [p],
      boards: defaultBoards(),
      ui: { startView: 'editor', mode: 'editor', activePostId: p.id },
    };
  }
  function defaultBoards() {
    return [
      { id: 'b_chat', name: '灌水闲聊' },
      { id: 'b_help', name: '求助问答' },
      { id: 'b_story', name: '故事连载' },
      { id: 'b_review', name: '作品点评' },
      { id: 'b_other', name: '其他' },
    ];
  }
  function normalizeBoards(list) {
    if (!Array.isArray(list) || !list.length) return defaultBoards();
    const out = list.map((b, i) => (typeof b === 'string'
      ? { id: 'b_' + i, name: b }
      : { id: b && b.id ? String(b.id) : 'b_' + i, name: (b && b.name) ? String(b.name) : '未命名版块' }));
    return out.length ? out : defaultBoards();
  }

  // 读取容器：兼容 v1 单帖存档，自动迁移并留备份
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { /* 忽略 */ }
    if (!raw) return blankForum();
    try { return adoptForum(JSON.parse(raw), { backupRaw: raw }); }
    catch (e) { return blankForum(); }
  }
  // 把任意形态的数据（容器 / 单帖 / 裸对象）还原成容器
  function adoptForum(raw, opts = {}) {
    let data;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); }
      catch (e) {
        // 不是 JSON：当作纯文本，一个帖子兜底
        data = { title: '', chars: [], floors: [{ id: uid('f'), charId: '', content: raw, time: nowTime(), replies: [] }] };
      }
    } else data = raw;
    if (!data || typeof data !== 'object') throw new Error('文件里没有可识别的内容');

    let posts;
    if (Array.isArray(data.posts) && data.posts.length) posts = data.posts.map(adoptPost);
    else if (Array.isArray(data.floors)) {
      // v1 单帖存档 → 迁移成容器里的第一个帖子，原数据留一份备份
      if (opts.backupRaw) {
        try { localStorage.setItem(LS_BACKUP, opts.backupRaw); } catch (e) { /* 忽略 */ }
      }
      posts = [adoptPost(data)];
    } else throw new Error('文件里没有楼层数据');

    const boards = normalizeBoards(data.boards);
    const boardIds = new Set(boards.map(b => b.id));
    posts.forEach(p => { if (!boardIds.has(p.boardId)) p.boardId = boards[0].id; });

    const ui = Object.assign({ startView: 'editor', mode: 'editor', activePostId: '' }, data.ui || {});
    if (!['editor', 'admin'].includes(ui.startView)) ui.startView = 'editor';
    if (!['editor', 'admin'].includes(ui.mode)) ui.mode = 'editor';
    const rootId = posts.some(p => p.id === data.rootId) ? data.rootId : posts[0].id;
    if (!posts.some(p => p.id === ui.activePostId)) ui.activePostId = rootId;

    return {
      app: 'forum-writer', version: 1, container: 2,
      rootId, posts, boards, ui,
    };
  }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
  function str(v, def) { return typeof v === 'string' ? v : (def === undefined ? '' : def); }
  // 把存档里的一条帖子补全成规范结构（旧单帖存档直接喂进来也安全）
  function adoptPost(raw) {
    const p = Object.assign(blankPost(''), raw || {});
    p.id = str(raw && raw.id) || uid('p');
    p.title = str(raw && raw.title);
    p.code = str(raw && raw.code);
    p.boardId = str(raw && raw.boardId);
    p.tags = (Array.isArray(raw && raw.tags) ? raw.tags : []).map(t => String(t).trim()).filter(Boolean).slice(0, 8);
    p.createdAt = str(raw && raw.createdAt) || nowTime();
    p.updatedAt = str(raw && raw.updatedAt) || p.createdAt;
    p.views = Math.max(0, Math.floor(num(raw && raw.views, 0)));
    p.locked = !!(raw && raw.locked);
    const m = (raw && raw.mod) || {};
    p.mod = {
      status: ['', '置顶', '精华', '归档'].includes(m.status) ? m.status : '',
      highlight: !!m.highlight,
      lockNote: str(m.lockNote),
    };
    p.chars = (Array.isArray(raw && raw.chars) ? raw.chars : []).map(c => Object.assign(
      { id: uid('c'), name: '未命名', uid: '', avatar: '', color: PALETTE[0], title: '', note: '', anon: false, op: false },
      c,
      {
        id: str(c && c.id) || uid('c'),
        anon: !!(c && c.anon),
        op: !!(c && c.op),
        mod: {
          tag: str(c && c.mod && c.mod.tag),
          note: str(c && c.mod && c.mod.note),
          warn: !!(c && c.mod && c.mod.warn),
          banned: !!(c && c.mod && c.mod.banned),
        },
      }));
    const charIds = new Set(p.chars.map(c => c.id));
    p.floors = (Array.isArray(raw && raw.floors) ? raw.floors : []).map(f => Object.assign(
      { id: uid('f'), charId: '', content: '', time: nowTime(), replies: [], images: [], collapsed: false }, f,
      {
        images: Array.isArray(f && f.images) ? f.images : [],
        collapsed: !!(f && f.collapsed),
        replies: (Array.isArray(f && f.replies) ? f.replies : []).map(r => Object.assign(
          { id: uid('r'), charId: '', toCharId: '', content: '', images: [] }, r,
          { images: Array.isArray(r && r.images) ? r.images : [] })),
      }));
    // 允许悬空引用（渲染层有兜底），这里只做去重
    void charIds;
    p.lex = normalizeLex(p.lex);
    p.pinned = normalizePinned(p.pinned);
    p.sortMode = p.sortMode === 'time' ? 'time' : 'manual';
    p.timeStep = Math.max(0, num(p.timeStep, 2));
    p.replyCollapseAt = Math.max(1, num(p.replyCollapseAt, 3));
    p.imgMaxW = Math.max(120, num(p.imgMaxW, 640));
    p.opFloorId = str(p.opFloorId);
    if (!['none', 'first', 'last', 'random'].includes(p.newFloorChar)) p.newFloorChar = 'first';
    if (!['random', 'distinct', 'same'].includes(p.batchChar)) p.batchChar = 'random';
    p.relatedIds = (Array.isArray(raw && raw.relatedIds) ? raw.relatedIds : []).filter(x => typeof x === 'string');
    return p;
  }
  function postById(id) { return F.posts.find(p => p.id === id) || null; }
  function activePost() { return postById(F.ui.activePostId) || F.posts[0]; }
  function boardName(id) { const b = F.boards.find(b => b.id === id); return b ? b.name : '未分版'; }
  function shortTime(str_) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(str_ || '');
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : (str_ || '');
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
  let saveTimer = null;
  function save() {
    if (P) P.updatedAt = nowTime();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(F)); }
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
      color: randomColor(), title: pick(lexOf('title')), note: '', anon: false, op: false,
      mod: { tag: '', note: '', warn: false, banned: false },
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
    else P.chars.push(Object.assign({ id: uid('c'), mod: { tag: '', note: '', warn: false, banned: false } }, data));
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
  function postMetaHTML() {
    const chips = [];
    const b = boardName(P.boardId);
    if (b) chips.push(`<span class="p-badge board">${esc(b)}</span>`);
    (P.tags || []).forEach(t => { if (t) chips.push(`<span class="p-badge tag">${esc(t)}</span>`); });
    const m = P.mod || {};
    if (P.locked) chips.push('<span class="p-badge lock">🔒 已锁定</span>');
    if (m.highlight) chips.push('<span class="p-badge good">✦ 精华</span>');
    if (m.status) chips.push(`<span class="p-badge status">${esc(m.status)}</span>`);
    const rel = (P.relatedIds || []).map(id => F.posts.find(x => x.id === id)).filter(Boolean);
    if (rel.length) {
      chips.push(rel.map(r => `<span class="p-related">🔗 ${esc(r.title || r.code || '未命名')}</span>`).join(''));
    }
    if (!chips.length) return '';
    return `<div class="p-badge-row">${chips.join('')}</div>`;
  }
  function renderPreview() {
    const pv = $('#preview');
    const list = displayFloors();
    if (!list.length && !hasPinned()) { pv.innerHTML = '<p class="empty-tip">预览区</p>'; return; }
    let html = '';
    if (P.title) html += `<div class="p-title">${esc(P.title)}</div>`;
    html += postMetaHTML();
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
  function safeForumName() {
    const t = (F.posts.length === 1 ? P.title : '') || '论坛存档';
    return t.replace(/[\\/:*?"<>|]/g, '_');
  }
  // 存档：整个容器（多帖 + 版块 + 角色备注），可再导入
  function exportArchive() {
    F.app = 'forum-writer'; F.version = 1; F.container = 2;
    download(safeForumName() + '.json', JSON.stringify(F, null, 2), 'application/json');
    toast(`已导出存档（${F.posts.length} 个帖子），可再次导入`);
  }
  function exportAs(fmt) {
    if (!P.floors.length) { toast('还没有内容可导出'); return; }
    if (fmt === 'md') download(safeName() + '.md', toMarkdown(), 'text/markdown');
    else if (fmt === 'bbcode') download(safeName() + '.txt', toBBCode(), 'text/plain');
    else if (fmt === 'txt') download(safeName() + '.txt', toPlain(), 'text/plain');
    else if (fmt === 'html') download(safeName() + '.html', toHTMLFile(), 'text/html');
    else if (fmt === 'json') { exportArchive(); return; }
    else if (fmt === 'post-json') {
      P.app = 'forum-writer'; P.version = 2;
      download(safeName() + '.json', JSON.stringify(P, null, 2), 'application/json');
      toast('已导出当前帖子存档，可导入为新区块');
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

    // 视图切换
    $('#btnToAdmin').addEventListener('click', () => setView('admin'));
    $('#btnAbout').addEventListener('click', openAbout);
    $('#abClose').addEventListener('click', () => $('#aboutModal').classList.add('hidden'));
    $('#aboutModal').addEventListener('click', e => { if (e.target.id === 'aboutModal') $('#aboutModal').classList.add('hidden'); });

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
      if (!confirm('新建将清空当前所有帖子与角色（建议先导出存档）。继续？')) return;
      F = blankForum();
      P = F.posts[0];
      save(); renderAll(); toast('已新建空存档');
    });

    // 角色弹窗
    $('#btnRand').addEventListener('click', fillRandomChar);
    $('#cCancel').addEventListener('click', () => $('#charModal').classList.add('hidden'));
    $('#cSave').addEventListener('click', saveChar);
    $('#charModal').addEventListener('click', e => { if (e.target.id === 'charModal') $('#charModal').classList.add('hidden'); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('#charModal').classList.add('hidden'); $('#setModal').classList.add('hidden'); $('#aboutModal').classList.add('hidden'); }
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
    $('#setStartView').value = F.ui.startView || 'editor';
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
    F.ui.startView = $('#setStartView').value === 'admin' ? 'admin' : 'editor';
    save(); $('#setModal').classList.add('hidden'); renderFloors(); renderPreview(); toast('设置已保存');
  }

  // 导入：容器存档合并进来；单帖存档追加为一个新帖子
  function readArchive(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = reader.result;
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.posts) && data.posts.length) {
          const incoming = adoptForum(jsonClone(data));
          const idMap = remapPostIds(incoming.posts);
          incoming.posts.forEach(p => F.posts.push(p));
          // relatedIds 里的旧 id 重映射到新 id，指不到就丢掉
          incoming.posts.forEach(p => {
            p.relatedIds = p.relatedIds.map(x => idMap.get(x)).filter(x => x && postById(x));
          });
          incoming.boards.forEach(b => { if (!F.boards.some(x => x.id === b.id)) F.boards.push(b); });
          save(); renderAll();
          toast(`已导入 ${incoming.posts.length} 个帖子，已合并到当前存档`);
          return;
        }
        // 单帖（含 v1 旧存档）
        const post = adoptPost(jsonClone(data));
        post.id = uid('p');
        post.relatedIds = [];
        renameCollidingChars(post);
        F.posts.push(post);
        F.ui.activePostId = post.id;
        save(); openPost(post.id);
        toast('已导入「' + (post.title || '未命名') + '」');
      } catch (err) { toast('导入失败：' + err.message); }
    };
    reader.readAsText(file);
  }
  function jsonClone(v) { return JSON.parse(JSON.stringify(v)); }
  // 生成 旧 id → 新 id 的映射（导入整份存档时用）
  function remapPostIds(posts) {
    const map = new Map();
    posts.forEach(p => { const old = p.id; p.id = uid('p'); map.set(old, p.id); });
    return map;
  }
  // 单帖导入：角色 id 与现有角色冲突时换新 id，并改写楼层引用，避免串味
  function renameCollidingChars(post) {
    const used = new Set(F.posts.flatMap(p => p.chars.map(c => c.id)));
    const map = new Map();
    post.chars.forEach(c => {
      if (!used.has(c.id)) return;
      const nid = uid('c');
      map.set(c.id, nid);
      c.id = nid;
    });
    if (!map.size) return;
    post.floors.forEach(f => {
      if (map.has(f.charId)) f.charId = map.get(f.charId);
      f.replies.forEach(r => {
        if (map.has(r.charId)) r.charId = map.get(r.charId);
        if (map.has(r.toCharId)) r.toCharId = map.get(r.toCharId);
      });
    });
  }

  /* ---------- 示例数据（首次打开） ---------- */
  let seedPending = false;
  function seedIfEmpty() { seedPending = !F.posts.some(p => p.floors.length || p.chars.length); }
  function seedDemoPost() {
    if (!seedPending || !F.posts.length) return;
    seedPending = false;
    const p = F.posts[0];
    p.title = '【求助】有没有人遇到过这种情况？';
    p.boardId = 'b_help';
    p.tags = ['求助', '在线等'];
    p.code = '001';
    p.opFloorId = '';
    p.createdAt = nowTime(-26 * 60);
    const c1 = { id: uid('c'), name: '江湖夜雨十年灯', uid: 'yu_8899', avatar: '夜', color: '#5b8def', title: 'LV.7 常驻居民', note: '老楼主，语气稳重', anon: false, op: true };
    const c2 = { id: uid('c'), name: '吃瓜第一线', uid: 'melon_233', avatar: '瓜', color: '#e0654c', title: 'LV.3 潜水员', note: '爱吐槽，短句' };
    const c3 = { id: uid('c'), name: '我是分析帝', uid: 'analyst_01', avatar: '析', color: '#3bab8a', title: 'LV.9 版主', note: '长篇分析，爱用序号' };
    p.chars = [c1, c2, c3].map(c => Object.assign({ op: false, anon: false, note: '', mod: { tag: '', note: '', warn: false, banned: false } }, c));
    p.pinned = {
      op: true,
      opTitle: '【求助】有没有人遇到过这种情况？',
      opText: '楼主：事情是这样的……在线等，挺急的。\n补充：已在楼下贴图，麻烦大家帮忙看看。',
      notices: [
        { id: uid('n'), kind: '版规', title: '本版发帖须知', content: '禁止水帖、人身攻击；求助帖请补充时间地点与截图。' },
      ],
    };
    p.floors = [
      { id: uid('f'), charId: c1.id, time: nowTime(-26 * 60), content: '事情是这样的……在线等，挺急的。', replies: [
        { id: uid('r'), charId: c2.id, toCharId: '', content: '沙发！先占楼' },
        { id: uid('r'), charId: c3.id, toCharId: c1.id, content: '1. 先说清时间地点\n2. 有没有截图？' },
      ] },
      { id: uid('f'), charId: c2.id, time: nowTime(-26 * 60 + 3), content: '蹲一个后续，感觉有大瓜', replies: [] },
    ];
  }
  // 初始渲染时按需注入示例数据：只在用户什么都没写时才填，
  // 避免「点进管理视图 → 依赖渲染抛出 null → 控制台报错」的连锁问题
  function ensureSeed() {
    if (!seedPending) return;
    if (F.posts.some(p => p.floors.length)) { seedPending = false; return; }
    seedDemoPost();
    save();
  }

  /* ---------- 管理视图（版主后台） ---------- */
  let adminTab = 'posts';
  let adminBoardFilter = '';
  let adminUserQuery = '';
  let lastTabClick = { key: '', at: 0 };

  function bindAdmin() {
    $('#btnBackAdmin').addEventListener('click', () => setView('admin'));
    $('#btnToEditor2').addEventListener('click', () => setView('editor'));
    $('#btnAdminNewPost').addEventListener('click', () => createPost());
    $('#relCancel').addEventListener('click', () => $('#relatedModal').classList.add('hidden'));
    $('#relSave').addEventListener('click', saveRelated);
    $('#relatedModal').addEventListener('click', e => { if (e.target.id === 'relatedModal') $('#relatedModal').classList.add('hidden'); });
    $$('.admin-tab').forEach(b => b.addEventListener('click', () => {
      adminTab = b.dataset.tab;
      syncAdminTabs();
      renderAdmin();
    }));
    const am = $('#adminExportMenu');
    $('#btnExportAdmin').addEventListener('click', e => { e.stopPropagation(); am.classList.toggle('hidden'); });
    am.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      const fmt = a.dataset.fmt;
      am.classList.add('hidden');
      if (fmt === 'json') exportArchive();
      else if (fmt === 'adj-json') exportAdjacency();
      else if (fmt === 'md') exportAs('md');
    }));
    document.addEventListener('click', () => am.classList.add('hidden'));
  }
  // 目录导出：只留标题 / 版块 / 标签 / 关联，方便用文本编辑器规划长篇结构
  function exportAdjacency() {
    const data = {
      app: 'forum-writer', kind: 'outline', version: 1,
      boards: F.boards,
      posts: displayPosts().map(p => ({
        code: p.code, title: p.title, board: boardName(p.boardId), tags: p.tags,
        floors: p.floors.length, replies: p.floors.reduce((s, f) => s + f.replies.length, 0),
        related: p.relatedIds.map(id => { const q = postById(id); return q ? q.title : null; }).filter(Boolean),
      })),
    };
    download(safeForumName() + '-目录.json', JSON.stringify(data, null, 2), 'application/json');
    toast('已导出目录（可再导入的存档请用「导出存档」）');
  }

  function renderAdmin() {
    const totalFloors = F.posts.reduce((s, p) => s + p.floors.length, 0);
    const totalChars = F.posts.reduce((s, p) => s + p.chars.length, 0);
    $('#adminSub').textContent = `${F.posts.length} 帖 · ${totalFloors} 楼 · ${totalChars} 个角色`;
    if (adminTab === 'posts') renderAdminPosts();
    else if (adminTab === 'users') renderAdminUsers();
    else renderAdminBoards();
  }

  function displayPosts() {
    return [...F.posts].sort((a, b) => {
      const rank = p => (p.mod.status === '置顶' ? 0 : p.id === F.rootId ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }

  function postRowHTML(p) {
    const dis = p === P ? '' : ' disabled';
    const op = p.chars.find(c => c.op);
    return `<div class="post-row${p === P ? ' is-active' : ''}" data-id="${p.id}">
      <div class="pr-main">
        <div class="pr-title">
          ${p.mod.status ? `<span class="badge ${p.mod.status === '置顶' ? 'hot' : p.mod.status === '精华' ? 'good' : ''}">${esc(p.mod.status)}</span>` : ''}
          ${p.mod.highlight ? '<span class="badge star">高亮</span>' : ''}
          ${p.id === F.rootId ? '<span class="badge root">主帖</span>' : ''}
          <input class="pr-title-in" data-act="title" value="${esc(p.title)}" placeholder="（未命名帖子）">
        </div>
        <div class="pr-meta">
          <span class="tag-chip">${esc(boardName(p.boardId))}</span>
          ${p.tags.map(t => `<span class="tag-chip tag-minor">${esc(t)}</span>`).join('')}
          <span class="pr-num">${p.floors.length} 楼 / ${p.floors.reduce((s, f) => s + f.replies.length, 0)} 回复</span>
          <span class="pr-num">${p.chars.length} 角色</span>
          <span class="pr-num">更新 ${esc(shortTime(p.updatedAt))}</span>
        </div>
      </div>
      <div class="pr-side">
        <label class="mini-field">编号<input data-act="code" value="${esc(p.code)}" placeholder="001"></label>
        <label class="mini-field">版块<select data-act="board">${F.boards.map(b =>
          `<option value="${esc(b.id)}"${b.id === p.boardId ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        <label class="mini-field wide">标签<input data-act="tags" value="${esc(p.tags.join(' '))}" placeholder="用空格分隔"></label>
        <label class="mini-field">状态<select data-act="status">${['', '置顶', '精华', '归档'].map(s =>
          `<option value="${s}"${s === p.mod.status ? ' selected' : ''}>${s || '普通'}</option>`).join('')}</select></label>
      </div>
      <div class="pr-ops">
        <button class="btn mini" data-act="open"${dis} title="${dis ? '当前正在写这一帖' : '用写作界面打开这一帖'}">✍️ 写这篇</button>
        <button class="btn mini ghost" data-act="related" title="设置相关帖子（用于目录内互链）">🔗 相关 ${p.relatedIds.length || ''}</button>
        <button class="btn mini ghost" data-act="standalone" title="把这一帖导出为单帖存档，方便单独分享">单独导出</button>
        <button class="btn mini ghost" data-act="lock" title="锁帖：锁上后写作界面只读，防止误改">${p.locked ? '🔒 已锁' : '🔓 锁帖'}</button>
        <button class="btn mini ghost" data-act="dup" title="复制这一帖">复制</button>
        <button class="btn mini ghost" data-act="root" title="标记为主帖">${p.id === F.rootId ? '★ 主帖' : '☆ 设主帖'}</button>
        <button class="btn mini ghost" data-act="del">删除</button>
      </div>
    </div>`;
  }

  function renderAdminPosts() {
    const box = $('#adminTabPosts');
    const list = displayPosts().filter(p => !adminBoardFilter || p.boardId === adminBoardFilter);
    const chips = [`<button class="chip${adminBoardFilter ? '' : ' active'}" data-board="">全部 ${F.posts.length}</button>`]
      .concat(F.boards.map(b => {
        const n = F.posts.filter(p => p.boardId === b.id).length;
        return `<button class="chip${adminBoardFilter === b.id ? ' active' : ''}" data-board="${b.id}">${esc(b.name)} ${n}</button>`;
      })).join('');
    box.innerHTML = `
      <div class="admin-toolbar">${chips}
        <span class="admin-spacer"></span>
        <span class="hint-inline">标注「主帖」的那篇就是长篇正文，其余帖子可以当番外、废稿或目录占位</span>
      </div>
      <div class="post-list">${list.length ? list.map(postRowHTML).join('') : '<p class="empty-tip">这个版块下还没有帖子。</p>'}</div>`;

    box.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      adminBoardFilter = c.dataset.board;
      renderAdmin();
    }));
    box.querySelectorAll('[data-act="title"]').forEach(inp => {
      inp.addEventListener('input', () => { const p = postById(inp.closest('.post-row').dataset.id); p.title = inp.value; save(); });
      inp.addEventListener('change', () => renderAdmin());
    });
    box.querySelectorAll('[data-act="code"]').forEach(inp => inp.addEventListener('input', () => {
      postById(inp.closest('.post-row').dataset.id).code = inp.value.trim(); save();
    }));
    box.querySelectorAll('[data-act="tags"]').forEach(inp => inp.addEventListener('change', () => {
      const p = postById(inp.closest('.post-row').dataset.id);
      p.tags = inp.value.split(/[\s,，]+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
      save(); renderAdmin();
    }));
    box.querySelectorAll('[data-act="board"]').forEach(sel => sel.addEventListener('change', () => {
      postById(sel.closest('.post-row').dataset.id).boardId = sel.value; save(); renderAdmin();
    }));
    box.querySelectorAll('[data-act="status"]').forEach(sel => sel.addEventListener('change', () => {
      postById(sel.closest('.post-row').dataset.id).mod.status = sel.value; save(); renderAdmin();
    }));
    box.querySelectorAll('.post-row').forEach(row => {
      const p = postById(row.dataset.id);
      row.querySelectorAll('.pr-ops [data-act]').forEach(b => b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'open') openFromAdmin(p.id);
        else if (act === 'standalone') exportPostStandalone(p.id);
        else if (act === 'related') openRelatedModal(p.id);
        else if (act === 'del') deletePost(p.id);
        else if (act === 'dup') { const c = duplicatePost(p.id); save(); renderAdmin(); toast('已复制为「' + c.title + '」'); }
        else if (act === 'root') { F.rootId = p.id; save(); renderAdmin(); toast('已标记为主帖'); }
        else if (act === 'lock') { p.locked = !p.locked; save(); renderAdmin(); toast(p.locked ? '已锁帖' : '已解锁'); if (p === P) applyLockState(); }
      }));
      // 双击标题行 → 直接开始写这一帖
      row.addEventListener('dblclick', e => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') openFromAdmin(p.id); });
    });
  }

  function openFromAdmin(id) {
    const p = postById(id);
    if (!p || p.locked) { toast('这一帖已锁，先解锁再写'); return; }
    openPost(id);
  }
  function exportPostStandalone(id) {
    const p = postById(id);
    const data = jsonClone(p);
    data.app = 'forum-writer'; data.version = 2;
    const name = (p.title || '帖子').replace(/[\\/:*?"<>|]/g, '_');
    download(name + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('已单独导出这一帖，可再次导入');
  }
  function duplicatePost(id) {
    const src = postById(id);
    const c = adoptPost(jsonClone(src));
    c.id = uid('p');
    c.title = (src.title || '未命名') + '（副本）';
    c.code = '';
    c.mod = { status: '', highlight: false, lockNote: '' };
    c.createdAt = c.updatedAt = nowTime();
    renameCollidingChars(c);
    F.posts.push(c);
    return c;
  }
  function createPost(title = '') {
    const p = blankPost(title);
    p.boardId = (F.boards[0] || { id: '' }).id;
    p.relatedIds = [];
    F.posts.push(p);
    save(); adminTab = 'posts'; syncAdminTabs(); renderAdmin();
    toast('已新建帖子，点「✍️ 写这篇」开始');
    return p;
  }
  function syncAdminTabs() {
    $$('.admin-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === adminTab));
    $('#adminTabPosts').classList.toggle('hidden', adminTab !== 'posts');
    $('#adminTabUsers').classList.toggle('hidden', adminTab !== 'users');
    $('#adminTabBoards').classList.toggle('hidden', adminTab !== 'boards');
  }
  // 双击确认：第一次点只是提示，两秒内再点一次才真的删
  function needConfirm(key, msg) {
    const now = Date.now();
    if (lastTabClick.key === key && now - lastTabClick.at < 2500) { lastTabClick = { key: '', at: 0 }; return true; }
    lastTabClick = { key, at: now };
    toast(msg);
    return false;
  }
  function deletePost(id) {
    if (F.posts.length <= 1) { toast('至少要保留一个帖子'); return; }
    const p = postById(id);
    F.posts = F.posts.filter(x => x.id !== id);
    F.posts.forEach(x => { x.relatedIds = x.relatedIds.filter(r => r !== id); });
    if (F.rootId === id) F.rootId = F.posts[0].id;
    if (F.ui.activePostId === id) { F.ui.activePostId = F.posts[0].id; P = F.posts[0]; }
    save(); renderAdmin(); toast(`已删除「${p.title || '未命名'}」`);
  }

  /* 相关帖子（目录内互链） */
  let relatedPostId = null;
  function openRelatedModal(id) {
    relatedPostId = id;
    const p = postById(id);
    $('#relTitle').textContent = '相关帖子 —— ' + (p.title || '未命名');
    const others = F.posts.filter(x => x.id !== id);
    $('#relList').innerHTML = others.length ? others.map(x =>
      `<label class="rel-item"><input type="checkbox" value="${x.id}"${p.relatedIds.includes(x.id) ? ' checked' : ''}>
        <span>${esc(x.title || '（未命名）')}</span><span class="rel-board">${esc(boardName(x.boardId))}</span></label>`).join('')
      : '<p class="empty-tip">还没有别的帖子可以关联。</p>';
    $('#relatedModal').classList.remove('hidden');
  }
  function saveRelated() {
    const p = postById(relatedPostId);
    if (!p) return;
    p.relatedIds = $$('#relList input:checked').map(i => i.value).filter(x => x !== p.id && postById(x));
    save(); $('#relatedModal').classList.add('hidden'); renderAdmin();
    toast('已保存相关帖子' + (p.relatedIds.length ? `（${p.relatedIds.length} 条）` : ''));
  }

  /* 用户总览：跨帖的角色列表，匿名也能看到真名（这是版主视角才有的） */
  function charKey(c) { return (c.uid || '').trim() || ('name:' + (c.name || '').trim()); }
  function collectAllChars() {
    const map = new Map();
    F.posts.forEach(p => p.chars.forEach(c => {
      const key = charKey(c);
      let e = map.get(key);
      if (!e) {
        e = {
          key, name: c.name, uid: c.uid, avatar: c.avatar, color: c.color, title: c.title, note: c.note,
          anon: !!c.anon, op: false, mod: { tag: '', note: '', warn: false, banned: false },
          posts: [], floors: 0, replies: 0, last: '',
        };
        map.set(key, e);
      }
      e.op = e.op || !!c.op;
      if (!e.avatar && c.avatar) e.avatar = c.avatar;
      if (!e.color && c.color) e.color = c.color;
      if (!e.note && c.note) e.note = c.note;
      e.anon = e.anon || !!c.anon;
      ['tag', 'note'].forEach(k => { if (!e.mod[k] && c.mod && c.mod[k]) e.mod[k] = c.mod[k]; });
      if (c.mod) { e.mod.warn = e.mod.warn || !!c.mod.warn; e.mod.banned = e.mod.banned || !!c.mod.banned; }
      if (!e.posts.includes(p.title)) e.posts.push(p.title || '（未命名）');
      const my = new Set([c.id]);
      p.floors.forEach(f => {
        if (f.charId === c.id) { e.floors++; if ((f.time || '') > e.last) e.last = f.time || ''; }
        f.replies.forEach(r => { if (r.charId === c.id) e.replies++; });
      });
      void my;
    }));
    return [...map.values()].sort((a, b) => (b.floors + b.replies) - (a.floors + a.replies));
  }
  function renderAdminUsers() {
    const box = $('#adminTabUsers');
    const all = collectAllChars();
    const q = adminUserQuery.trim().toLowerCase();
    const list = q ? all.filter(c => `${c.name}\u0000${c.uid}`.toLowerCase().includes(q)) : all;
    box.innerHTML = `
      <div class="admin-toolbar">
        <input id="userSearch" class="user-search" placeholder="搜索昵称或 ID…" value="${esc(adminUserQuery)}">
        <span class="hint-inline">共 ${all.length} 个角色（按 uid 去重）。匿名角色在这里能看到真名，导出时依然保持匿名。</span>
      </div>
      <div class="user-list">${list.length ? list.map(userRowHTML).join('') : '<p class="empty-tip">没有匹配的角色。</p>'}</div>`;
    const search = $('#userSearch');
    search.addEventListener('input', () => {
      adminUserQuery = search.value;
      renderAdminUsers();
      const s = $('#userSearch');
      s.focus(); s.setSelectionRange(s.value.length, s.value.length);
    });
    box.querySelectorAll('.user-head').forEach(h => h.addEventListener('click', () => {
      h.parentElement.classList.toggle('open');
    }));
    box.querySelectorAll('[data-uact]').forEach(inp => {
      const key = inp.dataset.key;
      const act = inp.dataset.uact;
      const handler = () => {
        const e = all.find(x => x.key === key);
        if (!e) return;
        if (act === 'tag') e.mod.tag = inp.value.trim();
        else if (act === 'note') e.mod.note = inp.value.trim();
        else if (act === 'warn') e.mod.warn = inp.checked;
        else if (act === 'banned') e.mod.banned = inp.checked;
        // 写回所有同 key 的角色：同名/同 ID 视为同一个人
        F.posts.forEach(p => p.chars.forEach(c => { if (charKey(c) !== key) return; c.mod = c.mod || {}; c.mod.tag = e.mod.tag; c.mod.note = e.mod.note; c.mod.warn = e.mod.warn; c.mod.banned = e.mod.banned; }));
        save();
        if (act === 'warn' || act === 'banned') renderAdminUsers();
      };
      inp.addEventListener(act === 'tag' || act === 'note' ? 'input' : 'change', handler);
    });
  }
  function userRowHTML(c) {
    const acts = (c.floors + c.replies);
    return `<div class="user-row${c.mod.banned ? ' banned' : ''}">
      <div class="user-head">
        <div class="avatar" style="background:${esc(c.color || '#9aa3b2')}">${esc(c.avatar || (c.name || '?').slice(0, 1))}</div>
        <div class="user-main">
          <div class="user-name">${esc(c.name)}
            ${c.mod.banned ? '<span class="badge ban">封禁</span>' : ''}
            ${c.mod.warn ? '<span class="badge warn">警告</span>' : ''}
            ${c.op ? '<span class="op-tag">楼主</span>' : ''}
            ${c.anon ? '<span class="anon-tag">匿名</span>' : ''}
            ${c.mod.tag ? `<span class="badge tag">${esc(c.mod.tag)}</span>` : ''}</div>
          <div class="user-sub">@${esc(c.uid || 'anonymous')} · ${esc(c.title || '无头衔')} · 出现 ${c.posts.length} 帖 · ${c.floors} 楼 / ${c.replies} 回复${c.last ? ' · 最后 ' + esc(shortTime(c.last)) : ''}</div>
        </div>
        <span class="user-toggle">▾</span>
      </div>
      <div class="user-detail">
        ${c.note ? `<div class="ud-note">人设：${esc(c.note)}</div>` : ''}
        <div class="ud-posts">出现于：${c.posts.map(esc).join('、')}</div>
        <div class="ud-edit">
          <label class="mini-field">版主标签<input data-uact="tag" data-key="${esc(c.key)}" value="${esc(c.mod.tag)}" placeholder="如：老水军 / 疑似小号"></label>
          <label class="mini-field wide">版主备注<textarea data-uact="note" data-key="${esc(c.key)}" rows="2" placeholder="只有管理视图能看到，导出时不会带上">${esc(c.mod.note)}</textarea></label>
          <label class="check-row"><input type="checkbox" data-uact="warn" data-key="${esc(c.key)}"${c.mod.warn ? ' checked' : ''}> <span>标记警告</span></label>
          <label class="check-row"><input type="checkbox" data-uact="banned" data-key="${esc(c.key)}"${c.mod.banned ? ' checked' : ''}> <span>标记封禁</span></label>
        </div>
      </div>
    </div>`;
  }

  /* 版块管理 */
  function renderAdminBoards() {
    const box = $('#adminTabBoards');
    box.innerHTML = `
      <div class="admin-toolbar"><span class="hint-inline">版块只是给帖子分类，方便在目录里筛选。</span></div>
      <div class="board-list">
        ${F.boards.map(b => {
          const n = F.posts.filter(p => p.boardId === b.id).length;
          return `<div class="board-row" data-id="${esc(b.id)}">
            <input class="board-name" data-bact="name" value="${esc(b.name)}">
            <span class="pr-num">${n} 帖</span>
            <button class="btn mini ghost" data-bact="del">删除</button>
          </div>`;
        }).join('')}
      </div>
      <div class="board-add"><input id="newBoardName" class="board-name" placeholder="新版块名称…"><button id="btnAddBoard" class="btn mini">＋ 添加版块</button></div>`;
    box.querySelectorAll('[data-bact="name"]').forEach(inp => {
      const b = F.boards.find(x => x.id === inp.closest('.board-row').dataset.id);
      inp.addEventListener('change', () => { b.name = inp.value.trim() || b.name; save(); renderAdmin(); });
    });
    box.querySelectorAll('[data-bact="del"]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.closest('.board-row').dataset.id;
      if (F.boards.length <= 1) { toast('至少要保留一个版块'); return; }
      F.boards = F.boards.filter(x => x.id !== id);
      const rest = F.boards[0].id;
      F.posts.forEach(p => { if (p.boardId === id) p.boardId = rest; });
      save(); renderAdmin(); toast('已删除版块，原帖已并入「' + F.boards[0].name + '」');
    }));
    const add = () => {
      const name = $('#newBoardName').value.trim();
      if (!name) { toast('请填写版块名称'); return; }
      F.boards.push({ id: uid('b'), name });
      save(); renderAdmin(); toast('已添加版块「' + name + '」');
    };
    $('#btnAddBoard').addEventListener('click', add);
    $('#newBoardName').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }

  function applyLockState() {
    const locked = !!P.locked;
    const btn = $('#btnAddFloor');
    btn.disabled = locked;
    $$('.panel-center textarea, .panel-center select, .panel-center button, .pin-body input, .pin-body textarea')
      .forEach(el => { el.disabled = locked; });
    const bar = $('#editorBar');
    bar.classList.toggle('hidden', !locked && !bar.dataset.fromAdmin);
    if (locked) {
      bar.classList.remove('hidden');
      $('#editorBarText').textContent = '这一帖已在管理视图锁定，为避免误改暂时只读；点「← 返回管理」可解锁。';
    }
  }

  /* ---------- 启动 ---------- */
  function renderAll() {
    const fromAdmin = view === 'editor' && F.ui.mode === 'admin';
    $('#workTitle').value = P.title || '';
    $('#btnToggleTime').textContent = '排序：' + (P.sortMode === 'time' ? '按时间' : '手动');
    const bar = $('#editorBar');
    bar.dataset.fromAdmin = fromAdmin ? '1' : '';
    bar.classList.toggle('hidden', !fromAdmin && !P.locked);
    if (fromAdmin) $('#editorBarText').textContent = `正在写：${P.title || '（未命名帖子）'} · ${boardName(P.boardId)}`;
    renderChars(); renderPin(); renderFloors(); renderPreview();
    applyLockState();
  }
  // 视图切换：写作（三栏编辑器）/ 管理（版主后台）
  function setView(v) {
    view = v === 'admin' ? 'admin' : 'editor';
    F.ui.mode = view;
    $('#app').classList.toggle('hidden', view !== 'editor');
    $('#adminView').classList.toggle('hidden', view !== 'admin');
    if (view === 'editor') renderAll();
    else renderAdmin();
    save();
  }
  function openPost(id) {
    const p = postById(id);
    if (!p) return;
    P = p;                         // P 是 F.posts 里的同一个对象引用
    F.ui.activePostId = id;
    setView('editor');
  }
  function openAbout() {
    const b = $('#aboutModal');
    const nf = (localStorage.getItem(LS_KEY) || '').length;
    b.querySelector('#abStats').innerHTML =
      `<li>帖子：${F.posts.length} 个</li>
       <li>版块：${F.boards.length} 个</li>
       <li>角色（按帖统计，含重复）：${F.posts.reduce((s, p) => s + p.chars.length, 0)} 个</li>
       <li>楼层合计：${F.posts.reduce((s, p) => s + p.floors.length, 0)} 层</li>
       <li>本地存档体积：约 ${(nf / 1024).toFixed(1)} KB</li>`;
    b.querySelector('#abBackup').textContent = localStorage.getItem(LS_BACKUP)
      ? '（已保留 v1.0.x 旧存档备份，恢复方式见 README）' : '';
    b.classList.remove('hidden');
  }
  seedIfEmpty();
  bindTop();
  bindAdmin();
  P = activePost();
  ensureSeed();
  setView(F.ui.startView === 'admin' ? 'admin' : 'editor');
})();
