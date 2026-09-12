import type { GigFinderProfile } from './types.js'

export function generateSearchQueries(profile: GigFinderProfile): string[] {
  const queries: string[] = []

  // Area × genre combinations
  for (const area of profile.preferredAreas) {
    for (const genre of profile.primaryGenres.slice(0, 4)) {
      queries.push(`"${genre}" DJ ${area}`)
    }
    queries.push(`DJ ${area}`)
    queries.push(`events ${area}`)
  }

  // Hebrew queries
  queries.push('DJ דרוש תל אביב')
  queries.push('תקליטן דרוש')
  queries.push('מסיבה בית תל אביב')
  queries.push('ערב בית תל אביב')
  queries.push('DJ שישי')
  queries.push('house music ישראל')

  // Venue-type queries
  queries.push('rooftop DJ Tel Aviv')
  queries.push('sunset party Tel Aviv')
  queries.push('beach party DJ Israel')
  queries.push('pool party DJ Tel Aviv')

  // Opportunity signal queries
  queries.push('DJ wanted Israel')
  queries.push('new party series Tel Aviv')
  queries.push('DJ lineup TBA Tel Aviv')

  // Recurring event searches
  queries.push('Friday DJ night Tel Aviv')
  queries.push('house night rotating DJs Tel Aviv')
  queries.push('weekly DJ night Tel Aviv bar')

  // Genre + venue type combos
  for (const genre of profile.primaryGenres.slice(0, 3)) {
    queries.push(`${genre} club night Tel Aviv`)
  }

  // Deduplicate
  return [...new Set(queries)]
}
