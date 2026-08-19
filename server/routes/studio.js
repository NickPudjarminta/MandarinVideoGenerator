/**
 * Legacy Studio routes — re-exports split app routers for /api/studio/* aliases.
 */
export {
  hskBootstrapHandler as studioBootstrapHandler,
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  updateTemplateHandler,
  uploadTemplateAssetHandler,
  enqueueGenerateHandler,
  hskQueueStatusHandler as queueStatusHandler,
} from './hsk.js'

export { enqueueOneOffHandler } from './grammar.js'

export {
  listVideosHandler,
  getVideoHandler,
  patchVideoHandler,
  queueUploadsHandler,
  weeklyUploadHandler,
} from './scheduler.js'
