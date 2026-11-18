export default {
  id: 'tool-list', name: '开发工具清单与安装位置',
  run: async h => {
    await h.waitFor(`!!document.querySelector('.sidebar-options-toggle')`);
    await h.eval(`document.querySelector('.sidebar-options-toggle').click()`);
    const selector = '.sidebar-options-flyout button';
    await h.waitFor(`[...document.querySelectorAll('${selector}')].some(b => b.textContent.includes('新手点我'))`);
    h.check('入口紧邻开发工具', await h.eval(`[...document.querySelectorAll('${selector}')].find(b => b.textContent.includes('新手点我')).nextElementSibling?.querySelector('span')?.textContent === '开发工具'`));
    await h.eval(`[...document.querySelectorAll('${selector}')].find(b => b.textContent.includes('新手点我')).click()`);
    await h.waitFor(`!!document.querySelector('[data-tool-preview="git"]')`, { timeoutMs: 30000 });
    h.check('运行时无遗漏且无重复', await h.eval(`(async () => { const rows = await window.codex.listRuntimes(); const ids = [...document.querySelectorAll('[data-tool-preview]')].map(b => b.dataset.toolPreview); return ids.length === new Set(ids).size && rows.every(r => ids.includes(r.id)); })()`));
    await h.eval(`document.querySelector('[data-tool-preview="git"]').click()`);
    await h.waitFor(`!!document.querySelector('.settings-dialog-backdrop.is-elevated')`);
    h.check('预览位置与提示词同源', await h.eval(`(async () => { const r = (await window.codex.listRuntimes()).find(x => x.id === 'git'); const d = document.querySelector('.settings-dialog-backdrop.is-elevated'); return !!r.installTarget && d.querySelector('div.tool-list-preview').textContent === r.installTarget && d.querySelector('pre').textContent === r.fallbackPrompt && r.fallbackPrompt.includes(r.installTarget); })()`));
    await h.eval(`document.querySelector('.is-elevated .primary-setting').click()`);
    await h.waitFor(`document.querySelector('.is-elevated [role=status]')?.textContent.includes('已复制')`);
    await h.eval(`document.querySelector('.is-elevated .settings-dialog-close').click()`);
    h.check('关闭单项预览后仍在目录', await h.eval(`!!document.querySelector('[data-tool-preview="openfilm"]')`));
    await h.eval(`document.querySelector('.settings-dialog-close').click()`);
  }
};
