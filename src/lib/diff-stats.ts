/** diffStats（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function diffStats(diff: string) {
  return diff.split("\n").reduce((stats, line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) stats.added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) stats.deleted += 1;
    return stats;
  }, { added: 0, deleted: 0 });
}
