import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/flights')({
  component: FlightsPage,
})

interface Flight {
  id: number
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

interface Leg {
  id: number
  inbound: boolean
  connectionTime: number | null
  flight: Flight
}

interface TripWithDeals {
  tripId: number
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
  deals: Array<{
    id: number
    source: string
    provider: string
    price: number
    link: string
    expiryDate: string
  }>
}

function FlightsPage() {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [departureDate, setDepartureDate] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [isRoundTrip, setIsRoundTrip] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tripsWithDeals, setTripsWithDeals] = useState<TripWithDeals[]>([])
  const [error, setError] = useState('')
  const [selectedTripForDeals, setSelectedTripForDeals] = useState<TripWithDeals | null>(null)

  const handleSearch = async () => {
    if (!origin || !destination || !departureDate) {
      setError('Please fill in origin, destination, and departure date')
      return
    }

    setLoading(true)
    setError('')
    setTripsWithDeals([])

    try {
      const requestBody: any = {
        origin,
        destination,
        departureDate,
      }

      if (isRoundTrip && returnDate) {
        requestBody.returnDate = returnDate
      }

      const response = await fetch('/api/flights/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json()

      if (data.success) {
        setTripsWithDeals(data.tripsWithDeals || [])
      } else {
        setError(data.error || 'Failed to search flights')
      }
    } catch (err) {
      console.error('Error searching flights:', err)
      setError('Failed to search flights. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  const TripCard = ({ trip }: { trip: TripWithDeals }) => {
    const minPrice = Math.min(...trip.deals.map(d => d.price))
    const outboundLegs = trip.legs.filter(leg => !leg.inbound)
    const returnLegs = trip.legs.filter(leg => leg.inbound)

    return (
      <div className="border rounded-lg p-6 hover:shadow-lg transition-shadow bg-white">
        {/* Header with trip info */}
        <div className="mb-6 pb-4 border-b">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-lg font-semibold mb-1">
                {trip.isRound ? (
                  <>{trip.origin} ⇄ {trip.destination}</>
                ) : (
                  <>{trip.origin} → {trip.destination}</>
                )}
              </div>
              <div className="text-sm text-gray-600">
                {trip.stopCount === 0 ? 'Direct' : `${trip.stopCount} stop${trip.stopCount > 1 ? 's' : ''}`}
              </div>
            </div>
            <div className="text-right">
              <button
                onClick={() => setSelectedTripForDeals(trip)}
                className="text-2xl font-bold text-green-600 hover:text-green-700 cursor-pointer transition-colors"
              >
                ${minPrice}
              </button>
              <div className="text-xs text-gray-500 mt-1 cursor-pointer hover:text-gray-700" onClick={() => setSelectedTripForDeals(trip)}>
                {trip.deals.length} deal{trip.deals.length > 1 ? 's' : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Outbound Legs */}
        {outboundLegs.length > 0 && (
          <div className="mb-6">
            {(() => {
              const outboundDuration = outboundLegs.reduce((total, leg) => total + leg.flight.duration, 0) +
                outboundLegs.reduce((total, leg) => total + (leg.connectionTime || 0), 0);
              const firstOutboundLeg = outboundLegs[0];
              return (
                <div className="text-sm font-semibold text-gray-700 mb-3">
                  Outbound • <span className="text-blue-600">{formatDate(firstOutboundLeg.flight.departureDate)}</span> <span className="text-purple-600">{firstOutboundLeg.flight.departureTime}</span> • <span className="text-orange-600">{formatDuration(outboundDuration)}</span>
                </div>
              );
            })()}
            <div className="space-y-3">
              {outboundLegs.map((leg, idx) => (
                <div key={leg.id} className="pl-4 border-l-2 border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="font-semibold">{leg.flight.airline}</div>
                        <div className="text-sm text-gray-600">{leg.flight.flightNumber}</div>
                        <div className="text-xs text-orange-600">
                          {formatDuration(leg.flight.duration)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div>
                          <div className="font-semibold text-purple-600">{leg.flight.departureTime}</div>
                          <div className="text-gray-600">{leg.flight.origin}</div>
                          <div className="text-xs text-blue-600">{formatDate(leg.flight.departureDate)}</div>
                        </div>
                        <div className="flex-1 text-center text-gray-400">→</div>
                        <div>
                          <div className="font-semibold text-purple-600">{leg.flight.arrivalTime}</div>
                          <div className="text-gray-600">{leg.flight.destination}</div>
                          <div className="text-xs text-blue-600">{formatDate(leg.flight.arrivalDate)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {leg.connectionTime !== null && idx < outboundLegs.length - 1 && (
                    <div className="mt-3 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">
                      Wait time: {Math.floor(leg.connectionTime / 60)}h {leg.connectionTime % 60}m at {leg.flight.destination}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Return Legs */}
        {returnLegs.length > 0 && (
          <div className="mb-6">
            {(() => {
              const returnDuration = returnLegs.reduce((total, leg) => total + leg.flight.duration, 0) +
                returnLegs.reduce((total, leg) => total + (leg.connectionTime || 0), 0);
              const firstReturnLeg = returnLegs[0];
              return (
                <div className="text-sm font-semibold text-gray-700 mb-3">
                  Return • <span className="text-blue-600">{formatDate(firstReturnLeg.flight.departureDate)}</span> <span className="text-purple-600">{firstReturnLeg.flight.departureTime}</span> • <span className="text-orange-600">{formatDuration(returnDuration)}</span>
                </div>
              );
            })()}
            <div className="space-y-3">
              {returnLegs.map((leg, idx) => (
                <div key={leg.id} className="pl-4 border-l-2 border-green-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="font-semibold">{leg.flight.airline}</div>
                        <div className="text-sm text-gray-600">{leg.flight.flightNumber}</div>
                        <div className="text-xs text-orange-600">
                          {formatDuration(leg.flight.duration)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div>
                          <div className="font-semibold text-purple-600">{leg.flight.departureTime}</div>
                          <div className="text-gray-600">{leg.flight.origin}</div>
                          <div className="text-xs text-blue-600">{formatDate(leg.flight.departureDate)}</div>
                        </div>
                        <div className="flex-1 text-center text-gray-400">→</div>
                        <div>
                          <div className="font-semibold text-purple-600">{leg.flight.arrivalTime}</div>
                          <div className="text-gray-600">{leg.flight.destination}</div>
                          <div className="text-xs text-blue-600">{formatDate(leg.flight.arrivalDate)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {leg.connectionTime !== null && idx < returnLegs.length - 1 && (
                    <div className="mt-3 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">
                      Wait time: {Math.floor(leg.connectionTime / 60)}h {leg.connectionTime % 60}m at {leg.flight.destination}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Flight Search</h1>
        
        {/* Search Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Origin</label>
              <Input
                type="text"
                placeholder="e.g., JFK"
                value={origin}
                onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Destination</label>
              <Input
                type="text"
                placeholder="e.g., LAX"
                value={destination}
                onChange={(e) => setDestination(e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Departure Date</label>
              <Input
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Return Date (Optional)</label>
              <Input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                min={departureDate || new Date().toISOString().split('T')[0]}
                disabled={!isRoundTrip}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRoundTrip}
                onChange={(e) => {
                  setIsRoundTrip(e.target.checked)
                  if (!e.target.checked) {
                    setReturnDate('')
                  }
                }}
                className="w-4 h-4"
              />
              <span className="text-sm">Round trip</span>
            </label>
          </div>
          
          <Button 
            onClick={handleSearch} 
            disabled={loading}
            className="w-full md:w-auto"
          >
            {loading ? 'Searching...' : 'Search Flights'}
          </Button>
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {tripsWithDeals.length > 0 && (
          <div>
            <h2 className="text-2xl font-semibold mb-4">
              Available Trips with Deals {departureDate && `- ${formatDate(departureDate)}`}
            </h2>
            <div className="space-y-4">
              {tripsWithDeals.map((trip) => (
                <TripCard key={trip.tripId} trip={trip} />
              ))}
            </div>
          </div>
        )}

        {!loading && tripsWithDeals.length === 0 && !error && (
          <div className="text-center text-gray-500 py-12">
            Enter your search criteria and click "Search Flights" to see results
          </div>
        )}

        {/* Deals Popup Modal */}
        {selectedTripForDeals && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold">Available Deals</h2>
                  <div className="text-sm text-gray-600">
                    {selectedTripForDeals.isRound ? (
                      <>{selectedTripForDeals.origin} ⇄ {selectedTripForDeals.destination}</>
                    ) : (
                      <>{selectedTripForDeals.origin} → {selectedTripForDeals.destination}</>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTripForDeals(null)}
                >
                  ✕
                </Button>
              </div>
              
              <div className="p-4">
                <div className="space-y-2">
                  {selectedTripForDeals.deals.map((deal) => {
                    const minPrice = Math.min(...selectedTripForDeals.deals.map(d => d.price))
                    
                    return (
                      <div key={deal.id} className="border rounded p-3 hover:shadow-sm transition-shadow">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold">{deal.provider}</div>
                              <div className="text-xs text-gray-500">• {deal.source}</div>
                              {deal.price === minPrice && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Best</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Expires: {formatDate(deal.expiryDate)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xl font-bold text-green-600">${deal.price}</div>
                            </div>
                            <a
                              href={deal.link}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button size="sm" variant="default">
                                View Deal
                              </Button>
                            </a>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
