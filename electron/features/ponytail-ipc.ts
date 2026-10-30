/**
 * ponytail-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：ponytail(2)
 * 通道：ponytail:mode:get / ponytail:mode:set
 *
 * 口径唯一真相源 = `../ponytail-mode`（Mode 枚举与落盘都在那里）。
 */
import { getPonytailMode, setPonytailMode } from "../conventions/ponytail-mode";
import { healPonytailInstall } from "../ponytail-heal";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const ponytailFeature = defineFeature<null>({
  id: "ponytail",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("ponytail: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("ponytail:mode:get", async () => getPonytailMode());
    ipcHost.handle("ponytail:mode:set", async (_event, mode: string) => {
      await setPonytailMode(mode as any);
      /* 10-30：开关不能只是写个配置就完事 —— 插件文件/市场段丢了的话，钩子根本没加载，
         「联动」会假死。非 off 时顺手自愈一次（异步、不阻塞开关手感、不重启引擎）。 */
      if (mode !== "off") void healPonytailInstall().catch(() => undefined);
      return { mode };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("ponytail:mode:get");
      ipcHost.removeHandler("ponytail:mode:set");
    });
  },
});
