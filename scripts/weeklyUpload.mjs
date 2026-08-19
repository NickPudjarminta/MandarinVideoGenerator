#!/usr/bin/env node
import 'dotenv/config'
import { bootstrapStudio } from '../server/lib/templates.js'
import { runWeeklyUpload } from '../server/lib/weeklyUpload.js'

bootstrapStudio()
runWeeklyUpload({ force: true })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2))
    process.exit(0)
  })
  .catch((err) => {
    console.error(err.stack || err.message || err)
    process.exit(1)
  })
