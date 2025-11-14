export interface Flight {
  id: string
  flightNumber: string
  airline: string
  origin: string
  destination: string
  departureDate: string
  departureTime: string
  arrivalDate: string
  arrivalTime: string
  duration: number
}

export interface Leg {
  id: string
  inbound: boolean
  connectionTime: number | null
  flight: Flight
}

export interface Deal {
  id: string
  source: string
  provider: string
  price: number
  link: string
}

export interface TripWithDeals {
  tripId: string
  origin: string
  destination: string
  stopCount: number
  duration: number
  isRound: boolean
  departureDate: string
  departureTime: string
  returnDate: string | null
  returnTime: string | null
  legs: Leg[]
  deals: Deal[]
}

