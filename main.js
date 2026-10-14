const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#f4f5f7',
    title: '论坛体写作助手',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

// 阻止浏览器默认的 Ctrl+P / Ctrl+滚轮缩放干扰，保留 Ctrl+R 重载便于调试
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
});

const template = [
  {
    label: '文件',
    submenu: [
      { label: '新建作品', click: () => win && win.webContents.executeJavaScript("document.getElementById('btnNew').click()") },
      { label: '导入存档…', click: () => win && win.webContents.executeJavaScript("document.getElementById('btnImport').click()") },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ],
  },
  {
    label: '编辑',
    submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }],
  },
  {
    label: '视图',
    submenu: [
      { role: 'reload', label: '重新载入' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '全屏' },
    ],
  },
  {
    label: '帮助',
    submenu: [
      { label: '关于', click: () => dialog.showMessageBox(win, { type: 'info', title: '关于', message: '论坛体写作助手', detail: '一个离线可用的论坛体排版工具。\n作品数据保存在本机 localStorage，可随时导出 .json 备份。', buttons: ['好'] }) },
    ],
  },
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
