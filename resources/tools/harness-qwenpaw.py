# -*- coding: utf-8 -*-
"""Harness 侧 qwenpaw 启动包装器（选项 C：不改 site-packages，升级不丢）。

问题：`qwenpaw task`（headless）构造请求上下文时把 ``ctx.workspace`` 设成 None，
而 ``AgentBuilder._get_local_workspace()`` 只认 ``ctx.workspace.local_workspace``
⇒ ``build_toolkit()`` 落到 ``tools = []``，模型拿不到任何可调用工具（tools=0）。

做法：在**运行时**给 ``AgentBuilder.build`` 包一层 —— 当 ``ctx.workspace`` 为空时，
按 ``ctx.workspace_dir`` 造一个真实的 ``Workspace`` 并 ``bootstrap_plugins()``
（内置 4 个 mode 的 setup() 会把 25 个工具注册进 tool_registry），再交给原实现。
上游以后自己修了这条路径（ctx.workspace 非空）时，本包装器自动跳过，不做任何事。

⛔ 为什么不做成改 site-packages 的补丁：pip 升级会静默覆盖 site-packages，
   补丁随之消失、tools 又回到 0，而且不报错。本文件随应用分发（tools/ 目录），
   `pip install -U qwenpaw` 不影响它。
⛔ 任何一步失败都**放行**（不 patch、直接跑原 CLI）：宁可回到上游行为，
   也不能让包装器把 qwenpaw 弄坏。
"""
from __future__ import annotations

import sys

_PATCH_FLAG = "_harness_headless_workspace_patch"


def _patch_builder() -> None:
    try:
        from qwenpaw.runtime.builder import AgentBuilder
    except Exception:
        return
    if getattr(AgentBuilder, _PATCH_FLAG, False):
        return
    original_build = AgentBuilder.build

    async def build(self, ctx, *args, **kwargs):
        try:
            if ctx is not None and getattr(ctx, "workspace", None) is None:
                _attach_workspace(ctx)
        except Exception:
            # 包装器自身的问题不许影响 CLI：原样交给上游实现。
            pass
        return await original_build(self, ctx, *args, **kwargs)

    build.__name__ = getattr(original_build, "__name__", "build")
    build.__doc__ = getattr(original_build, "__doc__", None)
    AgentBuilder.build = build
    setattr(AgentBuilder, _PATCH_FLAG, True)


def _attach_workspace(ctx) -> None:
    from pathlib import Path

    from qwenpaw.app.workspace.bootstrap_factory import WorkspaceBootstrapFactory
    from qwenpaw.app.workspace.workspace import Workspace

    agent_id = str(getattr(ctx, "agent_id", "") or "default")
    workspace_dir = getattr(ctx, "workspace_dir", None)
    if workspace_dir is None:
        # ⛔ 不用 tempfile.mkdtemp：headless 每次一个任务，临时目录永远不会被清理。
        workspace_dir = Path.home() / ".qwenpaw" / "workspaces" / agent_id
    workspace = Workspace(
        agent_id=agent_id,
        workspace_dir=str(workspace_dir),
    )
    workspace.bootstrap_plugins(
        **WorkspaceBootstrapFactory.build_bootstrap_kwargs(),
    )
    ctx.workspace = workspace
    if getattr(ctx, "extras", None) is None:
        ctx.extras = {}
    if getattr(ctx, "mode_state", None) is None:
        ctx.mode_state = {}


def main() -> None:
    _patch_builder()
    import runpy

    runpy.run_module("qwenpaw", run_name="__main__")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # qwenpaw 自身启动失败时给出可读原因
        sys.stderr.write("harness-qwenpaw: %s\n" % error)
        raise SystemExit(1)
