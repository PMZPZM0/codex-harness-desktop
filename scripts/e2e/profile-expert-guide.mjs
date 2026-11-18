export default {
    id: "profile-expert-guide", name: "用户配置引导：选择专家、查看配套工具、切换工作入口",
    run: async (h) => {
      const open = async () => {
      await h.eval(`window.dispatchEvent(new Event('codex-open-profile-guide'))`);
      await h.waitFor(`!!document.querySelector('.profile-guide-next')`, {label:'打开引导'});
      for (let step = 1; step < 5; step++) {
        await h.eval(`document.querySelector('.profile-guide-next').click()`);
        await h.waitFor(`document.querySelector('.profile-guide-kicker')?.textContent.includes('第 ${step + 1} /')`, {label:'切换引导页'});
      }
      await h.waitFor(`!!document.querySelector('.profile-guide-pick:not(:disabled)')`, {label:'读取真实专家清单'});
      };
      await open();
      const move = async (next, step) => {
        await h.eval(`document.querySelector('.profile-guide-footer .profile-guide-${next ? 'next' : 'back'}').click()`);
        await h.waitFor(`document.querySelector('.profile-guide-kicker')?.textContent.includes('第 ${step} /')`, {label:'切换身份联动步骤'});
      };
      for (const step of [4,3,2]) await move(false, step);
      await h.eval(`document.querySelector('[data-role=coder]').click()`);
      await h.eval(`document.querySelector('[data-role=video]').click()`);
      await move(true, 3);
      h.check('自媒体推荐创意搭档而非工程师', await h.eval(`document.querySelector('.profile-guide-persona.on strong')?.textContent === '创意搭档' && !document.querySelector('.profile-guide-assistant').textContent.includes('极简工程师')`));
      await move(true, 4); await move(true, 5);
      await h.waitFor(`document.querySelector('input[value="media-desk"]').checked && !!document.querySelector('.profile-guide-pick:not(:disabled)')`, {label:'自媒体职业联动工作台及专家'});
      await h.eval(`document.querySelector('.profile-guide-pick').click()`);
      for (const step of [4,3,2]) await move(false, step);
      await h.eval(`document.querySelector('[data-role=coder]').click()`);
      await move(true, 3);
      h.check('改职业切换内置工程搭档', await h.eval(`document.querySelector('.profile-guide-persona.on strong')?.textContent === '极简工程师'`));
      await move(true, 4); await move(true, 5);
      await h.waitFor(`document.querySelector('input[value="devtools"]').checked && !document.querySelector('.profile-guide-expert-id') && !!document.querySelector('.profile-guide-pick:not(:disabled)')`, {label:'改职业清除旧专家并切换工具方向'});
      await h.eval(`document.querySelector('.profile-guide-save-only input').click()`);
      const total = await h.eval(`document.querySelectorAll('.profile-guide-pick').length`);
      for (let i = 0; i < total; i++) {
        await h.eval(`document.querySelectorAll('.profile-guide-pick')[${i}].click()`);
        if (await h.eval(`!!document.querySelector('.profile-guide-tool-prompt')`)) break;
      }
      await h.waitFor(`!!document.querySelector('.profile-guide-tool-prompt summary')`, {label:'专家工具卡提供安装提示词'});
      await h.eval(`document.querySelector('.profile-guide-tool-prompt summary').click()`);
      h.check('预览精确匹配当前工具的安装提示词', await h.eval(`(async () => { const d = document.querySelector('.profile-guide-tool-prompt[open]'); const row = (await window.codex.listRuntimes()).find(r => r.id === d.closest('[data-tool-id]').dataset.toolId); return !!row?.fallbackPrompt && row.fallbackPrompt === d.querySelector('pre').textContent; })()`));
      await h.eval(`document.querySelector('.profile-guide-tool-prompt[open] button').click()`);
      await h.waitFor(`document.querySelector('.profile-guide-expert [role=status]').textContent.includes('已复制')`, {label:'点击复制安装提示词'});
      await h.eval(`document.querySelector('input[value="component-library"]').click()`);
      await h.waitFor(`document.querySelectorAll('.profile-guide-pick').length > 0 && document.querySelectorAll('.profile-guide-pick').length < ${total}`, {label:'设计方向筛选专家'});
      await h.eval(`document.querySelector('.profile-guide-pick').click()`);
      await h.waitFor(`!!document.querySelector('.profile-guide-expert-id') && document.querySelector('.profile-guide-next').textContent.includes('对话')`, {label:'专家身份与会话目标'});
      h.check('声明的工具或空态可见', await h.eval(`!!document.querySelector('.profile-guide-tool') || document.querySelector('.profile-guide-expert').textContent.includes('未声明额外工具')`));
      h.check('选择专家不清除设计方向', await h.eval(`document.querySelector('input[value="component-library"]').checked`));
      await h.eval(`document.querySelector('.profile-guide-start input').click()`);
      await h.waitFor(`!document.querySelector('.profile-guide-expert-id') && document.querySelector('.profile-guide-next').textContent.includes('开发工具')`, {label:'从专家切换到开发工具'});
      await h.eval(`document.querySelector('.profile-guide-next').click()`);
      await h.waitFor(`!document.querySelector('.profile-guide-card')`, {label:'保存成功'});
      await open();
      h.check('重新配置还原方向', await h.eval(`document.querySelector('input[value="devtools"]').checked`));
      await move(false, 4); await move(false, 3);
      h.check('重开恢复之前保存的内置搭档', await h.eval(`document.querySelector('.profile-guide-persona.on strong')?.textContent === '极简工程师'`));
      await h.eval(`document.querySelector('.profile-guide-skip').click()`);
      await h.waitFor(`!document.querySelector('.profile-guide-card')`, {label:'跳过不启动任务'});
    },
  };
