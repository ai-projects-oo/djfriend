import type { GigFinderProfile } from './types.js'

export function generateSearchQueries(profile: GigFinderProfile): string[] {
  const queries: string[] = []
  const topGenres = profile.primaryGenres.slice(0, 4)
  const areas = profile.preferredAreas.length ? profile.preferredAreas : ['Tel Aviv']
  const primaryArea = areas[0]

  // Web: area × genre
  for (const area of areas) {
    for (const genre of topGenres) {
      queries.push(`${genre} DJ ${area}`)
    }
    queries.push(`DJ events ${area}`)
    queries.push(`nightlife ${area} DJ booking`)
    queries.push(`club night ${area} DJ lineup`)
  }

  // Web: venue types (use profile location not hardcoded Tel Aviv)
  queries.push(`rooftop DJ ${primaryArea} events`)
  queries.push(`sunset party ${primaryArea} DJ`)
  queries.push(`beach club DJ Israel`)
  queries.push(`pool party DJ ${primaryArea}`)
  queries.push(`hotel rooftop ${primaryArea} DJ events`)
  queries.push(`bar ${primaryArea} live DJ house music`)
  queries.push(`party series ${primaryArea} DJ promoter`)
  queries.push(`event promoter ${primaryArea} DJ booking contact`)

  // Resident Advisor — serious music venue directory
  queries.push(`site:ra.co ${primaryArea} club bar DJ`)
  queries.push(`site:ra.co Israel venue DJ events`)

  // Web: opportunity signals
  queries.push(`DJ wanted Israel booking`)
  queries.push(`new party series ${primaryArea} 2025`)
  queries.push(`house music club night Israel`)
  queries.push(`Friday house night ${primaryArea}`)
  queries.push(`disco house party ${primaryArea}`)
  queries.push(`DJ booking open call Israel 2025`)

  // Hebrew
  queries.push(`DJ דרוש ${primaryArea}`)
  queries.push('תקליטן מסיבה תל אביב')
  queries.push('ערב בית תל אביב מועדון')
  queries.push('מסיבה גג תל אביב')
  queries.push('מועדון לייב תל אביב DJ')
  queries.push('אירוע מוזיקה תל אביב ליינאפ')

  // Instagram — promoters, venues, DJs
  for (const area of areas.slice(0, 2)) {
    queries.push(`site:instagram.com DJ promoter ${area} house music events`)
    queries.push(`site:instagram.com ${area} club rooftop DJ events booking`)
  }
  queries.push(`site:instagram.com ${primaryArea} house disco DJ events`)
  queries.push('site:instagram.com Israel DJ booking promoter nightlife')
  queries.push('site:instagram.com "book a DJ" OR "DJ wanted" Israel')
  for (const genre of topGenres.slice(0, 2)) {
    queries.push(`site:instagram.com "${genre}" DJ Israel`)
  }

  // Seed-anchored queries — find pages that mention venues the DJ already knows.
  // Those pages tend to list the whole scene alongside (co-mention discovery).
  const seeds = (profile.seedInstagramHandles ?? []).map(h => h.replace(/^@/, '').trim()).filter(Boolean)
  if (seeds.length > 0) {
    const area = areas[0]
    for (const seed of seeds.slice(0, 8)) {
      queries.push(`"@${seed}" ${area}`)
      queries.push(`"${seed}" ${area} bar OR club OR party`)
    }
    if (seeds.length >= 2) {
      // Combine seeds pairwise — pages that mention multiple seeds are gold
      queries.push(`"${seeds[0]}" "${seeds[1]}" ${area}`)
      if (seeds.length >= 3) queries.push(`"${seeds[0]}" "${seeds[2]}" ${area}`)
    }
  }

  return [...new Set(queries)]
}
