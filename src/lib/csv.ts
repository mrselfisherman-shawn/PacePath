import Papa, { type ParseResult } from 'papaparse'

export type CsvRow = Record<string, string>

function parseCsvText(text: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(text, {
      delimiter: ',',
      header: true,
      skipEmptyLines: true,
      complete: (result: ParseResult<CsvRow>) => {
        const blockingErrors = result.errors.filter(
          (err) => !(err.type === 'Delimiter' && err.code === 'UndetectableDelimiter'),
        )

        if (blockingErrors.length > 0) {
          reject(new Error(blockingErrors[0].message))
          return
        }
        resolve(result.data)
      },
      error: (error: Error) => {
        reject(error)
      },
    })
  })
}

export async function loadCsv(path: string): Promise<CsvRow[]> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${path}`)
  }

  const text = await response.text()
  return parseCsvText(text)
}
