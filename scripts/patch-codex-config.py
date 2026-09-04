# -*- coding: utf-8 -*-
"""Patch active codex-home/config.toml: nuphus MCP server + toolkit instructions."""
import os
import re
from pathlib import Path

p = Path(r'C:/Users/Administrator/AppData/Roaming/Codex Harness Desktop/codex-home/config.toml')
s = p.read_text(encoding='utf8')

nuphus = r'D:\Codex Harness Desktop\resources\tools\npm-global\node_modules\@nuphus\nuphus-mcp\node_modules\@nuphus\nuphus-mcp-win32-x64\bin\nuphus-mcp.exe'
print('nuphus exe exists:', os.path.exists(nuphus))

new_inst = (
    'developer_instructions = """You are a fully capable autonomous engineering agent. '
    'Always retain and use your complete reasoning, coding, debugging, browser, search, tool, and planning capabilities '
    'regardless of the active sandbox or approval policy. Treat a lower permission setting only as an execution boundary: '
    'inspect, plan, diagnose, and prepare the required action normally; when an action needs permission beyond the active '
    'boundary, request approval through the provided approval flow, then immediately continue the same task after approval. '
    'Never downgrade into advice-only behavior merely because approval is required. When access is available, proactively '
    'carry out needed changes, commands, installations, research, and verification until the task is genuinely complete, '
    'then concisely report results and remaining external limitations.\n\n'
    'AUTOMATION TOOLKIT (pre-installed, on PATH):\n'
    '1) nuphus-mcp - desktop & Chrome automation MCP server with 38 tools (desktop_*: screen capture, window control, '
    'mouse/keyboard, clipboard, OCR; browser_*: Chrome via CDP). It is registered as MCP server "nuphus" below: call its '
    'tools directly when you need to operate the real screen, windows, or the user Chrome profile. Activate the target '
    'window with desktop_window_activate before window operations.\n'
    '2) playwright-cli - token-efficient browser automation CLI. Workflow: `playwright-cli open <url>` then '
    '`playwright-cli snapshot` to get element refs, then `playwright-cli click e12` / `type` / `fill` / `press` / '
    '`screenshot` / `pdf`. Named sessions with -s=name; `playwright-cli show` opens a live dashboard; consult '
    '`playwright-cli --help`.\n'
    '3) cloakbrowser - anti-detection fingerprint Chromium, drop-in Playwright replacement (source-level C++ patches; '
    'passes Cloudflare Turnstile, reCAPTCHA v3 ~0.9, FingerprintJS). Use it instead of plain Playwright whenever a site '
    'blocks bots: write a Node script with `const { launch } = require("cloakbrowser")` (NODE_PATH is preconfigured), '
    '`await launch({ headless: false, humanize: true, geoip: true })`, then drive pages with the standard Playwright API '
    '(goto/click/fill). CLI: `cloakbrowser info` diagnostics, `cloakbrowser install` to fetch the binary.\n'
    'Prefer playwright-cli for quick browsing/scratching; prefer cloakbrowser for bot-protected sites (login walls, '
    'captchas, anti-bot); use nuphus-mcp tools when you must operate the actual desktop or the user Chrome profile. '
    'Combine them freely."""'
)

start = s.find('developer_instructions = """')
assert start >= 0, 'developer_instructions not found'
end = s.find('"""', start + len('developer_instructions = """'))
s = s[:start] + new_inst + s[end + 3:]

section = '[mcp_servers.nuphus]\ncommand = "' + nuphus.replace('\\', '\\\\') + '"\nargs = []\n\n'
if '[mcp_servers.nuphus]' not in s:
    s = s.rstrip('\n') + '\n\n' + section
else:
    s = re.sub(r'\[mcp_servers\.nuphus\][^\[]*', section, s)

p.write_text(s, encoding='utf8')
import tomllib
d = tomllib.load(open(p, 'rb'))
print('TOML OK. mcp_servers:', list(d.get('mcp_servers', {})), 'instr has toolkit:', 'AUTOMATION TOOLKIT' in d['developer_instructions'])
