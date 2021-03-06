'use strict'
const fs = require('fs')
const http = require('https')
const levelup = require('level')
const rmDir = require('./util').rmDir
const exec = require('child_process').exec

const xpiVersion = '2018.9.19' // Manually update this to latest version

const downloadRulesets = (dir, cb) => {
  const downloadURL = `https://www.eff.org/files/https-everywhere-${xpiVersion}-eff.xpi`
  const xpiFile = fs.createWriteStream('httpse.xpi')
  http.get(downloadURL, (response) => {
    response.pipe(xpiFile)
    xpiFile.on('finish', () => {
      xpiFile.close(() => {
        exec('unzip ../httpse.xpi', {
          cwd: 'https-everywhere'
        }, (err) => {
          if (err) {
            throw err
          } else {
            cb()
          }
        })
      })
    })
  })
    .on('error', (err) => {
      console.log(`Error downloading ${downloadURL}`, err)
    })
}

const buildDataFiles = () => {
  // Manually exclude sites that are broken until they are fixed in the next
  // HTTPS Everywhere release.
  const exclusions = {
    'Fox News': 'breaks foxnews.com on C70+ with NET::ERR_CERT_SYMANTEC_LEGACY',
    'Digg (partial)': 'breaks digg.com on C70+ with NET::ERR_CERT_SYMANTEC_LEGACY'
  }

  const rulesets = JSON.parse(fs.readFileSync('./https-everywhere/rules/default.rulesets', 'utf8'))

  let jsonOutput = {
    'rulesetStrings': [],
    'targets': {}
  }

  for (const ruleset of rulesets) {
    if (!ruleset.default_off && !ruleset.platform) {
      if (ruleset.name in exclusions) {
        console.log('NOTE: Excluding ruleset:', ruleset.name)
        continue
      }

      for (const target of ruleset.target) {
        if (!jsonOutput['targets'][target]) {
          jsonOutput['targets'][target] = []
        }
        jsonOutput['targets'][target].push(jsonOutput['rulesetStrings'].length)
      }

      let r = {
        ruleset: {
          'name': ruleset.name,
          'rule': ruleset.rule.map((rule) => {
            return {
              'from': rule.from,
              'to': rule.to
            }
          })
        }
      }

      if (ruleset.exclusion) {
        r.exclusion = ruleset.exclusion.map((exclusion) => {
          return {
            'pattern': exclusion
          }
        })
      }

      jsonOutput['rulesetStrings'].push(r)
    }
  }

  console.log('Writing httpse.json')
  fs.writeFileSync('./out/httpse.json', JSON.stringify(jsonOutput), 'utf8')

  console.log('creating httpse.leveldb')
  rmDir('./out/httpse.leveldb')

  const httpseLevelDB = levelup('./out/httpse.leveldb', {
    compression: false, errorIfExists: true
  })

  let batch = httpseLevelDB.batch()

  for (const ruleset of rulesets) {
    if (!ruleset.default_off && !ruleset.platform) {
      if (ruleset.name in exclusions) {
        console.log('NOTE: Excluding ruleset:', ruleset.name)
        continue
      }

      let targetRuleSets = []
      let rule = {
        r: ruleset.rule.map((rule) => {
          if (rule.from === '^http:' && rule.to === 'https:') {
            return { d: 1 }
          } else {
            return { f: rule.from, t: rule.to }
          }
        })
      }
      if (ruleset.exclusion) {
        rule.e = ruleset.exclusion.map((exclusion) => {
          return { p: exclusion.pattern }
        })
      }
      targetRuleSets = targetRuleSets.concat(rule)

      for (const target of ruleset.target) {
        const reverseTarget = target.split('.').reverse().join('.')
        if (targetRuleSets.length > 0) {
          batch.put(reverseTarget, JSON.stringify(targetRuleSets), {
            sync: true
          })
        }
      }
    }
  }

  batch.write((err) => {
    if (err) {
      console.error(err)
    } else {
      httpseLevelDB.close((err) => {
        if (err) {
          console.error(err)
        } else {
          exec('zip -r httpse.leveldb.zip httpse.leveldb && tar -czf httpse.leveldb.tgz httpse.leveldb', {
            cwd: 'out'
          }, (err) => {
            if (err) {
              throw err
            } else {
              rmDir('./out/httpse.leveldb')
              console.log('done')
            }
          })
        }
      })
    }
  })
}

rmDir('./https-everywhere')
fs.mkdirSync('./https-everywhere')
rmDir('./out')
fs.mkdirSync('./out')

console.log('downloading rulesets')
downloadRulesets('./https-everywhere', buildDataFiles)
