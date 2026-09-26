/*
 * Drama Mill — episode 工作台逻辑模块（自 views/drama/episode.vue 机械拆分，逻辑逐字保留）
 * AGPL-3.0 licensed. (C) 2026 Drama Mill <52859273@qq.com>
 */
import { useEpisodeIdentity } from './useEpisodeIdentity'
import { useEpisodeFormat } from './useEpisodeFormat'
import { useEpisodeModelSelection } from './useEpisodeModelSelection'
import { useEpisodeGenerationState } from './useEpisodeGenerationState'
import { useEpisodeScriptPanel } from './useEpisodeScriptPanel'
import { useEpisodeAssetDetail } from './useEpisodeAssetDetail'
import { useEpisodeAssetPrompt } from './useEpisodeAssetPrompt'
import { useEpisodeAssetImages } from './useEpisodeAssetImages'
import { useEpisodeAssetOps } from './useEpisodeAssetOps'
import { useEpisodeShotReferences } from './useEpisodeShotReferences'
import { useEpisodeStoryboardEditor } from './useEpisodeStoryboardEditor'
import { useEpisodeVideoPrompts } from './useEpisodeVideoPrompts'
import { useEpisodeGenTasks } from './useEpisodeGenTasks'
import { useEpisodeWorkbenchUi } from './useEpisodeWorkbenchUi'
import { useEpisodeVideoTasks } from './useEpisodeVideoTasks'
import { useEpisodeExportMerge } from './useEpisodeExportMerge'
import { useEpisodeData } from './useEpisodeData'
import { useEpisodePipelineNav } from './useEpisodePipelineNav'
import { useEpisodeStats } from './useEpisodeStats'
import { useEpisodeStoryboardSplit } from './useEpisodeStoryboardSplit'
import { useEpisodeExtract } from './useEpisodeExtract'
import { useEpisodeVideoHistory } from './useEpisodeVideoHistory'
import { useEpisodeAiCallSwitch } from './useEpisodeAiCallSwitch'
import { useEpisodeLifecycle } from './useEpisodeLifecycle'

/** 组装整个剧集工作台运行时状态与动作（每页面实例一次） */
export function useEpisodeWorkbench(): any {
  const wb: any = {}
  Object.assign(wb, useEpisodeIdentity(wb))
  Object.assign(wb, useEpisodeFormat(wb))
  Object.assign(wb, useEpisodeModelSelection(wb))
  Object.assign(wb, useEpisodeGenerationState(wb))
  Object.assign(wb, useEpisodeScriptPanel(wb))
  Object.assign(wb, useEpisodeAssetDetail(wb))
  Object.assign(wb, useEpisodeAssetPrompt(wb))
  Object.assign(wb, useEpisodeAssetImages(wb))
  Object.assign(wb, useEpisodeAssetOps(wb))
  Object.assign(wb, useEpisodeShotReferences(wb))
  Object.assign(wb, useEpisodeStoryboardEditor(wb))
  Object.assign(wb, useEpisodeVideoPrompts(wb))
  Object.assign(wb, useEpisodeGenTasks(wb))
  Object.assign(wb, useEpisodeWorkbenchUi(wb))
  Object.assign(wb, useEpisodeVideoTasks(wb))
  Object.assign(wb, useEpisodeExportMerge(wb))
  Object.assign(wb, useEpisodeData(wb))
  Object.assign(wb, useEpisodePipelineNav(wb))
  Object.assign(wb, useEpisodeStats(wb))
  Object.assign(wb, useEpisodeStoryboardSplit(wb))
  Object.assign(wb, useEpisodeExtract(wb))
  Object.assign(wb, useEpisodeVideoHistory(wb))
  Object.assign(wb, useEpisodeAiCallSwitch(wb))
  Object.assign(wb, useEpisodeLifecycle(wb))
  return wb
}
