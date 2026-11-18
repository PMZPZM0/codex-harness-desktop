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
      await h.eval(`document.querySelector('.profile-guide-save-only input').click()`);
      const total = await h.eval(`document.querySelectorAll('.profile-guide-pick').length`);
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
      await h.eval(`document.querySelector('.profile-guide-skip').click()`);
      await h.waitFor(`!document.querySelector('.profile-guide-card')`, {label:'跳过不启动任务'});
    },
  };
