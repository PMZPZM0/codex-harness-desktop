/**
 * pip 索引源清单（国内镜像优先、官方兜底；**顺序即优先级**）。
 *
 * ⛔⛔ 10-02 用户报障：清华源的**索引页正常（HTTP 200）但具体 wheel 直链 403/404**
 *   —— 镜像侧文件失效或按 IP/频率限流。单源模式下就是一个包（openpyxl）下不下来，
 *   整条「文档转换」安装全挂，而用户看到的是「HTTP error 403」这种跟他操作毫无关系的报错。
 *
 * ⛔ pip 下载 wheel 失败时**不会**自动换 index（`--extra-index-url` 同样不救）：
 *   它在解析阶段就选定了具体 URL，下载 403 即整体报错 ⇒ **只能整个 `pip install` 换源重跑**。
 *   所以每个调用点都必须按本表**顺序重试**，全部失败才把原因汇总给用户。
 *
 * 实测（10-02 03:54）：同一时刻腾讯云 / 中科大 / 官方 PyPI 都能解析并下载 openpyxl 3.1.5。
 */
export const PIP_INDEXES: readonly string[] = [
  "https://pypi.tuna.tsinghua.edu.cn/simple",
  "https://mirrors.cloud.tencent.com/pypi/simple",
  "https://mirrors.aliyun.com/pypi/simple/",
  "https://pypi.mirrors.ustc.edu.cn/simple/",
  "https://pypi.org/simple/",
];

/** 单次 pip 调用的通用参数：多给几次重试与超时，瞬时抖动不直接判死。 */
export const PIP_COMMON_ARGS: readonly string[] = ["--no-input", "--retries", "3", "--timeout", "30"];
