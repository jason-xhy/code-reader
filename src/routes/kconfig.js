// 能力：内核 Kconfig 解析（架构/defconfig 列表与解析触发）。
import { readJson, sendJson } from '../http/json.js';
import { getRepository } from '../repositories.js';
import { kconfigStatus, listArches, listDefconfigs, resolveKernelConfig } from '../kconfig.js';
import { resetLspSession } from '../lsp.js';
import { requiredString } from '../policies/request.js';
import { serverConfig } from '../config.js';

export const kconfigRoutes = [
  {
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/kconfig$/,
    async handler({ response, params }) {
      const repository = getRepository(params[0]);
      const arches = await listArches(repository.root);
      // 一次拉全所有架构的 defconfig（几十次 readdir，毫秒级），前端切架构免往返。
      const defconfigs = {};
      await Promise.all(arches.map(async (arch) => {
        defconfigs[arch] = await listDefconfigs(repository.root, arch);
      }));
      const current = await kconfigStatus(repository);
      sendJson(response, 200, {
        arches,
        defconfigs,
        // values 可能有上万条：列表接口只回元数据，取值走跳转定义附带。
        current: current ? { ...current, values: undefined } : null,
      });
    },
  },
  {
    // 置灰用的取值接口：与列表接口分开，避免上万条 values 拖慢设置菜单；
    // stale / 未解析时不带 values，前端据此不启用置灰。
    method: 'GET',
    pattern: /^\/api\/repositories\/([^/]+)\/kconfig\/values$/,
    async handler({ response, params }) {
      const repository = getRepository(params[0]);
      const current = await kconfigStatus(repository);
      if (!current) {
        sendJson(response, 200, { available: false, stale: true });
        return;
      }
      const { arch, defconfig, stale, values } = current;
      sendJson(response, 200, { available: true, arch, defconfig, stale, values });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/repositories\/([^/]+)\/kconfig\/resolve$/,
    async handler({ request, response, params }) {
      const repository = getRepository(params[0]);
      const body = await readJson(request, serverConfig.largeBodyLimit);
      const arch = requiredString(body.arch, { message: '缺少架构（arch）', code: 'INVALID_KCONFIG_ARCH' });
      const defconfig = requiredString(body.defconfig, { message: '缺少 defconfig', code: 'INVALID_KCONFIG_DEFCONFIG' });
      const result = await resolveKernelConfig(repository, { arch, defconfig });
      // 解析结果改变 compile-db 的 arch 与 autoconf 注入：重启 LSP 会话使其生效。
      await resetLspSession(repository.id);
      sendJson(response, 200, result);
    },
  },
];
