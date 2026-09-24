/** Fold（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
export function Fold({ open, bare, children }: { open: boolean; bare?: boolean; children: React.ReactNode }) {
  const body = <div className="wb-fold-content"><div className="wb-fold-inner">{children}</div></div>;
  return bare ? body : <div className={`wb-fold ${open ? "open" : "collapsed"}`}>{body}</div>;
}
