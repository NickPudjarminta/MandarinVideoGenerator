import path from 'node:path'
import ExcelJS from 'exceljs'
import { spreadsheetPath, loadTemplate } from './templates.js'

export const DEFAULT_SET_SIZE = 20

function cellText(cell) {
  if (cell == null) return ''
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim()
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text || '').join('').trim()
    if (v.text) return String(v.text).trim()
    if (v.result != null) return String(v.result).trim()
  }
  return String(v).trim()
}

export async function loadTemplateRows(templateId) {
  const filePath = spreadsheetPath(templateId)
  if (!path.isAbsolute(filePath) && !filePath) throw new Error('Spreadsheet path missing')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Workbook has no sheets')

  const rows = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const no = Number(cellText(row.getCell(1))) || rows.length + 1
    const word = cellText(row.getCell(2))
    const pinyin = cellText(row.getCell(3))
    const pos = cellText(row.getCell(4))
    const translation = cellText(row.getCell(5))
    const zh = cellText(row.getCell(6))
    const en = cellText(row.getCell(7))
    if (!zh && !word) return
    rows.push({ no, word, pinyin, pos, translation, zh, en })
  })
  return rows
}

export function setCount(totalRows, setSize = DEFAULT_SET_SIZE) {
  return Math.ceil(Math.max(0, totalRows) / setSize)
}

export async function getTemplateSet(templateId, setIndex) {
  const cfg = loadTemplate(templateId)
  const setSize = Number(cfg.setSize) || DEFAULT_SET_SIZE
  const all = await loadTemplateRows(templateId)
  const totalSets = setCount(all.length, setSize)
  const idx = Number(setIndex)
  if (!Number.isFinite(idx) || idx < 1 || idx > totalSets) {
    throw new Error(`Invalid set index ${setIndex}. Valid range: 1–${totalSets}`)
  }
  const start = (idx - 1) * setSize
  const phrases = all.slice(start, start + setSize)
  if (!phrases.length) throw new Error(`Set ${idx} is empty`)
  return {
    templateId: cfg.id,
    setIndex: idx,
    setCount: totalSets,
    setSize,
    phrases,
    firstWord: phrases[0].word,
    lastWord: phrases[phrases.length - 1].word,
  }
}
