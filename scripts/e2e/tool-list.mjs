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
    const total = await h.eval(`document.querySelectorAll('[data-tool-preview]').length`);
    const search = value => h.eval(`(() => { const el = document.querySelector('.tool-list-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await h.eval(`document.querySelector('[data-tool-purpose="开发环境"]').click()`);
    h.check('只显示开发工具', await h.eval(`!!document.querySelector('[data-tool-preview="git"]') && !document.querySelector('[data-tool-preview="openfilm"]')`));
    const gitState = await h.eval(`document.querySelector('[data-tool-preview="git"] [data-state]').dataset.state`);
    await h.eval(`document.querySelector('.tool-list-toolbar [aria-haspopup=listbox]').click()`);
    await h.eval(`[...document.querySelectorAll('[role=listbox][aria-label="安装状态"] [role=option]')].find(el => el.textContent === ${JSON.stringify(gitState)}).click()`);
    h.check('按实际安装状态过滤', await h.eval(`[...document.querySelectorAll('[data-tool-preview] [data-state]')].every(el => el.dataset.state === ${JSON.stringify(gitState)})`));
    await search('Git');
    await h.waitFor(`document.querySelector('[data-tool-preview="git"]') && !document.querySelector('[data-tool-preview="git"]')?.hidden`);
    const filtered = await h.eval(`document.querySelectorAll('[data-tool-preview]').length`);
    await h.eval(`document.querySelector('[data-tool-preview="git"]').click()`);
    await h.waitFor(`!!document.querySelector('.settings-dialog-backdrop.is-elevated')`);
    h.check('预览位置与提示词同源', await h.eval(`(async () => { const r = (await window.codex.listRuntimes()).find(x => x.id === 'git'); const d = document.querySelector('.settings-dialog-backdrop.is-elevated'); return !!r.installTarget && d.querySelector('div.tool-list-preview').textContent === r.installTarget && d.querySelector('pre').textContent === r.fallbackPrompt && r.fallbackPrompt.includes(r.installTarget); })()`));
    await h.eval(`document.querySelector('.is-elevated .primary-setting').click()`);
    await h.waitFor(`document.querySelector('.is-elevated [role=status]')?.textContent.includes('已复制')`);
    await h.eval(`document.querySelector('.is-elevated .settings-dialog-close').click()`);
    h.check('关闭预览保留三个条件', await h.eval(`document.querySelector('[data-tool-purpose="开发环境"]').ariaPressed === 'true' && document.querySelector('.tool-list-search input').value === 'Git' && document.querySelector('.tool-list-toolbar [aria-haspopup=listbox]').textContent === ${JSON.stringify(gitState)} && document.querySelectorAll('[data-tool-preview]').length === ${filtered}`));
    await search('不存在的工具-xyz');
    await h.waitFor(`!!document.querySelector('.tool-list-empty')`);
    h.check('零结果与分类计数一致', await h.eval(`!document.querySelector('[data-tool-preview]') && [...document.querySelectorAll('[data-tool-purpose] small')].every(el => el.textContent === '0')`));
    await h.eval(`document.querySelector('.tool-list-summary button').click()`);
    h.check('清除全部条件恢复完整目录', await h.eval(`document.querySelectorAll('[data-tool-preview]').length === ${total} && !!document.querySelector('[data-tool-preview="openfilm"]')`));
    await h.eval(`document.querySelector('.settings-dialog-close').click()`);
  }
};
