// detail.vue 拆分后的源码拼接 helper（供结构测试读取跨 shell/面板/composable 的断言）。
// 薄壳 views/drama/detail.vue + 子面板 views/drama/detail/panels/*.vue + 逻辑 composables/detail/*.ts。
// 顺序保证：composables 与 panels 均排在 shell 之前，使「async function addEpisode」(useDetailEpisodes.ts)
// 出现在「onMounted(load)」(shell) 之前，兼容 episode-create-dialog 的顺序敏感切片断言。
import { readFileSync } from 'node:fs'

const PARTS = [
  'app/composables/detail/useDetailProduction.ts',
  'app/composables/detail/useDetailEpisodes.ts',
  'app/composables/detail/useDetailAssets.ts',
  'app/views/drama/detail/panels/DetailProductionPanel.vue',
  'app/views/drama/detail/panels/DetailEpisodeList.vue',
  'app/views/drama/detail/panels/DetailAssetsPanel.vue',
  'app/views/drama/detail/panels/DetailAssetEditDialog.vue',
  'app/views/drama/detail.vue',
]

/** @param frontendRoot 测试文件上的 new URL('..', import.meta.url) */
export function readDetailSources(frontendRoot) {
  return PARTS
    .map(p => readFileSync(new URL(p, frontendRoot), 'utf8'))
    .join('\n')
}
