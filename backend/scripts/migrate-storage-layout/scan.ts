/*
 * Drama Mill — 存储布局迁移：全表扫描，收集待迁移路径与数据库回写计划
 */
import { schema } from '../../src/db/index.js'
import {
  episodeDrama,
  mapColumn,
  mapJsonColumn,
  ownerOfDrama,
  recordUpdate,
  streamTable,
} from './state.js'

export async function scanTables() {
  // episodes：video_url，归属自身 drama_id
  await streamTable(schema.episodes, { dramaId: schema.episodes.dramaId, videoUrl: schema.episodes.videoUrl }, rows => {
    for (const r of rows as any[]) {
      const nv = mapColumn(r.videoUrl, ownerOfDrama(r.dramaId))
      if (nv) recordUpdate('episodes', schema.episodes, r.id, { videoUrl: nv })
    }
  })

  // characters：image_url / local_path / reference_images(JSON)
  await streamTable(schema.characters, {
    dramaId: schema.characters.dramaId, imageUrl: schema.characters.imageUrl,
    localPath: schema.characters.localPath, referenceImages: schema.characters.referenceImages,
  }, rows => {
    for (const r of rows as any[]) {
      const owner = ownerOfDrama(r.dramaId)
      const set: Record<string, any> = {}
      const imageUrl = mapColumn(r.imageUrl, owner); if (imageUrl) set.imageUrl = imageUrl
      const localPath = mapColumn(r.localPath, owner); if (localPath) set.localPath = localPath
      const refs = mapJsonColumn(r.referenceImages, owner); if (refs) set.referenceImages = refs
      if (Object.keys(set).length) recordUpdate('characters', schema.characters, r.id, set)
    }
  })

  // scenes：image_url / local_path
  await streamTable(schema.scenes, {
    dramaId: schema.scenes.dramaId, imageUrl: schema.scenes.imageUrl, localPath: schema.scenes.localPath,
  }, rows => {
    for (const r of rows as any[]) {
      const owner = ownerOfDrama(r.dramaId)
      const set: Record<string, any> = {}
      const imageUrl = mapColumn(r.imageUrl, owner); if (imageUrl) set.imageUrl = imageUrl
      const localPath = mapColumn(r.localPath, owner); if (localPath) set.localPath = localPath
      if (Object.keys(set).length) recordUpdate('scenes', schema.scenes, r.id, set)
    }
  })

  // props：image_url / local_path / reference_images(JSON)
  await streamTable(schema.props, {
    dramaId: schema.props.dramaId, imageUrl: schema.props.imageUrl,
    localPath: schema.props.localPath, referenceImages: schema.props.referenceImages,
  }, rows => {
    for (const r of rows as any[]) {
      const owner = ownerOfDrama(r.dramaId)
      const set: Record<string, any> = {}
      const imageUrl = mapColumn(r.imageUrl, owner); if (imageUrl) set.imageUrl = imageUrl
      const localPath = mapColumn(r.localPath, owner); if (localPath) set.localPath = localPath
      const refs = mapJsonColumn(r.referenceImages, owner); if (refs) set.referenceImages = refs
      if (Object.keys(set).length) recordUpdate('props', schema.props, r.id, set)
    }
  })

  // storyboards：7 个路径列，归属经 episode → drama
  await streamTable(schema.storyboards, {
    episodeId: schema.storyboards.episodeId, composedImage: schema.storyboards.composedImage,
    firstFrameImage: schema.storyboards.firstFrameImage, lastFrameImage: schema.storyboards.lastFrameImage,
    referenceImages: schema.storyboards.referenceImages, videoUrl: schema.storyboards.videoUrl,
    composedVideoUrl: schema.storyboards.composedVideoUrl, subtitleUrl: schema.storyboards.subtitleUrl,
  }, rows => {
    for (const r of rows as any[]) {
      const owner = ownerOfDrama(r.episodeId != null ? episodeDrama.get(r.episodeId) ?? null : null)
      const set: Record<string, any> = {}
      for (const [col, key] of [
        ['composedImage', 'composedImage'], ['firstFrameImage', 'firstFrameImage'], ['lastFrameImage', 'lastFrameImage'],
        ['videoUrl', 'videoUrl'], ['composedVideoUrl', 'composedVideoUrl'], ['subtitleUrl', 'subtitleUrl'],
      ] as const) {
        const nv = mapColumn(r[col], owner); if (nv) set[key] = nv
      }
      const refs = mapJsonColumn(r.referenceImages, owner); if (refs) set.referenceImages = refs
      if (Object.keys(set).length) recordUpdate('storyboards', schema.storyboards, r.id, set)
    }
  })

  // sys_task：local_path（generation-refs.ts 参考素材本地回退依赖），归属用自身 user_id/drama_id
  await streamTable(schema.sysTask, {
    userId: schema.sysTask.userId, dramaId: schema.sysTask.dramaId, localPath: schema.sysTask.localPath,
  }, rows => {
    for (const r of rows as any[]) {
      const nv = mapColumn(r.localPath, { userId: r.userId ?? null, dramaId: r.dramaId ?? null })
      if (nv) recordUpdate('sys_task', schema.sysTask, r.id, { localPath: nv })
    }
  })

  // video_merges：merged_url，归属用自身 user_id/drama_id
  await streamTable(schema.videoMerges, {
    userId: schema.videoMerges.userId, dramaId: schema.videoMerges.dramaId, mergedUrl: schema.videoMerges.mergedUrl,
  }, rows => {
    for (const r of rows as any[]) {
      const nv = mapColumn(r.mergedUrl, { userId: r.userId ?? null, dramaId: r.dramaId ?? null })
      if (nv) recordUpdate('video_merges', schema.videoMerges, r.id, { mergedUrl: nv })
    }
  })

  // assets：url / thumbnail_url / local_path，归属用自身 user_id/drama_id
  await streamTable(schema.assets, {
    userId: schema.assets.userId, dramaId: schema.assets.dramaId,
    url: schema.assets.url, thumbnailUrl: schema.assets.thumbnailUrl, localPath: schema.assets.localPath,
  }, rows => {
    for (const r of rows as any[]) {
      const owner = { userId: r.userId ?? null, dramaId: r.dramaId ?? null }
      const set: Record<string, any> = {}
      const url = mapColumn(r.url, owner); if (url) set.url = url
      const thumb = mapColumn(r.thumbnailUrl, owner); if (thumb) set.thumbnailUrl = thumb
      const lp = mapColumn(r.localPath, owner); if (lp) set.localPath = lp
      if (Object.keys(set).length) recordUpdate('assets', schema.assets, r.id, set)
    }
  })
}
