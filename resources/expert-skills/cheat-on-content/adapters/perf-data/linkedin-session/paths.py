from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping


def runtime_project_root(
    env: Mapping[str, str] | None = None,
    cwd: Path | None = None,
) -> Path:
    active_env = env if env is not None else os.environ
    if active_env.get("CHEAT_PROJECT_ROOT"):
        return Path(active_env["CHEAT_PROJECT_ROOT"]).expanduser().resolve()
    base_cwd = cwd if cwd is not None else Path.cwd()
    return Path(base_cwd).expanduser().resolve()


def auth_dir(
    env: Mapping[str, str] | None = None,
    cwd: Path | None = None,
) -> Path:
    # 独立于抖音 .auth/ 与小红书 .auth-xhs/，避免多 adapter 共用 project root 时 cookie 串味
    return runtime_project_root(env=env, cwd=cwd) / ".auth-linkedin"


def debug_dir(
    env: Mapping[str, str] | None = None,
    cwd: Path | None = None,
) -> Path:
    return runtime_project_root(env=env, cwd=cwd) / ".cheat-cache" / "linkedin-session-debug"


def videos_dir(
    env: Mapping[str, str] | None = None,
    cwd: Path | None = None,
) -> Path:
    active_env = env if env is not None else os.environ
    if active_env.get("CHEAT_VIDEOS_DIR"):
        return Path(active_env["CHEAT_VIDEOS_DIR"]).expanduser().resolve()
    return runtime_project_root(env=env, cwd=cwd) / "videos"
