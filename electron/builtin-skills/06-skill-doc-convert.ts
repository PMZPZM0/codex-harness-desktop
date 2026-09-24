/**
 * builtin-skills 的「skill-doc-convert」部分（09-22 从同目录 builtin-skills.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
// 文档转换（markitdown）：让模型会读 PDF / Word / Excel / PPT 附件。
// 与 humanizer 等不同，这条是**我们写的**（不涉及第三方内容）；它只教「怎么用已装的 markitdown」，
// 不随包分发 markitdown 本身（那由「开发工具」页 / Python 依赖安装负责）。
export const DOC_CONVERT_SKILL = `---
name: document-convert
description: 读取用户带来的 PDF / Word / Excel / PowerPoint 等二进制文档：PDF / Word / PPT 用 markitdown 转成 Markdown，Excel 用 openpyxl 直读。当附件是这类格式、或任务需要解析这类文档内容时使用。
---

# 文档转换（markitdown / openpyxl）

用户拖进对话的附件以**文件路径**形式给出（提示词里的 \`[附件文件]\` 段）。PDF / Word / Excel / PPT
这类二进制文档**读不了原文**，要先用下面的办法转成文本。

## 判存在（必做的第一步）

\`\`\`bash
python -c "import markitdown, openpyxl; print(markitdown.__version__)"
\`\`\`

- 能打印版本 ⇒ 直接转。
- 报 \`ModuleNotFoundError\` ⇒ 本机没装 —— **自己装上即可**（有国内镜像，约 4~5 分钟）：

\`\`\`bash
python -m pip install --no-input -i https://pypi.tuna.tsinghua.edu.cn/simple "markitdown[pdf,docx,pptx]" openpyxl
\`\`\`

  装完继续干活，**不必打断用户**。若这一步失败（无网 / 没权限 / 镜像不可用），再告诉用户：
  「去『设置 → 开发工具 → 文档转换（markitdown）』点一次安装」。

## PDF / Word / PowerPoint

\`\`\`bash
python -c "from markitdown import MarkItDown; import sys; print(MarkItDown().convert(sys.argv[1]).text_content)" "<文件路径>"
\`\`\`

内容长时先落盘再分段读，别一次刷满上下文：

\`\`\`bash
python -c "from markitdown import MarkItDown; import sys; open('out.md','w',encoding='utf-8').write(MarkItDown().convert(sys.argv[1]).text_content)" "<文件路径>"
\`\`\`

## Excel（.xlsx / .xlsm）—— 走 openpyxl，**不要**用 markitdown

⛔ markitdown 的 Excel 转换器依赖 **pandas**（约 59 MB），本应用**刻意不装**（体积换收益不划算）。
Excel 改用已装好的 openpyxl 直读。建议写成临时 \`.py\` 再跑（多行命令在 Windows cmd 下容易出错）：

\`\`\`python
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)   # data_only=True 取公式的**计算结果**
for ws in wb.worksheets:
    print("##", ws.title)
    for row in ws.iter_rows(values_only=True):
        print(" | ".join("" if c is None else str(c) for c in row))
\`\`\`

## 其它格式

CSV / TSV、HTML、JSON / XML、EPUB、ZIP（逐文件转）、图片（EXIF/元数据）、音频（元数据）等 —— markitdown 直接转。

## 硬约束

- **只读**：绝不改动用户的原文件。
- 转换结果可能很长：大文档**先落盘**，再按需要读相关段落。
- 扫描件（纯图片的 PDF）转出来可能没有文字 —— 那就改用 \`desktop_vision\`（若已配视觉模型）看，或请用户提供文字版。
- ⛔ 不要改用在线转换服务上传用户的文件 —— 转换必须在本机完成。
`;
