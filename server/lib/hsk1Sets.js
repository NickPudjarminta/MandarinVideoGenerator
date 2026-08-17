/**
 * Backward-compatible HSK1 spreadsheet helpers.
 * Prefer templateSets.js for new code.
 */
export {
  loadTemplateRows as loadHsk1Rows,
  setCount,
  getTemplateSet,
  DEFAULT_SET_SIZE as SET_SIZE,
} from './templateSets.js'
import { spreadsheetPath } from './templates.js'
import { getTemplateSet } from './templateSets.js'

export const HSK1_XLSX = spreadsheetPath('hsk1')

export async function getSet(setIndex) {
  return getTemplateSet('hsk1', setIndex)
}
