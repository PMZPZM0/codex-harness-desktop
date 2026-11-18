export default {
  id: 'profile-expert-guide', name: '工作方向、专家工具与重开配置',
  run: async h => {
    const click = selector => h.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const next = () => click('.profile-guide-footer .profile-guide-next:not(:disabled)');
    const back = () => click('.profile-guide-footer .profile-guide-back');
    const open = async () => {
      await h.eval(`window.dispatchEvent(new Event('codex-open-profile-guide'))`);
      await h.waitFor(`!!document.querySelector('[data-direction]')`, {label:'工作方向页'});
    };
    const pick = '.profile-guide-pick:not(:disabled)';
    await open();
    await click('[value="media-desk"]');
    h.check('自媒体身份排除程序员', await h.eval(`!!document.querySelector('[data-role=video]') && !document.querySelector('[data-role=coder]')`));
    await click('[data-role=video]'); await next();
    await h.waitFor(`!!document.querySelector('${pick}')`, {label:'自媒体专家'});
    await click(pick); await next();
    h.check('自媒体推荐创意搭档', await h.eval(`document.querySelector('.profile-guide-assistant .on strong')?.textContent === '创意搭档'`));
    await back(); await back(); await click('[value=devtools]');
    h.check('换方向清除旧身份', await h.eval(`!document.querySelector('[data-role].on') && !document.querySelector('[data-role=video]')`));
    await click('[data-role=coder]'); await next();
    await h.waitFor(`!!document.querySelector('${pick}') && !document.querySelector('.profile-guide-expert-id')`, {label:'开发方向重新筛选专家'});
    const count = await h.eval(`document.querySelectorAll('${pick}').length`);
    for (let i = 0; i < count; i++) {
      await h.eval(`document.querySelectorAll('${pick}')[${i}].click()`);
      if (await h.eval(`!!document.querySelector('.profile-guide-tool-prompt')`)) break;
    }
    await click('.profile-guide-tool-prompt summary');
    h.check('提示词来自当前工具', await h.eval(`(async () => { const d = document.querySelector('.profile-guide-tool-prompt[open]'); const row = (await window.codex.listRuntimes()).find(r => r.id === d.closest('[data-tool-id]').dataset.toolId); return !!row?.fallbackPrompt && row.fallbackPrompt === d.querySelector('pre').textContent; })()`));
    await click('.profile-guide-tool-prompt[open] button');
    await h.waitFor(`document.querySelector('.profile-guide-expert [role=status]').textContent.includes('已复制')`, {label:'复制提示词'});
    const chosen = await h.eval(`document.querySelector('.profile-guide-expert-id strong').textContent`);
    await next(); await next(); await click('input[value=save]'); await next();
    await h.waitFor(`!document.querySelector('.profile-guide-card')`, {label:'保存完成'});
    await open();
    h.check('恢复方向与身份', await h.eval(`document.querySelector('[value=devtools]').checked && !!document.querySelector('[data-role=coder].on')`));
    await next();
    await h.waitFor(`document.querySelector('.profile-guide-expert-id strong')?.textContent === ${JSON.stringify(chosen)}`, {label:'恢复同一专家'});
    await next(); await next();
    h.check('恢复只保存动作', await h.eval(`document.querySelector('input[value=save]').checked`));
    await click('.profile-guide-skip');
  },
};
