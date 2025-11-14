import { z } from 'zod'

export const flightsSearchSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  departureDate: z.string().optional(),
  departureDateEnd: z.string().optional(),
  returnDate: z.string().optional(),
  returnDateEnd: z.string().optional(),
  isRoundTrip: z.union([z.string(), z.boolean()]).optional().transform((val) => {
    if (typeof val === 'boolean') return val
    return val === 'true'
  }),
  page: z.union([z.string(), z.number()]).optional().transform((val) => {
    if (!val) return 1
    const num = typeof val === 'number' ? val : parseInt(val, 10)
    return isNaN(num) || num < 1 ? 1 : num
  }),
})

